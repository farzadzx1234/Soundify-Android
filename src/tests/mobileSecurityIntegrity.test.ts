import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkDebuggerTiming,
  checkDeviceIntegrity,
  checkEmulatorAndAutomation,
  checkPrototypeTampering,
  isOfflineDecryptionPermitted,
  reportIntegrityAttestation,
  setIntegrityStateForTesting,
  subscribeToIntegrityState,
  type IntegrityState,
} from "../lib/mobileSecurityIntegrity";
import {
  getAllDownloadedTracks,
  getDownloadedTrack,
  getDownloadedTrackBlobUrl,
  saveDownloadedTrack,
} from "../lib/offlineAudioStorage";
import type { Track } from "../lib/types";

describe("Mobile Security Integrity Service (Phase 5)", () => {
  const dummyTrack: Track = {
    id: "test-sec-track-1",
    title: "Protected Track",
    titleFa: "آهنگ محافظت شده",
    artistId: "artist-sec-1",
    artistName: "Test Artist",
    artistNameFa: "هنرمند آزمایشی",
    artistAvatarColor: "#6366F1",
    album: "Singles",
    albumFa: "تک‌آهنگ‌ها",
    genre: "Electronic",
    mood: "Energy",
    durationSec: 180,
    audioUrl: "/api/tracks/test-sec-track-1/stream",
    coverUrl: "/api/tracks/test-sec-track-1/cover",
    accentColor: "#6366F1",
    waveform: [0.1, 0.4, 0.8, 0.2],
    playsCount: 10,
    likesCount: 5,
    repostsCount: 1,
    likedByMe: false,
    repostedByMe: false,
    hasLyrics: false,
    lyricsSource: "none",
    uploadedBy: null,
    createdAt: "2026-01-01",
  };

  beforeEach(() => {
    // Reset to clean secure baseline
    setIntegrityStateForTesting({
      threatLevel: "SECURE",
      isRooted: false,
      isHooked: false,
      isDebuggerConnected: false,
      isEmulator: false,
      detectedSignals: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // 1. Prototype & Hook Tampering Detection
  // ---------------------------------------------------------------------------
  describe("checkPrototypeTampering", () => {
    it("reports clean baseline when no tampering or hooking is present", () => {
      const res = checkPrototypeTampering();
      expect(res.tampered).toBe(false);
      expect(res.signals).toEqual([]);
    });

    it("detects injected Frida global object artifacts", () => {
      const scope = (typeof window !== "undefined" ? window : globalThis) as Record<string, unknown>;
      scope.__frida = { version: "16.1.4" };
      try {
        const res = checkPrototypeTampering();
        expect(res.tampered).toBe(true);
        expect(res.signals).toContain("FRIDA_GLOBAL_OBJECT_DETECTED");
      } finally {
        delete scope.__frida;
      }
    });

    it("detects injected Xposed global object artifacts", () => {
      const scope = (typeof window !== "undefined" ? window : globalThis) as Record<string, unknown>;
      scope.XposedBridge = true;
      try {
        const res = checkPrototypeTampering();
        expect(res.tampered).toBe(true);
        expect(res.signals).toContain("XPOSED_GLOBAL_OBJECT_DETECTED");
      } finally {
        delete scope.XposedBridge;
      }
    });

    it("detects hooked fetch implementation", () => {
      const scope = (typeof window !== "undefined" ? window : globalThis) as Record<string, unknown>;
      const originalFetch = scope.fetch;
      scope.fetch = function frida_hook_fetch() {
        return Promise.resolve(new Response());
      };
      try {
        const res = checkPrototypeTampering();
        expect(res.tampered).toBe(true);
        expect(res.signals).toContain("FETCH_PROTOTYPE_TAMPERED");
      } finally {
        scope.fetch = originalFetch;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Debugger Presence Detection
  // ---------------------------------------------------------------------------
  describe("checkDebuggerTiming", () => {
    it("reports no debugger when execution is fast (below threshold)", () => {
      const res = checkDebuggerTiming(150);
      expect(res.isDebuggerDetected).toBe(false);
      expect(res.deltaMs).toBeLessThan(150);
    });

    it("detects debugger when execution is delayed past threshold", () => {
      // Mock performance.now to simulate a debugger stall
      let callCount = 0;
      vi.spyOn(performance, "now").mockImplementation(() => {
        callCount++;
        return callCount === 1 ? 1000 : 1300; // 300ms delta
      });

      const res = checkDebuggerTiming(100);
      expect(res.isDebuggerDetected).toBe(true);
      expect(res.deltaMs).toBe(300);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Emulator & Automation Detection
  // ---------------------------------------------------------------------------
  describe("checkEmulatorAndAutomation", () => {
    it("detects navigator.webdriver automation flag", () => {
      Object.defineProperty(navigator, "webdriver", {
        value: true,
        configurable: true,
      });

      try {
        const res = checkEmulatorAndAutomation();
        expect(res.isAutomated).toBe(true);
        expect(res.signals).toContain("WEBDRIVER_AUTOMATION_FLAG");
      } finally {
        Object.defineProperty(navigator, "webdriver", {
          value: undefined,
          configurable: true,
        });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Comprehensive Device Integrity & Threat Level Assessment
  // ---------------------------------------------------------------------------
  describe("checkDeviceIntegrity", () => {
    it("assesses SECURE status in a standard clean environment", async () => {
      const integrity = await checkDeviceIntegrity();
      expect(integrity.threatLevel).toBe("SECURE");
      expect(integrity.isRooted).toBe(false);
      expect(integrity.isHooked).toBe(false);
      expect(isOfflineDecryptionPermitted()).toBe(true);
    });

    it("assesses COMPROMISED when native plugin detects SU binary", async () => {
      const integrity = await checkDeviceIntegrity({
        customNativeChecker: async () => ({
          threatLevel: "COMPROMISED",
          isRooted: true,
          detectedSignals: ["SU_BINARY_DETECTED:/system/xbin/su", "BUILD_TAGS_TEST_KEYS"],
        }),
      });

      expect(integrity.threatLevel).toBe("COMPROMISED");
      expect(integrity.isRooted).toBe(true);
      expect(integrity.detectedSignals).toContain("SU_BINARY_DETECTED:/system/xbin/su");
      expect(isOfflineDecryptionPermitted()).toBe(false);
    });

    it("assesses SUSPICIOUS when emulator is detected without root", async () => {
      const integrity = await checkDeviceIntegrity({
        customNativeChecker: async () => ({
          threatLevel: "SUSPICIOUS",
          isEmulator: true,
          detectedSignals: ["EMULATOR_HARDWARE:goldfish"],
        }),
      });

      expect(integrity.threatLevel).toBe("SUSPICIOUS");
      expect(integrity.isEmulator).toBe(true);
      // Offline decryption is still permitted for developer testing in emulators
      expect(isOfflineDecryptionPermitted()).toBe(true);
    });

    it("notifies subscribed listeners upon integrity state change", async () => {
      let notifiedState: IntegrityState | null = null;
      const unsubscribe = subscribeToIntegrityState((state) => {
        notifiedState = state;
      });

      await checkDeviceIntegrity({
        customNativeChecker: async () => ({
          threatLevel: "COMPROMISED",
          isHooked: true,
          detectedSignals: ["FRIDA_ARTIFACT_IN_MEMORY"],
        }),
      });

      expect(notifiedState).not.toBeNull();
      const state = notifiedState as unknown as IntegrityState;
      expect(state.threatLevel).toBe("COMPROMISED");
      expect(state.isHooked).toBe(true);

      unsubscribe();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Policy Enforcement on Offline Decrypted Media
  // ---------------------------------------------------------------------------
  describe("Graceful Policy Enforcement on Compromised Devices", () => {
    it("blocks access to downloaded tracks when device is marked COMPROMISED", async () => {
      const audioBlob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/wav" });
      await saveDownloadedTrack(dummyTrack, audioBlob);

      // Verify access works when SECURE
      setIntegrityStateForTesting({ threatLevel: "SECURE" });
      const record = await getDownloadedTrack(dummyTrack.id);
      expect(record).not.toBeNull();
      expect(record?.trackId).toBe(dummyTrack.id);

      // Now compromise device (e.g. root detected)
      setIntegrityStateForTesting({
        threatLevel: "COMPROMISED",
        isRooted: true,
        detectedSignals: ["SU_BINARY_DETECTED"],
      });

      // Retrieval should now be blocked by security policy
      await expect(getDownloadedTrack(dummyTrack.id)).rejects.toThrow(
        /SECURITY_INTEGRITY_VIOLATION/,
      );

      // Blob URL generation should return null
      const blobUrl = await getDownloadedTrackBlobUrl(dummyTrack.id);
      expect(blobUrl).toBeNull();

      // Bulk tracks retrieval should sanitize/strip audio blobs on compromised devices
      const allTracksCompromised = await getAllDownloadedTracks();
      expect(allTracksCompromised.length).toBeGreaterThan(0);
      for (const t of allTracksCompromised) {
        expect(t.audioBlob.size).toBe(0);
      }
    });

    it("restores access once device is confirmed SECURE", async () => {
      setIntegrityStateForTesting({ threatLevel: "SECURE" });
      const record = await getDownloadedTrack(dummyTrack.id);
      expect(record).not.toBeNull();
      expect(record?.trackId).toBe(dummyTrack.id);

      // Bulk tracks retrieval retains full audio blob on SECURE devices
      const allTracksSecure = await getAllDownloadedTracks();
      expect(allTracksSecure.length).toBeGreaterThan(0);
      const found = allTracksSecure.find((t) => t.trackId === dummyTrack.id);
      expect(found).toBeDefined();
      expect(found?.audioBlob.size).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Attestation Reporting to Backend
  // ---------------------------------------------------------------------------
  describe("reportIntegrityAttestation", () => {
    it("transmits attestation payload and returns backend policy response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          policyAction: "RESTRICT_OFFLINE",
          offlineDecryptionPermitted: false,
        }),
      });
      globalThis.fetch = mockFetch as unknown as typeof fetch;

      setIntegrityStateForTesting({
        threatLevel: "COMPROMISED",
        isRooted: true,
        detectedSignals: ["SU_BINARY_DETECTED"],
      });

      const res = await reportIntegrityAttestation("device-pixel-compromised-001");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(res.ok).toBe(true);
      expect(res.policyAction).toBe("RESTRICT_OFFLINE");
      expect(res.offlineDecryptionPermitted).toBe(false);
    });
  });
});
