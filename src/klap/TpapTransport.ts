import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
  verify,
  X509Certificate,
} from "node:crypto";
import { p256 } from "@noble/curves/p256";

import { httpPost } from "./http.js";
import type { KasaCredentials } from "./types.js";

const DEFAULT_TIMEOUT = 10_000;
const MAX_PBKDF2_ITERATIONS = 100_000;
const TAG_LENGTH = 16;
const NONCE_LENGTH = 12;
const PAKE_CONTEXT_TAG = Buffer.from("PAKE V1");
const P256_M = Buffer.from(
  "02886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f",
  "hex",
);
const P256_N = Buffer.from(
  "03d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b49",
  "hex",
);

const TPAP_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIICNzCCAdygAwIBAgIUNLD7w5j5WU/efCe8bqkfGSRGgLYwCgYIKoZIzj0EAwIw
ezEnMCUGA1UEAwweVFAtTElOSyBTWVNURU1TIERFVklDRSBST09UIENBMR0wGwYD
VQQKDBRUUC1MSU5LIFNZU1RFTVMgSU5DLjEPMA0GA1UEBwwGSXJ2aW5lMRMwEQYD
VQQIDApDYWxpZm9ybmlhMQswCQYDVQQGEwJVUzAgFw0yNDExMjIwMjU3NDhaGA8y
MDU0MTExNTAyNTc0OFowezEnMCUGA1UEAwweVFAtTElOSyBTWVNURU1TIERFVklD
RSBST09UIENBMR0wGwYDVQQKDBRUUC1MSU5LIFNZU1RFTVMgSU5DLjEPMA0GA1UE
BwwGSXJ2aW5lMRMwEQYDVQQIDApDYWxpZm9ybmlhMQswCQYDVQQGEwJVUzBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABLwo8H9H6BoJDvcoewi4wPrPryVXir4z4yXV
n29R5XCAcFfKk06pYPupG6pjaKOLKWXnaOdPZThDFxwGLo3urV2jPDA6MAsGA1Ud
DwQEAwIBhjAMBgNVHRMEBTADAQH/MB0GA1UdDgQWBBRivfUtiHYsZBOKo80uZEwk
XhBkdDAKBggqhkjOPQQDAgNJADBGAiEA+7j5jemtXcGYN0unH+9rjVhVAL7WrsOi
5rbc0IIvD6MCIQCZuGGssu4Ygt2V8Vr0QF2fO9wxfNB3aRRMYQ+6lMrLGA==
-----END CERTIFICATE-----`;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  Accept: "application/json",
  Connection: "Keep-Alive",
};

interface TpapDiscovery {
  mac: string;
  tpap: {
    tls?: number;
    dac?: number | boolean;
    pake?: number[];
    port?: number;
    user_hash_type?: number;
  };
}

interface RegisterResult {
  dev_random: string;
  dev_salt: string;
  dev_share: string;
  cipher_suites: number;
  iterations: number;
  encryption: string;
  extra_crypt?: { type?: string; params?: Record<string, unknown> };
}

interface ShareResult {
  dev_confirm: string;
  sessionId?: string;
  stok?: string;
  start_seq: number | string;
  dac_ca?: string;
  dac_ica?: string;
  dac_proof?: string;
}

interface SessionState {
  key: Buffer;
  baseNonce: Buffer;
  sessionId: string;
  sequence: number;
}

export interface TpapTransportOptions {
  host: string;
  port?: number;
  credentials?: KasaCredentials;
  timeout?: number;
}

function hash(name: "sha1" | "sha256" | "md5", value: string | Buffer): Buffer {
  return createHash(name).update(value).digest();
}

function len8le(value: Buffer): Buffer {
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(value.length));
  return Buffer.concat([length, value]);
}

function bufferToBigInt(value: Buffer): bigint {
  return BigInt(`0x${value.toString("hex") || "0"}`);
}

function encodeScalar(value: bigint): Buffer {
  const hex = value.toString(16);
  const encoded = Buffer.from(hex.length % 2 === 0 ? hex : `0${hex}`, "hex");
  if (encoded.length % 2 === 0) return encoded;
  return (encoded[0] & 0x80) !== 0
    ? Buffer.concat([Buffer.from([0]), encoded])
    : encoded;
}

function hkdf(input: Buffer, salt: Buffer, info: string, length: number): Buffer {
  return Buffer.from(hkdfSync("sha256", input, salt, Buffer.from(info), length));
}

function hkdfExpand(label: string, input: Buffer, length: number): Buffer {
  return hkdf(input, Buffer.alloc(length), label, length);
}

function parseJson(body: Buffer, context: string): Record<string, unknown> {
  try {
    const result: unknown = JSON.parse(body.toString("utf-8"));
    if (typeof result !== "object" || result == null || Array.isArray(result)) {
      throw new Error("response is not an object");
    }
    return result as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `${context}: invalid JSON response (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

function resultObject<T>(response: Record<string, unknown>, context: string): T {
  const errorCode = Number(response.error_code);
  if (errorCode !== 0) throw new Error(`${context}: error_code=${errorCode}`);
  if (typeof response.result !== "object" || response.result == null) {
    throw new Error(`${context}: response missing result`);
  }
  return response.result as T;
}

function certificateFromValue(value: string): X509Certificate {
  const trimmed = value.trim();
  if (trimmed.includes("BEGIN CERTIFICATE")) return new X509Certificate(trimmed);
  return new X509Certificate(Buffer.from(trimmed, "base64"));
}

/**
 * TPAP transport for recent TP-Link firmware using SPAKE2+ and AES-CCM.
 *
 * Based on python-kasa's TPAP implementation and the MIT-licensed
 * ioBroker.tapo TypeScript implementation.
 */
export class TpapTransport {
  private readonly host: string;
  private readonly initialPort: number;
  private readonly credentials: KasaCredentials;
  private readonly timeout: number;
  private port: number;
  private mac = "";
  private usesDac = false;
  private pake: number[] = [];
  private userHashType = 0;
  private session: SessionState | null = null;
  private requestQueue: Promise<void> = Promise.resolve();

  constructor(options: TpapTransportOptions) {
    this.host = options.host;
    this.initialPort = options.port ?? 80;
    this.port = this.initialPort;
    this.credentials = options.credentials ?? { username: "", password: "" };
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
  }

  private get baseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  async handshake(): Promise<void> {
    this.session = null;
    await this.discover();
    if (!this.pake.includes(2)) {
      throw new Error(
        `TPAP handshake failed for ${this.host}: unsupported PAKE modes [${this.pake.join(", ")}]`,
      );
    }

    const userRandom = randomBytes(32);
    const registerResult = await this.login<RegisterResult>(
      {
        sub_method: "pake_register",
        username: this.authUsername(),
        user_random: userRandom.toString("base64"),
        cipher_suites: [1],
        encryption: ["aes_128_ccm"],
        passcode_type: "userpw",
        stok: null,
      },
      "pake_register",
    );
    if (
      Number(registerResult.cipher_suites) !== 1 ||
      registerResult.encryption !== "aes_128_ccm"
    ) {
      throw new Error(
        `TPAP handshake failed for ${this.host}: unsupported suite/cipher ` +
          `${registerResult.cipher_suites}/${registerResult.encryption}`,
      );
    }

    const exchange = this.createExchange(
      registerResult,
      this.resolveCredential(registerResult),
      userRandom,
    );
    const dacNonce = this.usesDac ? randomBytes(32) : undefined;
    const shareResult = await this.login<ShareResult>(
      {
        sub_method: "pake_share",
        user_share: exchange.userShare.toString("base64"),
        user_confirm: exchange.userConfirm.toString("base64"),
        ...(dacNonce ? { dac_nonce: dacNonce.toString("base64") } : {}),
      },
      "pake_share",
    );

    const deviceConfirm = Buffer.from(shareResult.dev_confirm ?? "", "base64");
    if (
      deviceConfirm.length !== exchange.deviceConfirm.length ||
      !timingSafeEqual(deviceConfirm, exchange.deviceConfirm)
    ) {
      throw new Error(`TPAP confirmation mismatch from ${this.host}`);
    }
    if (dacNonce) this.verifyDacProof(shareResult, exchange.sharedKey, dacNonce);

    const sessionId = String(shareResult.sessionId ?? shareResult.stok ?? "");
    const sequence = Number(shareResult.start_seq);
    if (!sessionId || !Number.isInteger(sequence) || sequence < 0) {
      throw new Error(`TPAP handshake failed for ${this.host}: missing session fields`);
    }
    this.session = {
      key: hkdf(
        exchange.sharedKey,
        Buffer.from("tp-kdf-salt-aes128-key"),
        "tp-kdf-info-aes128-key",
        16,
      ),
      baseNonce: hkdf(
        exchange.sharedKey,
        Buffer.from("tp-kdf-salt-aes128-iv"),
        "tp-kdf-info-aes128-iv",
        NONCE_LENGTH,
      ),
      sessionId,
      sequence,
    };
  }

  async send(request: object): Promise<object> {
    return await this.runExclusive(async () => {
      try {
        return await this.sendOnce(request);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("response sequence mismatch")
        ) {
          this.session = null;
          throw error;
        }
        if (!this.session || !this.isSessionError(error)) throw error;
        this.session = null;
        return await this.sendOnce(request);
      }
    });
  }

  close(): void {
    this.session = null;
  }

  private async discover(): Promise<void> {
    this.port = this.initialPort;
    const response = await this.postJson(
      { method: "login", params: { sub_method: "discover" } },
      "TPAP discovery",
    );
    const result = resultObject<TpapDiscovery>(
      response,
      `TPAP discovery at ${this.host}`,
    );
    if (!result.tpap) {
      throw new Error(`TPAP discovery at ${this.host}: response missing tpap metadata`);
    }
    if (Number(result.tpap.tls ?? 0) !== 0) {
      throw new Error(`TPAP discovery at ${this.host}: TLS mode is not supported`);
    }
    this.mac = String(result.mac ?? "");
    this.port = Number(result.tpap.port) || this.initialPort;
    this.usesDac = Boolean(result.tpap.dac);
    this.pake = Array.isArray(result.tpap.pake) ? result.tpap.pake.map(Number) : [];
    this.userHashType = Number(result.tpap.user_hash_type ?? 0);
  }

  private async login<T>(params: Record<string, unknown>, step: string): Promise<T> {
    const response = await this.postJson({ method: "login", params }, `TPAP ${step}`);
    return resultObject<T>(response, `TPAP ${step} at ${this.host}`);
  }

  private async postJson(
    payload: object,
    context: string,
  ): Promise<Record<string, unknown>> {
    const response = await httpPost(
      `${this.baseUrl}/`,
      JSON.stringify(payload),
      JSON_HEADERS,
      this.timeout,
    );
    if (response.statusCode !== 200) {
      throw new Error(
        `${context} failed for ${this.host}: status ${response.statusCode}`,
      );
    }
    return parseJson(response.body, `${context} at ${this.host}`);
  }

  private authUsername(): string {
    const algorithm = this.userHashType === 1 ? "sha256" : "md5";
    const digest = hash(algorithm, "admin").toString("hex");
    return this.userHashType === 1 ? digest.toUpperCase() : digest;
  }

  private resolveCredential(register: RegisterResult): string {
    const extra = register.extra_crypt;
    if (!extra) return `${this.credentials.username}/${this.credentials.password}`;
    if (String(extra.type ?? "").toLowerCase() === "password_shadow") {
      const passwordId = Number(extra.params?.passwd_id ?? 0);
      if (passwordId === 2) {
        return hash("sha1", this.credentials.password).toString("hex");
      }
      if (passwordId === 3) {
        const mac = this.mac
          .replace(/[:-]/g, "")
          .match(/.{2}/g)
          ?.join(":")
          .toUpperCase();
        if (!mac)
          throw new Error(`TPAP handshake failed for ${this.host}: invalid MAC`);
        const usernameHash = hash("md5", this.credentials.username).toString("hex");
        return hash("sha1", `${usernameHash}_${mac}`).toString("hex");
      }
      throw new Error(
        `TPAP handshake failed for ${this.host}: unsupported password shadow ${passwordId}`,
      );
    }
    throw new Error(
      `TPAP handshake failed for ${this.host}: unsupported credential transform ${extra.type}`,
    );
  }

  private createExchange(
    register: RegisterResult,
    credential: string,
    userRandom: Buffer,
  ): {
    userShare: Buffer;
    userConfirm: Buffer;
    deviceConfirm: Buffer;
    sharedKey: Buffer;
  } {
    const deviceRandom = Buffer.from(register.dev_random, "base64");
    const deviceSalt = Buffer.from(register.dev_salt, "base64");
    const deviceShare = Buffer.from(register.dev_share, "base64");
    const iterations = Number(register.iterations);
    if (
      deviceRandom.length === 0 ||
      deviceSalt.length === 0 ||
      deviceShare.length === 0 ||
      !Number.isInteger(iterations) ||
      iterations <= 0 ||
      iterations > MAX_PBKDF2_ITERATIONS
    ) {
      throw new Error(`TPAP register response from ${this.host} is incomplete`);
    }

    const Point = p256.ProjectivePoint;
    const order = p256.CURVE.n;
    const mPoint = Point.fromHex(P256_M);
    const nPoint = Point.fromHex(P256_N);
    const derived = pbkdf2Sync(credential, deviceSalt, iterations, 80, "sha256");
    const w0 = bufferToBigInt(derived.subarray(0, 40)) % order;
    const w1 = bufferToBigInt(derived.subarray(40)) % order;
    const x = bufferToBigInt(Buffer.from(p256.utils.randomPrivateKey()));
    const userPoint = Point.BASE.multiply(x).add(mPoint.multiply(w0));
    const userShare = Buffer.from(userPoint.toRawBytes(false));
    const remotePoint = Point.fromHex(deviceShare);
    const remoteShare = Buffer.from(remotePoint.toRawBytes(false));
    const remotePrime = remotePoint.subtract(nPoint.multiply(w0));
    const z = Buffer.from(remotePrime.multiply(x).toRawBytes(false));
    const v = Buffer.from(remotePrime.multiply(w1).toRawBytes(false));
    const m = Buffer.from(mPoint.toRawBytes(false));
    const n = Buffer.from(nPoint.toRawBytes(false));
    const contextHash = hash(
      "sha256",
      Buffer.concat([PAKE_CONTEXT_TAG, userRandom, deviceRandom]),
    );
    const transcript = Buffer.concat([
      len8le(contextHash),
      len8le(Buffer.alloc(0)),
      len8le(Buffer.alloc(0)),
      len8le(m),
      len8le(n),
      len8le(userShare),
      len8le(remoteShare),
      len8le(z),
      len8le(v),
      len8le(encodeScalar(w0)),
    ]);
    const transcriptHash = hash("sha256", transcript);
    const confirmationKeys = hkdfExpand("ConfirmationKeys", transcriptHash, 64);
    return {
      userShare,
      userConfirm: createHmac("sha256", confirmationKeys.subarray(0, 32))
        .update(remoteShare)
        .digest(),
      deviceConfirm: createHmac("sha256", confirmationKeys.subarray(32))
        .update(userShare)
        .digest(),
      sharedKey: hkdfExpand("SharedKey", transcriptHash, 32),
    };
  }

  private verifyDacProof(
    result: ShareResult,
    sharedKey: Buffer,
    dacNonce: Buffer,
  ): void {
    if (!result.dac_ca || !result.dac_proof) {
      throw new Error(`TPAP handshake failed for ${this.host}: missing DAC proof`);
    }
    const deviceCertificate = certificateFromValue(result.dac_ca);
    const rootCertificate = new X509Certificate(TPAP_ROOT_CA);
    const issuerCertificate = result.dac_ica
      ? certificateFromValue(result.dac_ica)
      : rootCertificate;
    const now = Date.now();
    for (const certificate of [deviceCertificate, issuerCertificate]) {
      if (
        now < Date.parse(certificate.validFrom) ||
        now > Date.parse(certificate.validTo)
      ) {
        throw new Error(
          `TPAP handshake failed for ${this.host}: expired DAC certificate`,
        );
      }
    }
    if (!deviceCertificate.verify(issuerCertificate.publicKey)) {
      throw new Error(
        `TPAP handshake failed for ${this.host}: invalid DAC certificate`,
      );
    }
    if (result.dac_ica && !issuerCertificate.verify(rootCertificate.publicKey)) {
      throw new Error(`TPAP handshake failed for ${this.host}: invalid DAC chain`);
    }
    if (
      !verify(
        "sha256",
        Buffer.concat([sharedKey, dacNonce]),
        deviceCertificate.publicKey,
        Buffer.from(result.dac_proof, "base64"),
      )
    ) {
      throw new Error(`TPAP handshake failed for ${this.host}: invalid DAC proof`);
    }
  }

  private async sendOnce(request: object): Promise<object> {
    if (!this.session) await this.handshake();
    const session = this.session!;
    const sequence = session.sequence;
    const nonce = Buffer.from(session.baseNonce);
    nonce.writeUInt32BE(sequence, nonce.length - 4);
    const plaintext = Buffer.from(JSON.stringify(request));
    const cipher = createCipheriv("aes-128-ccm", session.key, nonce, {
      authTagLength: TAG_LENGTH,
    });
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const sequenceBytes = Buffer.alloc(4);
    sequenceBytes.writeUInt32BE(sequence);
    const payload = Buffer.concat([sequenceBytes, ciphertext, cipher.getAuthTag()]);
    session.sequence += 1;

    const response = await httpPost(
      `${this.baseUrl}/stok=${session.sessionId}/ds`,
      payload,
      { "Content-Type": "application/octet-stream", Connection: "Keep-Alive" },
      this.timeout,
    );
    if (response.statusCode !== 200) {
      throw new Error(
        `TPAP request failed for ${this.host}: status ${response.statusCode}`,
      );
    }
    if (response.body[0] === 0x7b) {
      const outer = parseJson(response.body, `TPAP request at ${this.host}`);
      const errorCode = Number(outer.error_code);
      if (errorCode === 0) {
        throw new Error(`TPAP request at ${this.host}: unencrypted success response`);
      }
      throw new Error(`TPAP session error from ${this.host}: error_code=${errorCode}`);
    }
    if (response.body.length < 4 + TAG_LENGTH) {
      throw new Error(`TPAP response from ${this.host} is too short`);
    }
    const responseSequence = response.body.readUInt32BE(0);
    if (responseSequence !== sequence) {
      throw new Error(
        `TPAP response sequence mismatch from ${this.host}: ` +
          `expected ${sequence}, received ${responseSequence}`,
      );
    }
    const responseNonce = Buffer.from(session.baseNonce);
    responseNonce.writeUInt32BE(responseSequence, responseNonce.length - 4);
    const encrypted = response.body.subarray(4, -TAG_LENGTH);
    const tag = response.body.subarray(-TAG_LENGTH);
    const decipher = createDecipheriv("aes-128-ccm", session.key, responseNonce, {
      authTagLength: TAG_LENGTH,
    });
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return parseJson(decrypted, `TPAP response at ${this.host}`);
  }

  private isSessionError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.message.includes("error_code=-2203") ||
        error.message.includes("error_code=-40401") ||
        error.message.includes("error_code=-40404") ||
        error.message.includes("ECONNRESET"))
    );
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.requestQueue;
    let release: () => void = () => {};
    this.requestQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
