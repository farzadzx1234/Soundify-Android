/**
 * Frontend & Android Mobile Transport Cryptography Service
 *
 * Implements client-side:
 * - ECDH (P-256) ephemeral key agreement
 * - HKDF-SHA256 session key derivation
 * - Authenticated AES-256-GCM encryption & decryption
 * - HMAC-SHA256 request signing and replay prevention
 *
 * Fully compliant with Web Crypto API (browser, Android WebView, Node.js).
 */

import type { EncryptedEnvelope, SecurityHandshakeResult } from "./types";

const APP_SECRET_BASE = "soundify-mobile-transport-secret-v3-e2ee-production-grade-shield-2026";

function getCryptoSubtle(): SubtleCrypto {
  if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
    return window.crypto.subtle;
  }
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  throw new Error("Web Crypto API (crypto.subtle) is not available in this runtime environment");
}

function getRandomValues(array: Uint8Array): Uint8Array {
  if (typeof window !== "undefined" && window.crypto) {
    return window.crypto.getRandomValues(array);
  }
  if (typeof globalThis !== "undefined" && globalThis.crypto) {
    return globalThis.crypto.getRandomValues(array);
  }
  for (let i = 0; i < array.length; i++) {
    array[i] = Math.floor(Math.random() * 256);
  }
  return array;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) {
    throw new Error("Invalid hex string: length must be even");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const val = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(val)) {
      throw new Error("Invalid hex character encountered");
    }
    bytes[i] = val;
  }
  return bytes;
}

export function getRandomHex(byteLength = 16): string {
  const bytes = getRandomValues(new Uint8Array(byteLength));
  return bytesToHex(bytes);
}

// ---------------------------------------------------------------------------
// 1. Default / Pre-Shared Key Derivation
// ---------------------------------------------------------------------------

let cachedDefaultKeys: { encKey: CryptoKey; macKey: CryptoKey } | null = null;

export async function getDefaultClientKeys(): Promise<{ encKey: CryptoKey; macKey: CryptoKey }> {
  if (cachedDefaultKeys) return cachedDefaultKeys;

  const subtle = getCryptoSubtle();
  const encoder = new TextEncoder();
  const baseSecretBytes = encoder.encode(APP_SECRET_BASE);
  const salt = encoder.encode("soundify-mobile-v3-salt");

  const baseKey = await subtle.importKey("raw", baseSecretBytes, "HKDF", false, [
    "deriveKey",
    "deriveBits",
  ]);

  const encKey = await subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: encoder.encode("soundify-payload-encryption-key"),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const macKey = await subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: encoder.encode("soundify-payload-signing-key"),
    },
    baseKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );

  cachedDefaultKeys = { encKey, macKey };
  return cachedDefaultKeys;
}

// ---------------------------------------------------------------------------
// 2. ECDH Key Exchange & Handshake
// ---------------------------------------------------------------------------

export interface ClientEcdhState {
  keyPair: CryptoKeyPair;
  publicKeyHex: string;
  clientNonceHex: string;
}

export async function generateClientEcdh(): Promise<ClientEcdhState> {
  const subtle = getCryptoSubtle();
  const keyPair = await subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits", "deriveKey"],
  );

  const rawPub = await subtle.exportKey("raw", keyPair.publicKey);
  const publicKeyHex = bytesToHex(new Uint8Array(rawPub));
  const clientNonceHex = getRandomHex(16);

  return { keyPair, publicKeyHex, clientNonceHex };
}

export async function deriveSessionKeysFromPeer(
  clientPrivateKey: CryptoKey,
  serverPublicKeyHex: string,
  clientNonceHex: string,
  serverNonceHex: string,
): Promise<{ encKey: CryptoKey; macKey: CryptoKey }> {
  const subtle = getCryptoSubtle();
  const serverPubBytes = hexToBytes(serverPublicKeyHex);

  const serverPublicKey = await subtle.importKey(
    "raw",
    serverPubBytes as unknown as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  const sharedBits = await subtle.deriveBits(
    { name: "ECDH", public: serverPublicKey },
    clientPrivateKey,
    256,
  );

  const encoder = new TextEncoder();
  const salt = new Uint8Array(hexToBytes(clientNonceHex).length + hexToBytes(serverNonceHex).length);
  salt.set(hexToBytes(clientNonceHex), 0);
  salt.set(hexToBytes(serverNonceHex), hexToBytes(clientNonceHex).length);

  const baseKey = await subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);

  const encKey = await subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: encoder.encode("soundify-mobile-v3-enc"),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  const macKey = await subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: encoder.encode("soundify-mobile-v3-mac"),
    },
    baseKey,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );

  return { encKey, macKey };
}

// Active session caching
interface ActiveSession {
  sessionId: string;
  encKey: CryptoKey;
  macKey: CryptoKey;
  expiresAt: number;
}

let activeSession: ActiveSession | null = null;

export function getActiveSession(): ActiveSession | null {
  if (activeSession && activeSession.expiresAt > Date.now()) {
    return activeSession;
  }
  return null;
}

export function setActiveSession(session: ActiveSession | null): void {
  activeSession = session;
}

export function clearActiveSession(): void {
  activeSession = null;
}

export async function performClientHandshake(
  baseUrl = "",
  deviceId = "android-device-default",
): Promise<SecurityHandshakeResult & { encKey: CryptoKey; macKey: CryptoKey }> {
  const ecdh = await generateClientEcdh();
  const endpoint = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/api/mobile/sec/handshake` : "/api/mobile/sec/handshake";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientPublicKey: ecdh.publicKeyHex,
      clientNonce: ecdh.clientNonceHex,
      deviceId,
    }),
  });

  if (!res.ok) {
    throw new Error(`Handshake failed with HTTP ${res.status}`);
  }

  const json = (await res.json()) as SecurityHandshakeResult;
  const keys = await deriveSessionKeysFromPeer(
    ecdh.keyPair.privateKey,
    json.serverPublicKey,
    ecdh.clientNonceHex,
    json.serverNonce,
  );

  const sessionObj: ActiveSession = {
    sessionId: json.sessionId,
    encKey: keys.encKey,
    macKey: keys.macKey,
    expiresAt: json.expiresAt,
  };
  setActiveSession(sessionObj);

  return {
    ...json,
    encKey: keys.encKey,
    macKey: keys.macKey,
  };
}

// ---------------------------------------------------------------------------
// 3. Authenticated Encryption & Decryption (AES-256-GCM)
// ---------------------------------------------------------------------------

export async function encryptPayload(
  data: unknown,
  key?: CryptoKey,
  sessionId?: string,
): Promise<EncryptedEnvelope> {
  const subtle = getCryptoSubtle();
  const encKey = key || activeSession?.encKey || (await getDefaultClientKeys()).encKey;
  const currentSessionId = sessionId || activeSession?.sessionId;

  const ivBytes = getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));

  const encryptedBuf = await subtle.encrypt(
    { name: "AES-GCM", iv: ivBytes as unknown as BufferSource },
    encKey,
    plaintext as unknown as BufferSource,
  );
  const encryptedBytes = new Uint8Array(encryptedBuf);

  // In Web Crypto AES-GCM, the 16-byte authentication tag is at the end of the ciphertext
  const tagLength = 16;
  const ciphertextBytes = encryptedBytes.slice(0, encryptedBytes.length - tagLength);
  const tagBytes = encryptedBytes.slice(encryptedBytes.length - tagLength);

  return {
    encrypted: true,
    iv: bytesToHex(ivBytes),
    tag: bytesToHex(tagBytes),
    ciphertext: bytesToHex(ciphertextBytes),
    sessionId: currentSessionId,
    timestamp: Date.now(),
  };
}

export async function decryptPayload<T = unknown>(
  envelope: EncryptedEnvelope,
  key?: CryptoKey,
): Promise<T> {
  const subtle = getCryptoSubtle();
  const encKey = key || activeSession?.encKey || (await getDefaultClientKeys()).encKey;

  const iv = hexToBytes(envelope.iv);
  const tag = hexToBytes(envelope.tag);
  const ciphertext = hexToBytes(envelope.ciphertext);

  // Recombine ciphertext and tag for Web Crypto
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext, 0);
  combined.set(tag, ciphertext.length);

  const decryptedBuf = await subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    encKey,
    combined as unknown as BufferSource,
  );
  const text = new TextDecoder().decode(decryptedBuf);
  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// 4. Request Signing & Integrity Verification (HMAC-SHA256)
// ---------------------------------------------------------------------------

export async function signRequest(
  params: {
    method: string;
    path: string;
    timestamp: number;
    nonce: string;
    body?: string;
  },
  key?: CryptoKey,
): Promise<string> {
  const subtle = getCryptoSubtle();
  const macKey = key || activeSession?.macKey || (await getDefaultClientKeys()).macKey;

  const canonicalString = [
    params.method.toUpperCase(),
    params.path,
    String(params.timestamp),
    params.nonce,
    params.body || "",
  ].join("\n");

  const data = new TextEncoder().encode(canonicalString);
  const sigBuf = await subtle.sign("HMAC", macKey, data);
  return bytesToHex(new Uint8Array(sigBuf));
}
