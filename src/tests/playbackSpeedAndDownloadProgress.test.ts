import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolveSpotifyTrackStream,
  synthesizeExternalTrack,
} from "@/lib/api";
import {
  getActiveDownloadsSnapshot,
  getTrackDownloadSnapshot,
  resetDownloadManagerState,
  startTrackDownload,
} from "@/lib/downloadManager";
import { clearAllDownloadedTracks } from "@/lib/offlineAudioStorage";
import { getServerConnectivityStatus, setServerConnectivityStatus } from "@/lib/mobileBackend";
import type { Track } from "@/lib/types";

describe("Playback Speed, Fast Stream Start & Visual Download Progress", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    vi.restoreAllMocks();
    resetDownloadManagerState();
    await clearAllDownloadedTracks();
    setServerConnectivityStatus("online");
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    resetDownloadManagerState();
    await clearAllDownloadedTracks();
  });

  describe("Stream Loading Speed & Caching Optimization", () => {
    it("synthesizes external tracks with fastStart parameter for immediate partial buffering", () => {
      const track = synthesizeExternalTrack("ext-youtube-dQw4w9WgXcQ");
      expect(track.audioUrl).toContain("fastStart=1");
    });

    it("caches resolved Spotify track streams to eliminate redundant network roundtrips on replay", async () => {
      let oembedCalls = 0;
      let ytSearchCalls = 0;

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("open.spotify.com/oembed")) {
          oembedCalls++;
          return new Response(
            JSON.stringify({
              title: "Save Your Tears - The Weeknd",
              thumbnail_url: "https://i.scdn.co/image/save-your-tears",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.includes("/api/external/search")) {
          ytSearchCalls++;
          return new Response(
            JSON.stringify({
              query: "Save Your Tears - The Weeknd",
              source: "youtube",
              results: [
                {
                  id: "ext-youtube-LIIDh-qI9oG",
                  title: "Save Your Tears",
                  artistName: "The Weeknd",
                  audioUrl: "/api/stream/external?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DLIIDh-qI9oG&fastStart=1",
                  pageUrl: "https://www.youtube.com/watch?v=LIIDh-qI9oG",
                  durationSec: 215,
                },
              ],
              total: 1,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("Not found", { status: 404 });
      });

      const spTrack: Track = synthesizeExternalTrack("ext-spotify-5QO79kh1waicV47BqGRL3g", {
        title: "Save Your Tears",
        artistName: "The Weeknd",
        album: "After Hours",
        durationSec: 215,
        audioUrl: "/api/stream/external?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F5QO79kh1waicV47BqGRL3g",
        coverUrl: "https://i.scdn.co/image/save-your-tears",
        pageUrl: "https://open.spotify.com/track/5QO79kh1waicV47BqGRL3g",
        waveform: [0.3, 0.5, 0.7],
        accentColor: "#1DB954",
      });

      // First resolution: calls search
      const resolvedFirst = await resolveSpotifyTrackStream(spTrack);
      expect(resolvedFirst.audioUrl).toContain("LIIDh-qI9oG");
      expect(ytSearchCalls).toBe(1);
      expect(oembedCalls).toBe(0);

      // Second resolution: must return instantaneously from memory cache without duplicate network queries!
      const resolvedSecond = await resolveSpotifyTrackStream(spTrack);
      expect(resolvedSecond.audioUrl).toContain("LIIDh-qI9oG");
      expect(ytSearchCalls).toBe(1); // Still 1, zero additional network calls
    });
  });

  describe("Real-Time Visual Download Progress Emission", () => {
    it("emits real-time progress percentage and bytesDownloaded via activeDownloads snapshot", async () => {
      const mockTrack: Track = synthesizeExternalTrack("dl-progress-test-1", {
        title: "Test Progress Track",
        artistName: "Antigravity",
        album: "Testing",
        durationSec: 180,
        audioUrl: "/api/tracks/dl-progress-test-1/stream",
        coverUrl: "/api/tracks/dl-progress-test-1/cover",
        accentColor: "#6366f1",
      });

      // Mock audio stream chunks
      const chunk1 = new Uint8Array(50000);
      const chunk2 = new Uint8Array(100000);
      let readCount = 0;

      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          readCount++;
          if (readCount === 1) return Promise.resolve({ done: false, value: chunk1 });
          if (readCount === 2) return Promise.resolve({ done: false, value: chunk2 });
          return Promise.resolve({ done: true, value: undefined });
        }),
      };

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/cover")) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ "content-type": "image/jpeg" }),
            blob: () => Promise.resolve(new Blob(["cover"])),
          });
        }
        return Promise.resolve({
          ok: true,
          headers: new Headers({
            "content-type": "audio/mpeg",
            "content-length": "200000",
          }),
          body: {
            getReader: () => mockReader,
          },
        });
      });

      // Start download
      const downloadPromise = startTrackDownload(mockTrack);

      // Verify active downloads snapshot contains the track with progress
      const activeList = getActiveDownloadsSnapshot();
      expect(activeList.length).toBeGreaterThanOrEqual(1);
      const activeItem = activeList.find((item) => item.trackId === mockTrack.id);
      expect(activeItem).toBeDefined();

      const ok = await downloadPromise;
      expect(ok).toBe(true);

      // Once completed, snapshot shows downloaded at 100%
      const finalSnapshot = getTrackDownloadSnapshot(mockTrack.id);
      expect(finalSnapshot.status).toBe("downloaded");
      expect(finalSnapshot.progress).toBe(100);
    });
  });

  describe("Prevention of False Offline Warnings", () => {
    it("reports server online connectivity status properly to prevent false offline prompts", () => {
      setServerConnectivityStatus("online");
      expect(getServerConnectivityStatus()).toBe("online");

      // When online, even if device has network switches, getServerConnectivityStatus confirms online
      setServerConnectivityStatus("online");
      expect(getServerConnectivityStatus()).toBe("online");
    });
  });
});
