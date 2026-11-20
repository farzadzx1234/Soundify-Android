/**
 * Secure Storage Abstraction for Soundify Mobile & Android
 *
 * Protects client-side auth tokens, credentials, and cryptographic state
 * against local inspection, root file dumping, and cross-site scraping.
 *
 * Features:
 * 1. AES-256-GCM encrypted persistence in localStorage with PBKDF2 device binding.
 * 2. In-memory sync mirror for instant token access.
 * 3. Automatic legacy migration (removes unencrypted tokens).
 * 4. Graceful in-memory fallback when localStorage is restricted.
 * 5. Multi-session persistence safety (never overwrites vault before decrypting).
 */

import { bytesToHex, hexToBytes, getRandomHex } from "./mobileCrypto";

const STORAGE_VAULT_KEY = "soundify_sec_vault";
const STORAGE_SALT_KEY = "soundify_device_salt";
const SENSITIVE_LEGACY_KEYS = ["soundify_token", "soundify_user_credentials"];

class InMemoryStorageAdapter implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const fallbackSharedStorage = new InMemoryStorageAdapter();

class SecureStorageVault {
  private memoryCache = new Map<string, string>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private vaultKeyPromise: Promise<CryptoKey> | null = null;
  private customStorage: Storage | null = null;

  constructor(customStorage?: Storage) {
    if (customStorage) {
      this.customStorage = customStorage;
    }
    this.hydrateFromStorageSync();
    if (typeof window !== "undefined" || typeof globalThis !== "undefined") {
      this.initPromise = this.initInternal();
    }
  }

  public getStorage(): Storage | null {
    if (this.customStorage) {
      return this.customStorage;
    }
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.getItem("__probe__");
        return window.localStorage;
      } catch {}
    }
    if (typeof globalThis !== "undefined") {
      try {
        const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage;
        if (ls && typeof ls.getItem === "function") {
          ls.getItem("__probe__");
          return ls;
        }
      } catch {}
    }
    return fallbackSharedStorage;
  }

  private getDeviceSalt(): Uint8Array {
    const storage = this.getStorage();
    if (storage) {
      try {
        const savedSalt = storage.getItem(STORAGE_SALT_KEY);
        if (savedSalt && savedSalt.length === 32) {
          return hexToBytes(savedSalt);
        }
        const newSaltHex = getRandomHex(16);
        storage.setItem(STORAGE_SALT_KEY, newSaltHex);
        return hexToBytes(newSaltHex);
      } catch {
        // storage disabled or restricted
      }
    }
    return new Uint8Array(16); // in-memory fallback salt
  }

  private async getVaultKey(): Promise<CryptoKey> {
    if (this.vaultKeyPromise) return this.vaultKeyPromise;

    this.vaultKeyPromise = (async () => {
      const subtle =
        typeof window !== "undefined" && window.crypto?.subtle
          ? window.crypto.subtle
          : globalThis.crypto?.subtle;

      if (!subtle) {
        throw new Error("crypto.subtle not available for vault key derivation");
      }

      const salt = this.getDeviceSalt();
      const rawSeed = new TextEncoder().encode("soundify-mobile-client-storage-vault-2026");

      const baseKey = await subtle.importKey("raw", rawSeed, "PBKDF2", false, ["deriveKey"]);

      return subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: salt as unknown as BufferSource,
          iterations: 10_000,
          hash: "SHA-256",
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })();

    return this.vaultKeyPromise;
  }

  /**
   * Synchronously populates in-memory cache from legacy plaintext tokens if available.
   * NOTE: Does NOT write to vault here to avoid wiping encrypted storage before decryption.
   */
  private hydrateFromStorageSync(): void {
    const storage = this.getStorage();
    if (!storage) return;

    try {
      for (const legacyKey of SENSITIVE_LEGACY_KEYS) {
        const plainVal = storage.getItem(legacyKey);
        if (plainVal && plainVal.trim()) {
          this.memoryCache.set(legacyKey, plainVal.trim());
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  /**
   * Internal async initializer that decrypts existing vault and merges state.
   */
  private async initInternal(): Promise<void> {
    if (this.initialized) return;

    const storage = this.getStorage();
    if (!storage) {
      this.initialized = true;
      return;
    }

    try {
      const vaultRaw = storage.getItem(STORAGE_VAULT_KEY);
      if (vaultRaw) {
        const envelope = JSON.parse(vaultRaw) as {
          iv: string;
          tag: string;
          ciphertext: string;
        };
        const subtle =
          typeof window !== "undefined" && window.crypto?.subtle
            ? window.crypto.subtle
            : globalThis.crypto?.subtle;

        if (subtle && envelope.iv && envelope.tag && envelope.ciphertext) {
          const key = await this.getVaultKey();
          const iv = hexToBytes(envelope.iv);
          const tag = hexToBytes(envelope.tag);
          const ciphertext = hexToBytes(envelope.ciphertext);

          const combined = new Uint8Array(ciphertext.length + tag.length);
          combined.set(ciphertext, 0);
          combined.set(tag, ciphertext.length);

          const decryptedBuf = await subtle.decrypt(
            { name: "AES-GCM", iv: iv as unknown as BufferSource },
            key,
            combined as unknown as BufferSource,
          );
          const jsonStr = new TextDecoder().decode(decryptedBuf);
          const parsed = JSON.parse(jsonStr) as Record<string, string>;

          for (const [k, v] of Object.entries(parsed)) {
            if (!this.memoryCache.has(k)) {
              this.memoryCache.set(k, v);
            }
          }
        }
      }

      // Check if legacy plaintext keys should be migrated
      let hasLegacyToMigrate = false;
      for (const legacyKey of SENSITIVE_LEGACY_KEYS) {
        const plainVal = storage.getItem(legacyKey);
        if (plainVal && plainVal.trim()) {
          this.memoryCache.set(legacyKey, plainVal.trim());
          hasLegacyToMigrate = true;
        }
      }

      this.initialized = true;

      // Migrate legacy keys if detected
      if (hasLegacyToMigrate) {
        await this.persistVaultInternal();
      }
    } catch {
      this.initialized = true;
    }
  }

  /**
   * Initializes vault asynchronously, ensuring vault decryption is finished.
   */
  public async init(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
    // Re-check for any legacy plaintext keys that may have been written
    const storage = this.getStorage();
    if (storage) {
      let hasLegacy = false;
      for (const legacyKey of SENSITIVE_LEGACY_KEYS) {
        const plainVal = storage.getItem(legacyKey);
        if (plainVal && plainVal.trim()) {
          this.memoryCache.set(legacyKey, plainVal.trim());
          hasLegacy = true;
        }
      }
      if (hasLegacy) {
        await this.persistVaultInternal();
      }
    }
    this.initialized = true;
  }

  public ready(): Promise<void> {
    return this.init();
  }

  /**
   * Low-level persistence write. Caller must guarantee initialization.
   */
  private async persistVaultInternal(): Promise<void> {
    const storage = this.getStorage();
    if (!storage) return;

    try {
      const subtle =
        typeof window !== "undefined" && window.crypto?.subtle
          ? window.crypto.subtle
          : globalThis.crypto?.subtle;

      if (!subtle) return;

      const key = await this.getVaultKey();
      const iv = new Uint8Array(12);
      if (typeof window !== "undefined" && window.crypto) {
        window.crypto.getRandomValues(iv);
      } else if (globalThis.crypto) {
        globalThis.crypto.getRandomValues(iv);
      }

      const rawData = JSON.stringify(Object.fromEntries(this.memoryCache.entries()));
      const encryptedBuf = await subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(rawData),
      );

      const combined = new Uint8Array(encryptedBuf);
      const tag = combined.slice(combined.length - 16);
      const ciphertext = combined.slice(0, combined.length - 16);

      const vaultPayload = JSON.stringify({
        encrypted: true,
        iv: bytesToHex(iv),
        tag: bytesToHex(tag),
        ciphertext: bytesToHex(ciphertext),
      });

      storage.setItem(STORAGE_VAULT_KEY, vaultPayload);

      // Clean up plaintext legacy keys
      for (const legacyKey of SENSITIVE_LEGACY_KEYS) {
        storage.removeItem(legacyKey);
      }
    } catch {
      // ignore
    }
  }

  /**
   * Encrypts and saves all memoryCache items to the encrypted vault in localStorage.
   * Awaits initialization to prevent wiping out existing data.
   */
  private async persistVaultAsync(): Promise<void> {
    if (!this.initialized && this.initPromise) {
      try {
        await this.initPromise;
      } catch {
        // continue
      }
    }
    await this.persistVaultInternal();
  }

  /**
   * Fast synchronous retrieval from in-memory cache.
   */
  public getItemSync(key: string): string | null {
    const cached = this.memoryCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Direct check for legacy fallback
    const storage = this.getStorage();
    if (storage) {
      try {
        const fallback = storage.getItem(key);
        if (fallback) {
          this.memoryCache.set(key, fallback);
          return fallback;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  /**
   * Asynchronous get item with vault initialization guarantee.
   */
  public async getItem(key: string): Promise<string | null> {
    await this.init();
    return this.getItemSync(key);
  }

  /**
   * Asynchronously stores a value in memory and updates encrypted storage vault.
   */
  public async setItem(key: string, value: string): Promise<void> {
    this.memoryCache.set(key, value);
    await this.persistVaultAsync();
  }

  /**
   * Removes item from memory and vault.
   */
  public async removeItem(key: string): Promise<void> {
    this.memoryCache.delete(key);
    const storage = this.getStorage();
    if (storage) {
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
    }
    await this.persistVaultAsync();
  }

  /**
   * Clears entire secure storage vault.
   */
  public async clear(): Promise<void> {
    this.memoryCache.clear();
    const storage = this.getStorage();
    if (storage) {
      try {
        storage.removeItem(STORAGE_VAULT_KEY);
        for (const k of SENSITIVE_LEGACY_KEYS) {
          storage.removeItem(k);
        }
      } catch {
        // ignore
      }
    }
  }
}

export { SecureStorageVault };
export const secureStorage = new SecureStorageVault();
