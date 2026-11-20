import { describe, expect, it, vi } from "vitest";
import {
  bytesToHex,
  decryptPayload,
  encryptPayload,
  generateClientEcdh,
  getDefaultClientKeys,
  getRandomHex,
  hexToBytes,
  signRequest,
} from "../lib/mobileCrypto";
import { sanitizeLogMessage } from "../lib/secureLogger";
import { checkDeepBackendHealth } from "../lib/mobileBackend";

describe("Frontend Mobile Security, Web Crypto & Anti-Leakage", () => {
  describe("1. Hex & Random Utilities", () => {
    it("converts bytes to hex and hex to bytes reversibly", () => {
      const original = new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff]);
      const hex = bytesToHex(original);
      expect(hex).toBe("00017f80feff");
      const reverted = hexToBytes(hex);
      expect(Array.from(reverted)).toEqual(Array.from(original));
    });

    it("generates random hex strings of requested byte length", () => {
      const hex16 = getRandomHex(16);
      expect(hex16).toHaveLength(32);
      const hex32 = getRandomHex(32);
      expect(hex32).toHaveLength(64);
    });

    it("rejects odd-length or malformed hex strings with an error", () => {
      expect(() => hexToBytes("abc")).toThrow("length must be even");
      expect(() => hexToBytes("zzzz")).toThrow("Invalid hex character");
    });
  });

  describe("2. Web Crypto AES-256-GCM Payload Encryption & Decryption", () => {
    it("encrypts and decrypts objects with authentication tag", async () => {
      const payload = {
        deviceId: "android-pixel-7",
        secretToken: "secret_value_xyz",
        count: 42,
      };

      const envelope = await encryptPayload(payload);
      expect(envelope.encrypted).toBe(true);
      expect(envelope.iv).toHaveLength(24); // 12 bytes = 24 hex
      expect(envelope.tag).toHaveLength(32); // 16 bytes = 32 hex
      expect(envelope.ciphertext.length).toBeGreaterThan(0);

      const decrypted = await decryptPayload(envelope);
      expect(decrypted).toEqual(payload);
    });

    it("detects ciphertext tampering and fails tag verification", async () => {
      const envelope = await encryptPayload({ test: 123 });
      // Tamper with ciphertext
      const bytes = hexToBytes(envelope.ciphertext);
      bytes[0] ^= 0x01;
      envelope.ciphertext = bytesToHex(bytes);

      await expect(decryptPayload(envelope)).rejects.toThrow();
    });
  });

  describe("3. ECDH Ephemeral Keypair Generation & HMAC Request Signing", () => {
    it("generates a valid P-256 uncompressed public key (130 hex chars)", async () => {
      const ecdh = await generateClientEcdh();
      expect(ecdh.publicKeyHex).toHaveLength(130);
      expect(ecdh.publicKeyHex.startsWith("04")).toBe(true); // 0x04 uncompressed point
      expect(ecdh.clientNonceHex).toHaveLength(32);
    });

    it("computes deterministic HMAC-SHA256 signatures for API requests", async () => {
      const keys = await getDefaultClientKeys();
      const params = {
        method: "POST",
        path: "/api/devices/register",
        timestamp: 1731710000000,
        nonce: "test-nonce-123",
        body: JSON.stringify({ id: "dev-1" }),
      };

      const sig1 = await signRequest(params, keys.macKey);
      const sig2 = await signRequest(params, keys.macKey);

      expect(sig1).toHaveLength(64);
      expect(sig1).toBe(sig2);

      // Changing any property alters signature
      const sigAltered = await signRequest({ ...params, timestamp: 1731710000001 }, keys.macKey);
      expect(sigAltered).not.toBe(sig1);
    });
  });

  describe("4. Log Sanitization & Anti-Leakage", () => {
    it("redacts JWT authorization tokens", () => {
      const input = "Headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig' }";
      const sanitized = sanitizeLogMessage(input);
      expect(sanitized).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
      expect(sanitized).toContain("Bearer [REDACTED_JWT]");
    });

    it("redacts passwords in JSON payloads and objects", () => {
      const input = '{"username": "tester", "password": "SuperSecretPassword123"}';
      const sanitized = sanitizeLogMessage(input);
      expect(sanitized).not.toContain("SuperSecretPassword123");
      expect(sanitized).toContain("[REDACTED_PASSWORD]");
    });

    it("redacts private keys and nonces", () => {
      const input = '{"privateKey": "d8a1c9e8", "serverNonce": "a7b3c2"}';
      const sanitized = sanitizeLogMessage(input);
      expect(sanitized).toContain("[REDACTED_KEY]");
      expect(sanitized).toContain("[REDACTED_NONCE]");
    });
  });

  describe("5. checkDeepBackendHealth", () => {
    it("returns parsed diagnostics when endpoint responds successfully", async () => {
      const mockDiag = {
        status: "healthy",
        app: "Soundify Mobile",
        version: "1.0.0",
        service: "soundify-mobile-api",
        timestamp: Date.now(),
        isoTime: new Date().toISOString(),
        uptimeSec: 100,
        totalLatencyMs: 5,
        database: { status: "connected", latencyMs: 1, error: null, counts: { users: 2, tracks: 5, artists: 3, playlists: 1, devices: 1, activeDevices90s: 1 } },
        storage: { ready: true, audioFiles: 5, coverFiles: 5, writable: true },
        system: { nodeVersion: "v22.0.0", platform: "linux", memory: { rssMb: 50, heapUsedMb: 25, heapTotalMb: 40 } },
        security: { transportEncryption: true, replayProtection: true, rateLimiting: true },
      };

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockDiag,
      });

      try {
        const result = await checkDeepBackendHealth("http://localhost:4100");
        expect(result.ok).toBe(true);
        expect(result.diagnostic?.status).toBe("healthy");
        expect(result.diagnostic?.database.status).toBe("connected");
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("handles connection failure gracefully", async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockRejectedValue(new Error("Network unreachable"));

      try {
        const result = await checkDeepBackendHealth("http://192.0.2.1:4100");
        expect(result.ok).toBe(false);
        expect(result.error).toContain("Network unreachable");
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
