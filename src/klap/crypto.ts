/**
 * Cryptographic operations for KLAP v2 and AES transport protocols.
 *
 * Reference: python-kasa klapprotocol.py, klaptransport.py, aestransport.py
 * Uses only node:crypto (no external dependencies).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  constants as cryptoConstants,
  generateKeyPairSync,
  privateDecrypt,
  randomBytes,
} from "node:crypto";

import type { KasaCredentials } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

function sha1(data: Buffer): Buffer {
  return createHash("sha1").update(data).digest();
}

function sha1Hex(data: Buffer): string {
  return createHash("sha1").update(data).digest("hex");
}

/** Pack a number as a big-endian signed 32-bit integer. */
function packSignedInt32BE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(value, 0);
  return buf;
}

/** Read the last 4 bytes of a buffer as a big-endian signed 32-bit integer. */
function readSignedInt32BE(buf: Buffer): number {
  return buf.readInt32BE(buf.length - 4);
}

/** Apply PKCS7 padding to data for a 16-byte block size. */
function pkcs7Pad(data: Buffer): Buffer {
  const blockSize = 16;
  const padLen = blockSize - (data.length % blockSize);
  const padding = Buffer.alloc(padLen, padLen);
  return Buffer.concat([data, padding]);
}

/** Remove PKCS7 padding. */
function pkcs7Unpad(data: Buffer): Buffer {
  const padLen = data[data.length - 1];
  if (padLen < 1 || padLen > 16) {
    throw new Error(`Invalid PKCS7 padding value: ${padLen}`);
  }
  return data.subarray(0, data.length - padLen);
}

// ---------------------------------------------------------------------------
// KLAP v2
// ---------------------------------------------------------------------------

/**
 * Generate a random local seed for the KLAP handshake.
 * @param size - Number of random bytes (default 16).
 */
export function generateKlapLocalSeed(size: number = 16): Buffer {
  return randomBytes(size);
}

/**
 * Generate the KLAP v2 auth hash from credentials.
 *
 * KLAP v2 uses: SHA256(SHA1(username) + SHA1(password))
 *
 * Reference: KlapTransportV2.generate_auth_hash in klaptransport.py
 */
export function generateKlapAuthHash(credentials: KasaCredentials): Buffer {
  const usernameHash = sha1(Buffer.from(credentials.username));
  const passwordHash = sha1(Buffer.from(credentials.password));
  return sha256(Buffer.concat([usernameHash, passwordHash]));
}

/**
 * Generate the local auth hash for handshake1 verification.
 *
 * The device sends SHA256(local_seed + remote_seed + auth_hash) as the
 * server_hash in its handshake1 response. We compute the same to verify.
 *
 * KLAP v2 uses: SHA256(local_seed + remote_seed + auth_hash)
 *
 * Reference: KlapTransportV2.handshake1_seed_auth_hash
 */
export function generateKlapLocalAuthHash(
  localSeed: Buffer,
  remoteSeed: Buffer,
  authHash: Buffer,
): Buffer {
  return sha256(Buffer.concat([localSeed, remoteSeed, authHash]));
}

/**
 * Generate the remote auth hash for handshake2.
 *
 * Sent to the device in handshake2 so it can verify the client.
 *
 * KLAP v2 uses: SHA256(remote_seed + local_seed + auth_hash)
 *
 * Reference: KlapTransportV2.handshake2_seed_auth_hash
 */
export function generateKlapRemoteAuthHash(
  remoteSeed: Buffer,
  localSeed: Buffer,
  authHash: Buffer,
): Buffer {
  return sha256(Buffer.concat([remoteSeed, localSeed, authHash]));
}

/**
 * Derive the KLAP encryption session keys from seeds and auth hash.
 *
 * Returns:
 * - key:  AES-128 key (first 16 bytes of SHA256("lsk" + local + remote + auth))
 * - iv:   First 12 bytes of SHA256("iv" + local + remote + auth)
 * - sig:  First 28 bytes of SHA256("ldk" + local + remote + auth)
 * - seq:  Last 4 bytes of full IV hash, interpreted as signed big-endian int32
 *
 * Reference: KlapEncryptionSession.__init__ in klapprotocol.py
 */
export function deriveKlapKeys(
  localSeed: Buffer,
  remoteSeed: Buffer,
  authHash: Buffer,
): { key: Buffer; iv: Buffer; sig: Buffer; seq: number } {
  const keyPayload = Buffer.concat([
    Buffer.from("lsk"),
    localSeed,
    remoteSeed,
    authHash,
  ]);
  const key = sha256(keyPayload).subarray(0, 16);

  const ivPayload = Buffer.concat([Buffer.from("iv"), localSeed, remoteSeed, authHash]);
  const fullIv = sha256(ivPayload);
  const iv = fullIv.subarray(0, 12);
  const seq = readSignedInt32BE(fullIv);

  const sigPayload = Buffer.concat([
    Buffer.from("ldk"),
    localSeed,
    remoteSeed,
    authHash,
  ]);
  const sig = sha256(sigPayload).subarray(0, 28);

  return { key, iv, sig, seq };
}

/**
 * Encrypt data using the KLAP protocol.
 *
 * 1. Increment the sequence number
 * 2. Build the full 16-byte IV: iv(12 bytes) + packSignedInt32BE(seq)
 * 3. AES-128-CBC encrypt with PKCS7 padding
 * 4. Compute signature: SHA256(sig + packSignedInt32BE(seq) + ciphertext)
 * 5. Return signature(32 bytes) + ciphertext, and the new sequence number
 *
 * Reference: KlapEncryptionSession.encrypt in klapprotocol.py
 */
export function klapEncrypt(
  data: Buffer,
  key: Buffer,
  iv: Buffer,
  sig: Buffer,
  seq: number,
): { encryptedData: Buffer; seq: number } {
  const newSeq = seq + 1;
  const seqBytes = packSignedInt32BE(newSeq);
  const fullIv = Buffer.concat([iv, seqBytes]);

  // AES-128-CBC encrypt with PKCS7 padding
  const padded = pkcs7Pad(data);
  const cipher = createCipheriv("aes-128-cbc", key, fullIv);
  cipher.setAutoPadding(false); // we already padded manually
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);

  // Signature: SHA256(sig + seq_bytes + ciphertext)
  const signature = sha256(Buffer.concat([sig, seqBytes, ciphertext]));

  return {
    encryptedData: Buffer.concat([signature, ciphertext]),
    seq: newSeq,
  };
}

/**
 * Decrypt data using the KLAP protocol.
 *
 * 1. The first 32 bytes are the HMAC-SHA256 signature (skipped for now,
 *    the device is trusted after handshake)
 * 2. The remaining bytes are AES-128-CBC encrypted with PKCS7 padding
 * 3. The IV is iv(12 bytes) + packSignedInt32BE(seq) (same seq as encrypt)
 *
 * Reference: KlapEncryptionSession.decrypt in klapprotocol.py
 */
export function klapDecrypt(
  data: Buffer,
  key: Buffer,
  iv: Buffer,
  sig: Buffer,
  seq: number,
): Buffer {
  const seqBytes = packSignedInt32BE(seq);
  const fullIv = Buffer.concat([iv, seqBytes]);

  const ciphertext = data.subarray(32);

  // Verify signature
  const expectedSig = sha256(Buffer.concat([sig, seqBytes, ciphertext]));
  const actualSig = data.subarray(0, 32);
  if (!actualSig.equals(expectedSig)) {
    throw new Error("KLAP decrypt: signature verification failed");
  }

  const decipher = createDecipheriv("aes-128-cbc", key, fullIv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return pkcs7Unpad(decrypted);
}

// ---------------------------------------------------------------------------
// AES transport
// ---------------------------------------------------------------------------

/**
 * Generate an RSA 1024-bit key pair for the AES handshake.
 * Returns PEM-encoded public and private keys.
 *
 * Reference: KeyPair.create_key_pair in aestransport.py
 */
export function generateAesKeyPair(): {
  publicKey: string;
  privateKey: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 1024,
    publicExponent: 65537,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });
  return { publicKey, privateKey };
}

/**
 * Decrypt the AES session key returned by the device during handshake.
 *
 * The device encrypts a 32-byte payload with our public key using PKCS1 v1.5.
 * The first 16 bytes are the AES key, the last 16 bytes are the IV.
 *
 * @param encryptedKey - Base64-encoded encrypted key from the handshake response.
 * @param privateKey - PEM-encoded RSA private key.
 *
 * Reference: KeyPair.decrypt_handshake_key and AesEncyptionSession.create_from_keypair
 */
export function decryptAesSessionKey(
  encryptedKey: string,
  privateKey: string,
): { key: Buffer; iv: Buffer } {
  const encryptedBytes = Buffer.from(encryptedKey, "base64");
  const decrypted = privateDecrypt(
    {
      key: privateKey,
      padding: cryptoConstants.RSA_PKCS1_PADDING,
    },
    encryptedBytes,
  );

  return {
    key: decrypted.subarray(0, 16),
    iv: decrypted.subarray(16, 32),
  };
}

/**
 * AES-128-CBC encrypt a string payload, returning base64.
 *
 * Uses PKCS7 padding, matching the python-kasa AesEncyptionSession.encrypt.
 *
 * Reference: AesEncyptionSession.encrypt in aestransport.py
 */
export function aesEncrypt(data: string, key: Buffer, iv: Buffer): string {
  const padded = pkcs7Pad(Buffer.from(data, "utf-8"));
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted.toString("base64");
}

/**
 * AES-128-CBC decrypt a base64 payload, returning the plaintext string.
 *
 * Uses PKCS7 unpadding, matching the python-kasa AesEncyptionSession.decrypt.
 *
 * Reference: AesEncyptionSession.decrypt in aestransport.py
 */
export function aesDecrypt(data: string, key: Buffer, iv: Buffer): string {
  const encrypted = Buffer.from(data, "base64");
  const decipher = createDecipheriv("aes-128-cbc", key, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return pkcs7Unpad(decrypted).toString("utf-8");
}

/**
 * Hash credentials for the AES login_device call.
 *
 * username: base64(sha1_hex(username))
 * password: base64(password)  (login v1, which is the default for Kasa devices)
 *
 * Reference: AesTransport.hash_credentials in aestransport.py (login_v2=False path)
 */
export function generateAesLoginHash(credentials: KasaCredentials): {
  username: string;
  password: string;
} {
  const usernameHex = sha1Hex(Buffer.from(credentials.username));
  const username = Buffer.from(usernameHex).toString("base64");
  const password = Buffer.from(credentials.password).toString("base64");
  return { username, password };
}
