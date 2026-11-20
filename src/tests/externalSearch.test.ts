import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api";

describe("Frontend External Search Client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("has searchExternal function exposed on api object", () => {
    expect(typeof api.searchExternal).toBe("function");
  });

  it("never returns FALLBACK_TRACKS or Persian seed tracks when external search fails", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      throw new Error("Network timeout or unreachable proxy");
    });

    const res = await api.searchExternal("The Weeknd", "youtube", 10);
    expect(res).toBeDefined();
    expect(res.results).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.error).toBeDefined();
    // Verify zero pollution from FALLBACK_TRACKS
    expect(res.results.some((t) => t.id === "track-01" || t.artistName === "Homayoun Shajarian")).toBe(false);
  });

  it("resolves Spotify track URL queries using oEmbed and routes to YouTube audio search", async () => {
    let requestedExternalQuery = "";
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("open.spotify.com/oembed")) {
        return new Response(
          JSON.stringify({
            title: "Blinding Lights - The Weeknd",
            thumbnail_url: "https://i.scdn.co/image/test-cover",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/api/external/search")) {
        requestedExternalQuery = url;
        return new Response(
          JSON.stringify({
            query: "Blinding Lights - The Weeknd",
            source: "youtube",
            results: [
              {
                id: "ext-youtube-4NRXx6U8ABQ",
                title: "Blinding Lights",
                artistName: "The Weeknd",
                audioUrl: "/api/stream/external?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D4NRXx6U8ABQ&id=ext-youtube-4NRXx6U8ABQ",
                pageUrl: "https://www.youtube.com/watch?v=4NRXx6U8ABQ",
                coverUrl: "https://i.ytimg.com/vi/4NRXx6U8ABQ/hqdefault.jpg",
                durationSec: 200,
              },
            ],
            total: 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("Not found", { status: 404 });
    });

    const res = await api.searchExternal("https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b", "spotify", 10);
    expect(requestedExternalQuery).toContain("Blinding+Lights");
    expect(res.results.length).toBe(1);
    expect(res.results[0].source).toBe("spotify");
    expect(res.results[0].qualityLabel).toBe("Spotify High");
  });
});
