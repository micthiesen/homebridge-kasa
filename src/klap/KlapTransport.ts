import * as http from "node:http";
import {
  deriveKlapKeys,
  generateKlapAuthHash,
  generateKlapLocalAuthHash,
  generateKlapLocalSeed,
  generateKlapRemoteAuthHash,
  klapDecrypt,
  klapEncrypt,
} from "./crypto.js";
import type { KasaCredentials, KlapSessionState } from "./types.js";

const DEFAULT_TIMEOUT = 10_000;
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour (conservative)

const DEFAULT_CREDENTIALS: KasaCredentials = { username: "", password: "" };

interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function httpPost(
  url: string,
  body: Buffer | string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqBody = typeof body === "string" ? Buffer.from(body, "utf-8") : body;

    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": String(reqBody.length),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", reject);
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error(`HTTP request timed out after ${timeoutMs}ms`));
    });

    req.write(reqBody);
    req.end();
  });
}

/**
 * Parse TP_SESSIONID from Set-Cookie header(s).
 *
 * The device may return one or more Set-Cookie values. We look for
 * TP_SESSIONID or SESSIONID and return the raw cookie string suitable
 * for sending back in a Cookie header.
 */
function parseSessionCookie(headers: http.IncomingHttpHeaders): string | undefined {
  const raw = headers["set-cookie"];
  if (!raw) return undefined;

  const cookies = Array.isArray(raw) ? raw : [raw];
  for (const cookie of cookies) {
    const match = cookie.match(/(?:TP_SESSIONID|SESSIONID)=([^;]+)/i);
    if (match) {
      return `TP_SESSIONID=${match[1]}`;
    }
  }
  return undefined;
}

/**
 * Parse the TIMEOUT value from Set-Cookie headers (seconds).
 */
function parseTimeoutCookie(headers: http.IncomingHttpHeaders): number | undefined {
  const raw = headers["set-cookie"];
  if (!raw) return undefined;

  const cookies = Array.isArray(raw) ? raw : [raw];
  for (const cookie of cookies) {
    const match = cookie.match(/TIMEOUT=(\d+)/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  }
  return undefined;
}

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface KlapTransportOptions {
  host: string;
  port?: number;
  credentials?: KasaCredentials;
  timeout?: number;
}

/**
 * KLAP v2 transport for TP-Link Kasa devices.
 *
 * Communicates over HTTP on port 80 using the KLAP v2 handshake and
 * encryption protocol.
 */
export class KlapTransport {
  private readonly host: string;
  private readonly port: number;
  private readonly credentials: KasaCredentials;
  private readonly timeout: number;
  private readonly baseUrl: string;

  private session: KlapSessionState | null = null;
  private klapKey: Buffer | null = null;
  private klapIv: Buffer | null = null;
  private klapSig: Buffer | null = null;

  constructor(options: KlapTransportOptions) {
    this.host = options.host;
    this.port = options.port ?? 80;
    this.credentials = options.credentials ?? DEFAULT_CREDENTIALS;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.baseUrl = `http://${this.host}:${this.port}`;
  }

  /**
   * Perform the two-step KLAP v2 handshake.
   *
   * 1. POST /app/handshake1 with 16-byte local seed
   * 2. Verify remote auth hash
   * 3. POST /app/handshake2 with local auth hash
   * 4. Derive session keys
   * 5. Store session state (cookie, keys, seq)
   */
  async handshake(): Promise<void> {
    this.session = null;
    this.klapKey = null;
    this.klapIv = null;
    this.klapSig = null;

    const localSeed = generateKlapLocalSeed(16);
    const authHash = generateKlapAuthHash(this.credentials);

    // -- Handshake 1 --
    const hs1Resp = await httpPost(
      `${this.baseUrl}/app/handshake1`,
      localSeed,
      { "Content-Type": "application/octet-stream" },
      this.timeout,
    );

    if (hs1Resp.statusCode !== 200) {
      throw new Error(
        `KLAP handshake1 failed: ${this.host} responded with status ${hs1Resp.statusCode}`,
      );
    }

    const responseData = hs1Resp.body;
    if (responseData.length < 48) {
      throw new Error(
        `KLAP handshake1: unexpected response length ${responseData.length} from ${this.host}`,
      );
    }

    const remoteSeed = responseData.subarray(0, 16);
    const serverHash = responseData.subarray(16, 48);

    // Verify the server hash: SHA256(local_seed + remote_seed + auth_hash)
    const expectedHash = generateKlapLocalAuthHash(localSeed, remoteSeed, authHash);
    if (!serverHash.equals(expectedHash)) {
      throw new Error(
        `KLAP handshake1: server hash mismatch on ${this.host}. ` +
          "Check that credentials are correct.",
      );
    }

    // Extract session cookie from handshake1 response
    const cookie = parseSessionCookie(hs1Resp.headers);
    if (!cookie) {
      throw new Error(`KLAP handshake1: no session cookie returned from ${this.host}`);
    }

    // Parse timeout for session expiry
    const timeoutSec = parseTimeoutCookie(hs1Resp.headers);

    // -- Handshake 2 --
    const remoteAuthHash = generateKlapRemoteAuthHash(remoteSeed, localSeed, authHash);

    const hs2Resp = await httpPost(
      `${this.baseUrl}/app/handshake2`,
      remoteAuthHash,
      {
        "Content-Type": "application/octet-stream",
        Cookie: cookie,
      },
      this.timeout,
    );

    if (hs2Resp.statusCode !== 200) {
      throw new Error(
        `KLAP handshake2 failed: ${this.host} responded with status ${hs2Resp.statusCode}`,
      );
    }

    // Derive session keys
    const { key, iv, sig, seq } = deriveKlapKeys(localSeed, remoteSeed, authHash);
    this.klapKey = key;
    this.klapIv = iv;
    this.klapSig = sig;

    // Compute session expiry. Use the device's timeout (seconds) if available,
    // otherwise fall back to our conservative TTL, with a 20-minute buffer.
    const bufferMs = 20 * 60 * 1000;
    const expiresIn = timeoutSec ? timeoutSec * 1000 - bufferMs : SESSION_TTL_MS;

    this.session = {
      cookie,
      encryptionKey: key,
      decryptionKey: key,
      sequenceNumber: seq,
      expiry: Date.now() + expiresIn,
    };
  }

  /**
   * Send a JSON command to the device.
   *
   * Encrypts the payload, sends it as POST /app/request?seq=N, and
   * decrypts the response. Re-handshakes on auth errors (once).
   */
  async send(request: object): Promise<object> {
    if (!this.session || Date.now() >= this.session.expiry) {
      await this.handshake();
    }

    const doSend = async (): Promise<object> => {
      const session = this.session!;
      const payload = Buffer.from(JSON.stringify(request), "utf-8");

      const { encryptedData, seq: newSeq } = klapEncrypt(
        payload,
        this.klapKey!,
        this.klapIv!,
        this.klapSig!,
        session.sequenceNumber,
      );

      session.sequenceNumber = newSeq;

      const resp = await httpPost(
        `${this.baseUrl}/app/request?seq=${newSeq}`,
        encryptedData,
        {
          "Content-Type": "application/octet-stream",
          Cookie: session.cookie,
        },
        this.timeout,
      );

      if (resp.statusCode === 403) {
        throw new AuthError(`KLAP request returned 403 from ${this.host}`);
      }

      if (resp.statusCode !== 200) {
        throw new Error(
          `KLAP request failed: ${this.host} responded with status ${resp.statusCode}`,
        );
      }

      const decrypted = klapDecrypt(
        resp.body,
        this.klapKey!,
        this.klapIv!,
        this.klapSig!,
        newSeq,
      );

      return JSON.parse(decrypted.toString("utf-8"));
    };

    try {
      return await doSend();
    } catch (err) {
      if (err instanceof AuthError) {
        // Re-handshake once and retry
        await this.handshake();
        return await doSend();
      }
      throw err;
    }
  }

  /** Clear session state. */
  close(): void {
    this.session = null;
    this.klapKey = null;
    this.klapIv = null;
    this.klapSig = null;
  }
}
