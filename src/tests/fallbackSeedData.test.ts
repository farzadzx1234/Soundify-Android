import { describe, expect, it, vi } from "vitest";
import {
  FALLBACK_ARTISTS,
  FALLBACK_PLAYLISTS,
  FALLBACK_TRACKS,
  getFallbackLyrics,
} from "../lib/fallbackSeedData";
import { api } from "../lib/api";

describe("Bundled Offline Fallback Seed Catalog & Resilient Loading", () => {
  it("contains rich fallback tracks with authentic metadata, waveforms, and artwork", () => {
    expect(FALLBACK_TRACKS.length).toBeGreaterThanOrEqual(15);

    for (const track of FALLBACK_TRACKS) {
      expect(track.id).toMatch(/^track-\d+$/);
      expect(track.title.length).toBeGreaterThan(0);
      expect(track.titleFa?.length).toBeGreaterThan(0);
      expect(track.artistName.length).toBeGreaterThan(0);
      expect(track.artistNameFa?.length).toBeGreaterThan(0);
      expect(track.durationSec).toBeGreaterThan(60);
      expect(track.waveform?.length).toBe(64);
      expect(track.coverUrl).toMatch(/^\/covers\/track-\d+\.(jpg|webp)$/);
      expect(track.audioUrl).toMatch(/^\/audio\/[\w-]+\.mp3$/);
      expect(track.hasLyrics).toBe(true);
    }
  });

  it("contains curated featured playlists with mosaic artwork arrays", () => {
    expect(FALLBACK_PLAYLISTS.length).toBeGreaterThanOrEqual(4);

    for (const pl of FALLBACK_PLAYLISTS) {
      expect(pl.id).toMatch(/^pl-/);
      expect(pl.title.length).toBeGreaterThan(0);
      expect(pl.titleFa?.length).toBeGreaterThan(0);
      expect(pl.coverUrls.length).toBeGreaterThanOrEqual(3);
      expect(pl.trackCount).toBeGreaterThan(0);
    }
  });

  it("contains distinguished Iranian and international artists", () => {
    expect(FALLBACK_ARTISTS.length).toBeGreaterThanOrEqual(10);

    const shajarian = FALLBACK_ARTISTS.find((a) => a.id === "artist-shajarian");
    expect(shajarian).toBeDefined();
    expect(shajarian?.name).toBe("Homayoun Shajarian");
    expect(shajarian?.nameFa).toBe("همایون شجریان");
    expect(shajarian?.verified).toBe(true);
  });

  it("parses synced LRC lyrics for fallback tracks", () => {
    const res = getFallbackLyrics("track-01");
    expect(res.trackId).toBe("track-01");
    expect(res.lines.length).toBeGreaterThan(0);
    expect(res.lines[0].text.length).toBeGreaterThan(0);
  });

  it("api.getTracks transparently serves bundled seeds when backend fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network connection refused"));

    try {
      const res = await api.getTracks();
      expect(res.tracks).toBeDefined();
      expect(res.tracks.length).toBe(FALLBACK_TRACKS.length);
      expect(res.tracks[0].title).toBe(FALLBACK_TRACKS[0].title);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("api.getPlaylists transparently serves bundled playlists when backend fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Server offline"));

    try {
      const res = await api.getPlaylists();
      expect(res.playlists).toBeDefined();
      expect(res.playlists.length).toBe(FALLBACK_PLAYLISTS.length);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("api.getArtists transparently serves bundled artists when backend fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Timeout"));

    try {
      const res = await api.getArtists();
      expect(res.artists).toBeDefined();
      expect(res.artists.length).toBe(FALLBACK_ARTISTS.length);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("api.searchExternal filters bundled seeds when network search fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("No internet"));

    try {
      const res = await api.searchExternal("Chavoshi");
      expect(res.results.length).toBeGreaterThanOrEqual(1);
      expect(res.results[0].artistName).toContain("Chavoshi");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("apiFetch triggers timeout abort and falls back when network request hangs", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_, reject) => {
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        }
      });
    });

    try {
      const res = await api.getTracks();
      expect(res.tracks).toBeDefined();
      expect(res.tracks.length).toBe(FALLBACK_TRACKS.length);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
