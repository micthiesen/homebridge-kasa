import { withRetry } from "@micthiesen/mitools/async";
import {
  aesDecrypt,
  aesEncrypt,
  decryptAesSessionKey,
  generateAesKeyPair,
  generateAesLoginHash,
} from "./crypto.js";
import { httpPost } from "./http.js";
import {
  AuthError,
  parseSessionCookie,
  parseTimeoutCookie,
} from "./transport-utils.js";
import type { AesSessionState, KasaCredentials } from "./types.js";

const DEFAULT_TIMEOUT = 10_000;
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour (conservative)

const DEFAULT_CREDENTIALS: KasaCredentials = { username: "", password: "" };

const AES_COMMON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  requestByApp: "true",
  Accept: "application/json",
};

export interface AesTransportOptions {
  host: string;
  port?: number;
  credentials?: KasaCredentials;
  timeout?: number;
}

/**
 * AES (Tapo-protocol) transport for TP-Link Kasa devices.
 *
 * Communicates over HTTP on port 80 using RSA handshake for session key
 * exchange, AES-CBC encryption for commands, and securePassthrough wrapping.
 */
export class AesTransport {
  private readonly host: string;
  private readonly port: number;
  private readonly credentials: KasaCredentials;
  private readonly timeout: number;
  private readonly baseUrl: string;

  private session: AesSessionState | null = null;

  constructor(options: AesTransportOptions) {
    this.host = options.host;
    this.port = options.port ?? 80;
    this.credentials = options.credentials ?? DEFAULT_CREDENTIALS;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.baseUrl = `http://${this.host}:${this.port}`;
  }

  /**
   * Perform the AES handshake and login.
   *
   * 1. Generate RSA key pair
   * 2. POST /app with handshake request containing public key
   * 3. Decrypt response to get AES session key + IV
   * 4. Store session cookie
   * 5. POST login_device with hashed credentials to get auth token
   */
  async handshake(): Promise<void> {
    this.session = null;

    // -- Step 1: RSA handshake --
    const { publicKey, privateKey } = generateAesKeyPair();

    const handshakeBody = JSON.stringify({
      method: "handshake",
      params: { key: publicKey },
    });

    const hsResp = await httpPost(
      `${this.baseUrl}/app`,
      handshakeBody,
      AES_COMMON_HEADERS,
      this.timeout,
    );

    if (hsResp.statusCode !== 200) {
      throw new Error(
        `AES handshake failed: ${this.host} responded with status ${hsResp.statusCode}`,
      );
    }

    const hsResult = JSON.parse(hsResp.body.toString("utf-8"));

    if (hsResult.error_code !== 0) {
      throw new Error(
        `AES handshake error from ${this.host}: error_code=${hsResult.error_code}`,
      );
    }

    const encryptedKey: string = hsResult.result.key;
    const { key, iv } = decryptAesSessionKey(encryptedKey, privateKey);

    // Extract session cookie
    const cookie = parseSessionCookie(hsResp.headers);
    if (!cookie) {
      throw new Error(`AES handshake: no session cookie returned from ${this.host}`);
    }

    // Parse timeout for session expiry
    const timeoutSec = parseTimeoutCookie(hsResp.headers);
    const bufferMs = 20 * 60 * 1000;
    const expiresIn = timeoutSec ? timeoutSec * 1000 - bufferMs : SESSION_TTL_MS;

    // -- Step 2: Login --
    const loginHash = generateAesLoginHash(this.credentials);

    const loginRequest = JSON.stringify({
      method: "login_device",
      params: {
        username: loginHash.username,
        password: loginHash.password,
      },
      request_time_milis: Date.now(),
    });

    const encryptedLogin = aesEncrypt(loginRequest, key, iv);

    const loginBody = JSON.stringify({
      method: "securePassthrough",
      params: { request: encryptedLogin },
    });

    const loginResp = await httpPost(
      `${this.baseUrl}/app`,
      loginBody,
      {
        ...AES_COMMON_HEADERS,
        Cookie: cookie,
      },
      this.timeout,
    );

    if (loginResp.statusCode !== 200) {
      throw new Error(
        `AES login failed: ${this.host} responded with status ${loginResp.statusCode}`,
      );
    }

    const loginResult = JSON.parse(loginResp.body.toString("utf-8"));

    if (loginResult.error_code !== 0) {
      throw new Error(
        `AES login error from ${this.host}: error_code=${loginResult.error_code}`,
      );
    }

    // Decrypt the login response to get the token
    const decryptedLoginResp = aesDecrypt(loginResult.result.response, key, iv);
    const loginData = JSON.parse(decryptedLoginResp);

    if (loginData.error_code !== 0) {
      throw new Error(
        `AES login_device error from ${this.host}: error_code=${loginData.error_code}`,
      );
    }

    const token: string = loginData.result.token;

    this.session = {
      cookie,
      key,
      iv,
      token,
      expiry: Date.now() + expiresIn,
    };
  }

  /**
   * Send a JSON command to the device.
   *
   * Encrypts the payload with AES-CBC, wraps it in a securePassthrough
   * request, and sends it to POST /app?token=TOKEN. Decrypts and parses
   * the response. Re-handshakes on auth errors (once).
   */
  async send(request: object): Promise<object> {
    return await withRetry(
      async () => {
        if (!this.session || Date.now() >= this.session.expiry) {
          await this.handshake();
        }

        const session = this.session!;

        const payload = JSON.stringify(request);
        const encrypted = aesEncrypt(payload, session.key, session.iv);

        const body = JSON.stringify({
          method: "securePassthrough",
          params: { request: encrypted },
        });

        const resp = await httpPost(
          `${this.baseUrl}/app?token=${session.token}`,
          body,
          {
            ...AES_COMMON_HEADERS,
            Cookie: session.cookie,
          },
          this.timeout,
        );

        if (resp.statusCode !== 200) {
          throw new Error(
            `AES request failed: ${this.host} responded with status ${resp.statusCode}`,
          );
        }

        const result = JSON.parse(resp.body.toString("utf-8"));

        // Check for authentication errors in the outer response
        if (result.error_code !== 0) {
          const code = result.error_code;
          // -1501 (invalid request), -1002 (incorrect request), -1003 (JSON format error)
          // are auth/session errors that warrant re-handshake
          if (code === -1501 || code === -1002 || code === -1003) {
            throw new AuthError(
              `AES request auth error from ${this.host}: error_code=${code}`,
            );
          }
          throw new Error(`AES request error from ${this.host}: error_code=${code}`);
        }

        // Decrypt the inner response
        const decryptedResp = aesDecrypt(
          result.result.response,
          session.key,
          session.iv,
        );
        return JSON.parse(decryptedResp);
      },
      {
        maxAttempts: 2,
        baseDelayMs: 0,
        shouldRetry: (err) => {
          if (err instanceof AuthError) {
            this.session = null;
            return true;
          }
          return false;
        },
      },
    );
  }

  /** Clear session state. */
  close(): void {
    this.session = null;
  }
}
