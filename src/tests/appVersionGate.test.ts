import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  APP_VERSION,
  MIN_SERVER_SUPPORTED_VERSION,
  subscribeAppUpdateRequired,
  triggerAppUpdateRequired,
  clearAppUpdateRequired,
  getLatestAppUpdateInfo,
} from "@/lib/appVersion";
import { api, resolveMediaUrl, synthesizeExternalTrack } from "@/lib/api";

describe("Client App Version Enforcement & HTTP 426 Gate", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    clearAppUpdateRequired();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    clearAppUpdateRequired();
  });

  it("exports valid APP_VERSION that meets or exceeds MIN_SERVER_SUPPORTED_VERSION (>= 1.0.15)", () => {
    expect(APP_VERSION).toBeDefined();
    expect(MIN_SERVER_SUPPORTED_VERSION).toBe("1.0.15");

    const [major, minor, patch] = APP_VERSION.split(".").map(Number);
    const [minMajor, minMinor, minPatch] = MIN_SERVER_SUPPORTED_VERSION.split(".").map(Number);

    const isGreaterOrEqual =
      major > minMajor ||
      (major === minMajor && minor > minMinor) ||
      (major === minMajor && minor === minMinor && patch >= minPatch);

    expect(isGreaterOrEqual).toBe(true);
  });

  it("resolveMediaUrl automatically appends appVersion to /api/stream/external URLs", () => {
    const rawExternalUrl =
      "/api/stream/external?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&id=dQw4w9WgXcQ";

    const resolved = resolveMediaUrl(rawExternalUrl);
    expect(resolved).toContain(`appVersion=${APP_VERSION}`);

    // If already contains appVersion, it should not duplicate it
    const resolvedAgain = resolveMediaUrl(resolved);
    const matches = resolvedAgain.match(/appVersion=/g);
    expect(matches?.length).toBe(1);
  });

  it("synthesizeExternalTrack produces audioUrl containing appVersion", () => {
    const track = synthesizeExternalTrack("dQw4w9WgXcQ", {
      title: "Never Gonna Give You Up",
      artistName: "Rick Astley",
    });

    expect(track.audioUrl).toContain(`appVersion=${APP_VERSION}`);
  });

  it("triggerAppUpdateRequired notifies subscribers and persists latest update info", () => {
    const subscriber = vi.fn();
    const unsubscribe = subscribeAppUpdateRequired(subscriber);

    const payload = {
      minSupportedVersion: "1.0.15",
      message: "Upgrade required",
      messageFa: "نسخه برنامه شما قدیمی است.",
    };

    triggerAppUpdateRequired(payload);

    expect(subscriber).toHaveBeenCalledWith(payload);
    expect(getLatestAppUpdateInfo()).toEqual(payload);

    unsubscribe();
  });

  it("apiFetch injects X-App-Version header into outgoing network requests", async () => {
    let capturedHeaders: Headers | undefined;

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ tracks: [] }),
      } as unknown as Response;
    });

    await api.getTracks();

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders?.get("X-App-Version")).toBe(APP_VERSION);
  });

  it("apiFetch detects HTTP 426 Upgrade Required and triggers AppUpdateRequired event", async () => {
    const updateListener = vi.fn();
    const unsubscribe = subscribeAppUpdateRequired(updateListener);

    global.fetch = vi.fn().mockImplementation(async () => {
      return {
        ok: false,
        status: 426,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          statusCode: 426,
          error: "Upgrade Required",
          code: "APP_UPDATE_REQUIRED",
          message: "نسخه برنامه شما قدیمی است. لطفاً برای استفاده از جستجوی جهانی، برنامه را به آخرین نسخه به‌روزرسانی کنید.",
          errorFa: "نسخه برنامه شما قدیمی است. لطفاً برای استفاده از جستجوی جهانی، برنامه را به آخرین نسخه به‌روزرسانی کنید.",
          errorEn: "Your application version is outdated. Please update to the latest version to access global search.",
          minSupportedVersion: "1.0.15",
        }),
      } as unknown as Response;
    });

    const res = await api.searchExternal("shajarian", "youtube");
    expect(res.code).toBe("APP_UPDATE_REQUIRED");

    expect(updateListener).toHaveBeenCalledWith(
      expect.objectContaining({
        minSupportedVersion: "1.0.15",
        messageFa: "نسخه برنامه شما قدیمی است. لطفاً برای استفاده از جستجوی جهانی، برنامه را به آخرین نسخه به‌روزرسانی کنید.",
      }),
    );

    unsubscribe();
  });
});
