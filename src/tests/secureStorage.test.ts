import { beforeEach, describe, expect, it } from "vitest";
import { SecureStorageVault, secureStorage } from "../lib/secureStorage";

describe("Client-Side SecureStorage & Token Vault", () => {
  beforeEach(async () => {
    await secureStorage.clear();
  });

  it("stores and retrieves sensitive values synchronously and asynchronously", async () => {
    const testToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mobile.payload";

    await secureStorage.setItem("soundify_token", testToken);

    // Synchronous retrieval from in-memory cache
    const syncVal = secureStorage.getItemSync("soundify_token");
    expect(syncVal).toBe(testToken);

    // Asynchronous retrieval
    const asyncVal = await secureStorage.getItem("soundify_token");
    expect(asyncVal).toBe(testToken);
  });

  it("persists and restores encrypted vault across new instance launches without data wiping", async () => {
    const sessionToken = "token_persisted_across_cold_starts_12345";
    await secureStorage.setItem("soundify_token", sessionToken);

    // Simulate app reload with fresh instance accessing the same localStorage
    const secondVault = new SecureStorageVault();
    const retrieved = await secondVault.getItem("soundify_token");
    expect(retrieved).toBe(sessionToken);

    // Synchronous retrieval after init
    expect(secondVault.getItemSync("soundify_token")).toBe(sessionToken);
  });

  it("migrates unencrypted legacy tokens into the encrypted vault and purges plaintext keys", async () => {
    // Write legacy plaintext token directly to underlying storage BEFORE instantiation
    const initialStorage = secureStorage.getStorage();
    expect(initialStorage).not.toBeNull();
    initialStorage?.setItem("soundify_token", "legacy-plaintext-secret");

    const migrationVault = new SecureStorageVault();
    await migrationVault.init();

    expect(await migrationVault.getItem("soundify_token")).toBe("legacy-plaintext-secret");

    // Plaintext key should have been deleted from storage and replaced with encrypted vault
    expect(initialStorage?.getItem("soundify_token")).toBeNull();
    expect(initialStorage?.getItem("soundify_sec_vault")).toBeDefined();
  });

  it("removes items cleanly from storage", async () => {
    await secureStorage.setItem("secret_key", "top-secret-123");
    expect(secureStorage.getItemSync("secret_key")).toBe("top-secret-123");

    await secureStorage.removeItem("secret_key");
    expect(secureStorage.getItemSync("secret_key")).toBeNull();
  });

  it("handles non-existent keys returning null", async () => {
    const val = await secureStorage.getItem("non_existent_key");
    expect(val).toBeNull();
    expect(secureStorage.getItemSync("non_existent_key")).toBeNull();
  });

  it("clears all vault records when requested", async () => {
    await secureStorage.setItem("key_a", "val_a");
    await secureStorage.setItem("key_b", "val_b");

    await secureStorage.clear();

    expect(secureStorage.getItemSync("key_a")).toBeNull();
    expect(secureStorage.getItemSync("key_b")).toBeNull();
  });
});
