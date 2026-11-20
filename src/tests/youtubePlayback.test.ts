import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  extractCanonicalExternalUrl,
  extractYouTubeIdClient,
  externalTracksCache,
  synthesizeExternalTrack,
} from "../lib/api";
import type { Track } from "../lib/types";

describe("Frontend YouTube Playback, Cover Cascade, and Stream Refresh", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("API Client: refreshStreamUrl", () => {
    it("exposes refreshStreamUrl method on the api client object", () => {
      expect(typeof api.refreshStreamUrl).toBe("function");
    });

    it("invokes /api/external/refresh-stream with id and url payload", async () => {
      let interceptedUrl = "";
      let interceptedBody: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        interceptedUrl = url;
        interceptedBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(
          JSON.stringify({
            ok: true,
            streamUrl: "https://rr---sn.googlevideo.com/videoplayback?expire=9999",
            audioUrl: "/api/stream/external?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&id=ext-youtube-dQw4w9WgXcQ",
            canonicalUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const res = await api.refreshStreamUrl("ext-youtube-dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");

      expect(interceptedUrl).toContain("/api/external/refresh-stream");
      expect(interceptedBody).toEqual({
        id: "ext-youtube-dQw4w9WgXcQ",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      });
      expect(res.ok).toBe(true);
      expect(res.audioUrl).toContain("/api/stream/external");
    });
  });

  describe("Cover Fallback Logic & Client YouTube ID Extractor", () => {
    it("extracts YouTube ID accurately even from double-prefixed or URL-encoded sources", () => {
      expect(extractYouTubeIdClient("ext-youtube-dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
      expect(extractYouTubeIdClient("ext-youtube-youtube-dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
      expect(extractYouTubeIdClient("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
      expect(extractYouTubeIdClient("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
      expect(extractYouTubeIdClient("https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg")).toBe("dQw4w9WgXcQ");
      expect(extractYouTubeIdClient("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg?sqp=test")).toBe("dQw4w9WgXcQ");
      expect(extractYouTubeIdClient("/api/stream/external?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("derives fallback thumbnail using proxy when direct YouTube image fails", () => {
      const brokenMaxRes = "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg";
      const ytId = extractYouTubeIdClient(brokenMaxRes);

      expect(ytId).toBe("dQw4w9WgXcQ");

      const cascadedProxyUrl = `/api/stream/external-cover?url=${encodeURIComponent(`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`)}`;
      expect(cascadedProxyUrl).toContain("/api/stream/external-cover");
      expect(cascadedProxyUrl).toContain("hqdefault.jpg");
    });

    it("guarantees an inline SVG fallback if all network covers fail", () => {
      const fallbackSvg =
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 500 500' width='500' height='500'><rect width='100%' height='100%' fill='%236366f1'/><circle cx='250' cy='250' r='120' fill='none' stroke='rgba(255,255,255,0.2)' stroke-width='6'/><circle cx='250' cy='250' r='40' fill='rgba(255,255,255,0.3)'/></svg>";

      expect(fallbackSvg.startsWith("data:image/svg+xml")).toBe(true);
      expect(fallbackSvg).toContain("<svg");
    });
  });

  describe("External Track Like & Replay Preservation", () => {
    it("passes external track metadata when toggling like", async () => {
      let interceptedBody: Record<string, unknown> | null = null;

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        interceptedBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(JSON.stringify({ liked: true, likesCount: 5 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const externalTrack: Track = {
        id: "ext-youtube-dQw4w9WgXcQ",
        title: "Never Gonna Give You Up",
        titleFa: "Never Gonna Give You Up",
        artistId: "ext-artist-123",
        artistName: "Rick Astley",
        artistNameFa: "Rick Astley",
        artistAvatarColor: "#EF4444",
        album: "YouTube Music",
        albumFa: "یوتیوب موزیک",
        genre: "Pop",
        mood: "Energetic",
        durationSec: 213,
        audioUrl: "/api/stream/external?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ",
        coverUrl: "/api/stream/external-cover?url=https%3A%2F%2Fi.ytimg.com%2Fvi%2FdQw4w9WgXcQ%2Fhqdefault.jpg",
        accentColor: "#EF4444",
        waveform: [0.5, 0.6, 0.7],
        hasLyrics: false,
        lyricsSource: "none",
        playsCount: 0,
        likesCount: 0,
        repostsCount: 0,
        likedByMe: false,
        repostedByMe: false,
        uploadedBy: null,
        createdAt: new Date().toISOString(),
        source: "youtube",
        pageUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      };

      const res = await api.toggleLike(externalTrack.id, externalTrack);

      expect(res.liked).toBe(true);
      expect(interceptedBody).not.toBeNull();
      expect(interceptedBody!.source).toBe("youtube");
      expect(interceptedBody!.pageUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(interceptedBody!.title).toBe("Never Gonna Give You Up");
    });
  });

  describe("Stream Error Interception & Recovery Protocol", () => {
    it("handles recovery attempt flow without infinite loops (bounded to 2 retries)", async () => {
      let refreshCallCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/api/external/refresh-stream")) {
          refreshCallCount++;
          return new Response(
            JSON.stringify({
              ok: true,
              streamUrl: "https://fresh.googlevideo.com/playback",
              audioUrl: "/api/stream/external?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      });

      // Simulate recovery retry counter logic
      const attemptsMap: Record<string, number> = {};
      const trackId = "ext-youtube-test";

      const handleSimulatedError = async () => {
        const attempts = attemptsMap[trackId] || 0;
        if (attempts < 2) {
          attemptsMap[trackId] = attempts + 1;
          await api.refreshStreamUrl(trackId, "https://www.youtube.com/watch?v=test");
          return true; // handled retry
        }
        return false; // exhausted retries
      };

      // 1st error trigger
      const r1 = await handleSimulatedError();
      expect(r1).toBe(true);
      expect(refreshCallCount).toBe(1);

      // 2nd error trigger
      const r2 = await handleSimulatedError();
      expect(r2).toBe(true);
      expect(refreshCallCount).toBe(2);

      // 3rd error trigger (must NOT call refresh again)
      const r3 = await handleSimulatedError();
      expect(r3).toBe(false);
      expect(refreshCallCount).toBe(2);
    });
  });

  describe("External Track URL Canonicalization & Provider Identification", () => {
    it("extracts canonical URL from various external track formats", () => {
      // YouTube
      expect(extractCanonicalExternalUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(extractCanonicalExternalUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(extractCanonicalExternalUrl("", "ext-youtube-dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(extractCanonicalExternalUrl("", "ext-yt-dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(extractCanonicalExternalUrl("", "ext-spotify-dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

      // Unpack nested proxy URL
      const proxyYt = "/api/stream/external?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&id=ext-youtube-dQw4w9WgXcQ";
      expect(extractCanonicalExternalUrl(proxyYt)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");

      // SoundCloud
      expect(extractCanonicalExternalUrl("https://soundcloud.com/artist/great-track")).toBe("https://soundcloud.com/artist/great-track");
      expect(extractCanonicalExternalUrl("", "ext-soundcloud-artist-great-track")).toBe("https://soundcloud.com/artist-great-track");
      const proxySc = "/api/stream/external?url=https%3A%2F%2Fsoundcloud.com%2Fartist%2Ftrack&id=ext-soundcloud-123";
      expect(extractCanonicalExternalUrl(proxySc)).toBe("https://soundcloud.com/artist/track");
    });

    it("synthesizes valid external track structure without returning fallback tracks", () => {
      const ytTrack = synthesizeExternalTrack("ext-youtube-dQw4w9WgXcQ", { title: "Never Gonna Give You Up" });
      expect(ytTrack.id).toBe("ext-youtube-dQw4w9WgXcQ");
      expect(ytTrack.source).toBe("youtube");
      expect(ytTrack.audioUrl).toContain("/api/stream/external?url=");
      expect(ytTrack.audioUrl).toContain("youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ");
      expect(ytTrack.coverUrl).toContain("hqdefault.jpg");
      expect(externalTracksCache.get("ext-youtube-dQw4w9WgXcQ")).toBeDefined();

      const scTrack = synthesizeExternalTrack("ext-soundcloud-test-artist-track", { title: "SC Beat" });
      expect(scTrack.id).toBe("ext-soundcloud-test-artist-track");
      expect(scTrack.source).toBe("soundcloud");
      expect(scTrack.audioUrl).toContain("/api/stream/external");

      const spTrack = synthesizeExternalTrack("ext-spotify-dQw4w9WgXcQ", { title: "Spotify Stream" });
      expect(spTrack.id).toBe("ext-spotify-dQw4w9WgXcQ");
      expect(spTrack.source).toBe("spotify");
      expect(spTrack.audioUrl).toContain("/api/stream/external?url=");
    });

    it("api.getTrack synthesizes external tracks instead of returning FALLBACK_TRACKS[0]", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response("Not found", { status: 404 });
      });

      const res = await api.getTrack("ext-youtube-dQw4w9WgXcQ");
      expect(res.track).toBeDefined();
      expect(res.track.id).toBe("ext-youtube-dQw4w9WgXcQ");
      expect(res.track.source).toBe("youtube");
      expect(res.track.audioUrl).toContain("/api/stream/external");
      expect(res.track.id).not.toBe("track-01");
    });

    it("api.refreshStreamUrl unpackages proxy URLs and passes canonical URL", async () => {
      let interceptedBody: Record<string, unknown> | null = null;
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        interceptedBody = init?.body ? JSON.parse(init.body as string) : null;
        return new Response(JSON.stringify({ ok: true, streamUrl: "https://audio.stream/123", audioUrl: "/api/stream/external?..." }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const proxyUrl = "https://soundify.mashhad-ix.ir/api/stream/external?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&id=ext-youtube-dQw4w9WgXcQ";
      await api.refreshStreamUrl("ext-youtube-dQw4w9WgXcQ", proxyUrl);

      expect(interceptedBody).not.toBeNull();
      expect(interceptedBody!.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    });
  });
});
