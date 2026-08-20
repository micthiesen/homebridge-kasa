import {
  type CipherCCM,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  type DecipherCCM,
  hkdfSync,
  pbkdf2Sync,
} from "node:crypto";
import { p256 } from "@noble/curves/p256";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { httpPost } = vi.hoisted(() => ({ httpPost: vi.fn() }));

vi.mock("../../src/klap/http.js", () => ({ httpPost }));

import { TpapTransport } from "../../src/klap/TpapTransport.js";

const KEY = Buffer.from("00112233445566778899aabbccddeeff", "hex");
const BASE_NONCE = Buffer.from("010203040506070800000000", "hex");
const M = p256.ProjectivePoint.fromHex(
  "02886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f",
);
const N = p256.ProjectivePoint.fromHex(
  "03d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b49",
);

function sha256(value: Buffer): Buffer {
  return createHash("sha256").update(value).digest();
}

function len8le(value: Buffer): Buffer {
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(value.length));
  return Buffer.concat([length, value]);
}

function scalar(value: bigint): Buffer {
  const hex = value.toString(16);
  const encoded = Buffer.from(hex.length % 2 === 0 ? hex : `0${hex}`, "hex");
  if (encoded.length % 2 === 0) return encoded;
  return (encoded[0] & 0x80) !== 0
    ? Buffer.concat([Buffer.from([0]), encoded])
    : encoded;
}

function expand(label: string, input: Buffer, length: number): Buffer {
  return Buffer.from(
    hkdfSync("sha256", input, Buffer.alloc(length), Buffer.from(label), length),
  );
}

function nonce(sequence: number): Buffer {
  const result = Buffer.from(BASE_NONCE);
  result.writeUInt32BE(sequence, result.length - 4);
  return result;
}

function decryptFrame(frame: Buffer): { sequence: number; request: object } {
  const sequence = frame.readUInt32BE(0);
  const ciphertext = frame.subarray(4, -16);
  const tag = frame.subarray(-16);
  const decipher = createDecipheriv("aes-128-ccm", KEY, nonce(sequence), {
    authTagLength: 16,
  }) as DecipherCCM;
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return { sequence, request: JSON.parse(plaintext.toString("utf-8")) };
}

function encryptFrame(sequence: number, response: object): Buffer {
  const cipher = createCipheriv("aes-128-ccm", KEY, nonce(sequence), {
    authTagLength: 16,
  }) as CipherCCM;
  const plaintext = Buffer.from(JSON.stringify(response));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(sequence);
  return Buffer.concat([prefix, ciphertext, cipher.getAuthTag()]);
}

function establishedTransport(): TpapTransport {
  const transport = new TpapTransport({ host: "device.test" });
  Reflect.set(transport, "session", {
    key: KEY,
    baseNonce: BASE_NONCE,
    sessionId: "session-token",
    sequence: 17,
  });
  return transport;
}

describe("TpapTransport secure session", () => {
  beforeEach(() => {
    httpPost.mockReset();
  });

  it("encrypts requests and decrypts responses with the negotiated sequence", async () => {
    httpPost.mockImplementation(async (_url, body: Buffer) => {
      const { sequence, request } = decryptFrame(body);
      expect(sequence).toBe(17);
      expect(request).toEqual({ method: "get_device_info" });
      return {
        statusCode: 200,
        headers: {},
        body: encryptFrame(sequence, { error_code: 0, result: { device_on: true } }),
      };
    });

    const response = await establishedTransport().send({ method: "get_device_info" });

    expect(response).toEqual({ error_code: 0, result: { device_on: true } });
    expect(httpPost).toHaveBeenCalledWith(
      "http://device.test:80/stok=session-token/ds",
      expect.any(Buffer),
      expect.objectContaining({ "Content-Type": "application/octet-stream" }),
      10_000,
    );
  });

  it("negotiates SPAKE2+ and sends an authenticated request", async () => {
    const password = "fixture-password";
    const deviceRandom = Buffer.alloc(32, 0x22);
    const salt = Buffer.alloc(16, 0x33);
    const credential = createHash("sha1").update(password).digest("hex");
    const derived = pbkdf2Sync(credential, salt, 3_000, 80, "sha256");
    const order = p256.CURVE.n;
    const w0 = BigInt(`0x${derived.subarray(0, 40).toString("hex")}`) % order;
    const w1 = BigInt(`0x${derived.subarray(40).toString("hex")}`) % order;
    const y = 7n;
    const devicePoint = p256.ProjectivePoint.BASE.multiply(y).add(N.multiply(w0));
    const deviceShare = Buffer.from(devicePoint.toRawBytes(false));
    let sharedKey: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let userRandom = Buffer.alloc(0);

    httpPost.mockImplementation(async (url: string, body: string | Buffer) => {
      if (url.endsWith("/stok=fixture-session/ds")) {
        const sessionKey = Buffer.from(
          hkdfSync(
            "sha256",
            sharedKey,
            Buffer.from("tp-kdf-salt-aes128-key"),
            Buffer.from("tp-kdf-info-aes128-key"),
            16,
          ),
        );
        const sessionNonce = Buffer.from(
          hkdfSync(
            "sha256",
            sharedKey,
            Buffer.from("tp-kdf-salt-aes128-iv"),
            Buffer.from("tp-kdf-info-aes128-iv"),
            12,
          ),
        );
        const frame = Buffer.from(body);
        const sequence = frame.readUInt32BE(0);
        const frameNonce = Buffer.from(sessionNonce);
        frameNonce.writeUInt32BE(sequence, 8);
        const decipher = createDecipheriv("aes-128-ccm", sessionKey, frameNonce, {
          authTagLength: 16,
        }) as DecipherCCM;
        decipher.setAuthTag(frame.subarray(-16));
        const plaintext = Buffer.concat([
          decipher.update(frame.subarray(4, -16)),
          decipher.final(),
        ]);
        expect(JSON.parse(plaintext.toString())).toEqual({
          method: "get_device_info",
        });

        const cipher = createCipheriv("aes-128-ccm", sessionKey, frameNonce, {
          authTagLength: 16,
        }) as CipherCCM;
        const response = Buffer.from(
          JSON.stringify({ error_code: 0, result: { nickname: "Fixture Plug" } }),
        );
        const prefix = Buffer.alloc(4);
        prefix.writeUInt32BE(sequence);
        return {
          statusCode: 200,
          headers: {},
          body: Buffer.concat([
            prefix,
            cipher.update(response),
            cipher.final(),
            cipher.getAuthTag(),
          ]),
        };
      }

      const request = JSON.parse(String(body));
      if (request.params.sub_method === "discover") {
        return {
          statusCode: 200,
          headers: {},
          body: Buffer.from(
            JSON.stringify({
              error_code: 0,
              result: { mac: "78:8C:B5:00:00:01", tpap: { tls: 0, dac: 0, pake: [2] } },
            }),
          ),
        };
      }
      if (request.params.sub_method === "pake_register") {
        userRandom = Buffer.from(request.params.user_random, "base64");
        expect(request.params.username).toBe(
          createHash("md5").update("admin").digest("hex"),
        );
        return {
          statusCode: 200,
          headers: {},
          body: Buffer.from(
            JSON.stringify({
              error_code: 0,
              result: {
                dev_random: deviceRandom.toString("base64"),
                dev_salt: salt.toString("base64"),
                dev_share: deviceShare.toString("base64"),
                cipher_suites: 1,
                iterations: 3_000,
                encryption: "aes_128_ccm",
                extra_crypt: { type: "password_shadow", params: { passwd_id: 2 } },
              },
            }),
          ),
        };
      }

      const userShare = Buffer.from(request.params.user_share, "base64");
      const userPoint = p256.ProjectivePoint.fromHex(userShare);
      const userPrime = userPoint.subtract(M.multiply(w0));
      const z = Buffer.from(userPrime.multiply(y).toRawBytes(false));
      const v = Buffer.from(
        p256.ProjectivePoint.BASE.multiply((w1 * y) % order).toRawBytes(false),
      );
      const contextHash = sha256(
        Buffer.concat([Buffer.from("PAKE V1"), userRandom, deviceRandom]),
      );
      const transcript = Buffer.concat([
        len8le(contextHash),
        len8le(Buffer.alloc(0)),
        len8le(Buffer.alloc(0)),
        len8le(Buffer.from(M.toRawBytes(false))),
        len8le(Buffer.from(N.toRawBytes(false))),
        len8le(userShare),
        len8le(deviceShare),
        len8le(z),
        len8le(v),
        len8le(scalar(w0)),
      ]);
      const confirmationKeys = expand("ConfirmationKeys", sha256(transcript), 64);
      expect(request.params.user_confirm).toBe(
        createHmac("sha256", confirmationKeys.subarray(0, 32))
          .update(deviceShare)
          .digest("base64"),
      );
      sharedKey = expand("SharedKey", sha256(transcript), 32);
      return {
        statusCode: 200,
        headers: {},
        body: Buffer.from(
          JSON.stringify({
            error_code: 0,
            result: {
              dev_confirm: createHmac("sha256", confirmationKeys.subarray(32))
                .update(userShare)
                .digest("base64"),
              sessionId: "fixture-session",
              start_seq: 41,
            },
          }),
        ),
      };
    });

    const transport = new TpapTransport({
      host: "device.test",
      credentials: { username: "fixture-user", password },
    });
    await expect(transport.send({ method: "get_device_info" })).resolves.toEqual({
      error_code: 0,
      result: { nickname: "Fixture Plug" },
    });
    expect(httpPost).toHaveBeenCalledTimes(4);
  });

  it("serializes concurrent requests so sequence numbers cannot race", async () => {
    let active = 0;
    let maximumActive = 0;
    const sequences: number[] = [];
    httpPost.mockImplementation(async (_url, body: Buffer) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const { sequence } = decryptFrame(body);
      sequences.push(sequence);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return {
        statusCode: 200,
        headers: {},
        body: encryptFrame(sequence, { error_code: 0, result: { sequence } }),
      };
    });
    const transport = establishedTransport();

    await Promise.all([
      transport.send({ method: "first" }),
      transport.send({ method: "second" }),
    ]);

    expect(maximumActive).toBe(1);
    expect(sequences).toEqual([17, 18]);
  });

  it("rejects unencrypted success responses", async () => {
    httpPost.mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: Buffer.from('{"error_code":0,"result":{"device_on":true}}'),
    });

    await expect(
      establishedTransport().send({ method: "get_device_info" }),
    ).rejects.toThrow("unencrypted success response");
  });

  it("rejects authenticated responses from a different sequence", async () => {
    httpPost.mockImplementation(async (_url, body: Buffer) => {
      const { sequence } = decryptFrame(body);
      return {
        statusCode: 200,
        headers: {},
        body: encryptFrame(sequence + 1, { error_code: 0, result: {} }),
      };
    });

    await expect(
      establishedTransport().send({ method: "get_device_info" }),
    ).rejects.toThrow("response sequence mismatch");
  });

  it("rejects excessive password-derivation work before curve processing", () => {
    const transport = new TpapTransport({ host: "device.test" });
    const createExchange = Reflect.get(transport, "createExchange").bind(transport);

    expect(() =>
      createExchange(
        {
          dev_random: Buffer.alloc(32).toString("base64"),
          dev_salt: Buffer.alloc(16).toString("base64"),
          dev_share: Buffer.alloc(33).toString("base64"),
          cipher_suites: 1,
          iterations: 100_001,
          encryption: "aes_128_ccm",
        },
        "credential",
        Buffer.alloc(32),
      ),
    ).toThrow("register response");
  });
});
