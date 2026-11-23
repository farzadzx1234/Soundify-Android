import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, setApiTokens } from "@/lib/api";
import { resolveMediaUrl, setMediaAuthToken } from "@/lib/mobileBackend";
import { APP_VERSION } from "@/lib/appVersion";

describe("External Stream Query Auth & Global Search Source Fallbacks", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    setMediaAuthToken(null);
    setApiTokens(null, null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setMediaAuthToken(null);
    setApiTokens(null, null);
  });

  it("resolveMediaUrl appends both appVersion and token for /api/stream/external when signed in", () => {
    setApiTokens("jwt_user_token_abc123", null);
    const url = resolveMediaUrl(
      "/api/stream/external?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D12345678901&id=ext-youtube-12345678901",
    );

    expect(url).toContain(`appVersion=${APP_VERSION}`);
    expect(url).toContain("token=jwt_user_token_abc123");
  });

  it("resolveMediaUrl omits token parameter cleanly when user is guest", () => {
    const url = resolveMediaUrl("/api/stream/external?url=https%3A%2F%2Fsoundcloud.com%2Fx%2Fy&id=sc-1");
    expect(url).toContain(`appVersion=${APP_VERSION}`);
    expect(url).not.toContain("token=");
  });

  it("searchExternal preserves source=spotify and falls back cleanly to mobile/v1 alias when primary returns empty", async () => {
    const calledUrls: string[] = [];

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      calledUrls.push(url);
      if (url.includes("/api/external/search")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ query: "kam kam", source: "spotify", results: [], total: 0 }),
        } as unknown as Response;
      }
      if (url.includes("/api/mobile/v1/spotify/search")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            query: "kam kam",
            source: "youtube",
            results: [
              {
                id: "ext-youtube-abc12345678",
                title: "Kam Kam",
                artistName: "Shayan Yo",
                audioUrl: "/api/stream/external?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc12345678&id=ext-youtube-abc12345678",
                source: "youtube",
              },
            ],
            total: 1,
          }),
        } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const res = await api.searchExternal("kam kam", "spotify", 20);
    expect(calledUrls.some((u) => u.includes("limit=20"))).toBe(true);
    expect(calledUrls.some((u) => u.includes("/api/mobile/v1/spotify/search"))).toBe(true);
    expect(res.results.length).toBe(1);
    expect(res.results[0].source).toBe("spotify");
    expect(res.results[0].qualityLabel).toBe("Spotify High");
    expect(res.results[0].audioUrl).toContain("fastStart=true");
  });

  it("searchExternal falls back to /api/mobile/v1/soundcloud/search if primary returns empty", async () => {
    const calledUrls: string[] = [];

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      calledUrls.push(url);
      if (url.includes("/api/external/search")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({ query: "shayan yo", source: "soundcloud", results: [], total: 0 }),
        } as unknown as Response;
      }
      if (url.includes("/api/mobile/v1/soundcloud/search")) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
          json: async () => ({
            query: "shayan yo",
            source: "soundcloud",
            results: [
              {
                id: "ext-soundcloud-999",
                title: "Kam Kam",
                artistName: "Shayan Yo",
                audioUrl: "/api/stream/external?url=https%3A%2F%2Fsoundcloud.com%2Fshayanyo%2Fkam-kam&id=ext-soundcloud-999",
                source: "soundcloud",
              },
            ],
            total: 1,
          }),
        } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    });

    const res = await api.searchExternal("shayan yo", "soundcloud", 20);
    expect(calledUrls.some((u) => u.includes("/api/mobile/v1/soundcloud/search"))).toBe(true);
    expect(res.results.length).toBe(1);
    expect(res.results[0].source).toBe("soundcloud");
  });
});
