import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveDownloadedTrack,
  getDownloadedTrack,
  isTrackDownloaded,
  getAllDownloadedTracks,
  removeDownloadedTrack,
  getDownloadedTrackBlobUrl,
  getDownloadedCoverBlobUrl,
  revokeBlobUrlsForTrack,
  revokeAllBlobUrls,
  clearAllDownloadedTracks,
  estimateStorageUsage,
  getDownloadedLyrics,
  updateDownloadedLyrics,
} from "@/lib/offlineAudioStorage";
import type { Track } from "@/lib/types";

const mockTrack: Track = {
  id: "track-test-1",
  title: "Test Track",
  titleFa: "آهنگ آزمایشی",
  artistId: "artist-1",
  artistName: "Test Artist",
  artistNameFa: "هنرمند آزمایشی",
  artistAvatarColor: "#6366f1",
  album: "Test Album",
  albumFa: "آلبوم آزمایشی",
  genre: "Pop",
  mood: "Happy",
  durationSec: 180,
  audioUrl: "/api/tracks/track-test-1/stream",
  coverUrl: "/api/tracks/track-test-1/cover",
  accentColor: "#6366f1",
  waveform: [0.1, 0.5, 0.9, 0.4],
  hasLyrics: true,
  lyricsSource: "lrclib",
  playsCount: 100,
  likesCount: 25,
  repostsCount: 5,
  likedByMe: false,
  repostedByMe: false,
  uploadedBy: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
};

describe("offlineAudioStorage", () => {
  beforeEach(async () => {
    await clearAllDownloadedTracks();
  });

  afterEach(async () => {
    await clearAllDownloadedTracks();
  });

  it("saves and retrieves a track with audio blob and lyrics", async () => {
    const audioBlob = new Blob(["fake-audio-bytes"], { type: "audio/mpeg" });
    const coverBlob = new Blob(["fake-cover-bytes"], { type: "image/jpeg" });
    const lyrics = {
      lines: [
        { timeMs: 1000, text: "Line 1" },
        { timeMs: 3000, text: "Line 2" },
      ],
      source: "lrclib",
      lyricsOffsetMs: 150,
    };

    const saved = await saveDownloadedTrack(mockTrack, audioBlob, lyrics, coverBlob);
    expect(saved.trackId).toBe(mockTrack.id);
    expect(saved.sizeBytes).toBe(audioBlob.size + coverBlob.size);
    expect(saved.lyrics?.lines.length).toBe(2);

    const fetched = await getDownloadedTrack(mockTrack.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.track.title).toBe(mockTrack.title);
    expect(fetched?.lyrics?.lines[0].text).toBe("Line 1");
    expect(fetched?.lyrics?.lyricsOffsetMs).toBe(150);

    const isDownloaded = await isTrackDownloaded(mockTrack.id);
    expect(isDownloaded).toBe(true);
  });

  it("handles non-existent track lookup gracefully", async () => {
    const result = await getDownloadedTrack("non-existent-id");
    expect(result).toBeNull();

    const isDownloaded = await isTrackDownloaded("non-existent-id");
    expect(isDownloaded).toBe(false);
  });

  it("removes a track and returns true, then false if called again", async () => {
    const audioBlob = new Blob(["audio-data"], { type: "audio/mpeg" });
    await saveDownloadedTrack(mockTrack, audioBlob);

    expect(await isTrackDownloaded(mockTrack.id)).toBe(true);

    const removed = await removeDownloadedTrack(mockTrack.id);
    expect(removed).toBe(true);
    expect(await isTrackDownloaded(mockTrack.id)).toBe(false);

    const removedAgain = await removeDownloadedTrack(mockTrack.id);
    expect(removedAgain).toBe(false);
  });

  it("lists all downloaded tracks sorted newest first", async () => {
    const audioBlob = new Blob(["audio-data"], { type: "audio/mpeg" });
    const track2: Track = { ...mockTrack, id: "track-test-2", title: "Second Track" };

    await saveDownloadedTrack(mockTrack, audioBlob);
    await new Promise((r) => setTimeout(r, 10));
    await saveDownloadedTrack(track2, audioBlob);

    const all = await getAllDownloadedTracks();
    expect(all.length).toBe(2);
    expect(all[0].trackId).toBe("track-test-2");
    expect(all[1].trackId).toBe(mockTrack.id);
  });

  it("creates and reuses object URLs without re-allocating", async () => {
    // Mock URL.createObjectURL and URL.revokeObjectURL
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;

    let createCalls = 0;
    let revokeCalls = 0;

    URL.createObjectURL = vi.fn(() => {
      createCalls++;
      return `blob:mock-url-${createCalls}`;
    });
    URL.revokeObjectURL = vi.fn(() => {
      revokeCalls++;
    });

    try {
      const audioBlob = new Blob(["audio-bytes"], { type: "audio/mpeg" });
      const coverBlob = new Blob(["cover-bytes"], { type: "image/jpeg" });
      await saveDownloadedTrack(mockTrack, audioBlob, undefined, coverBlob);

      const url1 = await getDownloadedTrackBlobUrl(mockTrack.id);
      const url2 = await getDownloadedTrackBlobUrl(mockTrack.id);

      expect(url1).toBe("blob:mock-url-1");
      expect(url2).toBe("blob:mock-url-1");
      expect(createCalls).toBe(1); // Reused!

      const coverUrl1 = await getDownloadedCoverBlobUrl(mockTrack.id);
      const coverUrl2 = await getDownloadedCoverBlobUrl(mockTrack.id);
      expect(coverUrl1).toBe("blob:mock-url-2");
      expect(coverUrl2).toBe("blob:mock-url-2");

      revokeBlobUrlsForTrack(mockTrack.id);
      expect(revokeCalls).toBe(2);

      // Now asking again should recreate
      const url3 = await getDownloadedTrackBlobUrl(mockTrack.id);
      expect(url3).toBe("blob:mock-url-3");

      revokeAllBlobUrls();
      expect(revokeCalls).toBe(3);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("validates input errors properly", async () => {
    await expect(saveDownloadedTrack(null as unknown as Track, new Blob([]))).rejects.toThrow();
    await expect(saveDownloadedTrack(mockTrack, null as unknown as Blob)).rejects.toThrow();
  });

  it("estimates storage usage with track counts and size sums", async () => {
    const audioBlob = new Blob(["a".repeat(1024 * 10)], { type: "audio/mpeg" }); // 10 KB
    await saveDownloadedTrack(mockTrack, audioBlob);

    const est = await estimateStorageUsage();
    expect(est.trackCount).toBe(1);
    expect(est.usageBytes).toBeGreaterThanOrEqual(1024 * 10);
    expect(est.quotaBytes).toBeGreaterThan(0);
  });

  it("retains cover blob URLs for 20+ tracks without premature eviction", async () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;

    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];

    URL.createObjectURL = vi.fn(() => {
      const url = `blob:test-${createdUrls.length + 1}`;
      createdUrls.push(url);
      return url;
    });
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url);
    });

    try {
      const tracks: Track[] = Array.from({ length: 20 }, (_, i) => ({
        ...mockTrack,
        id: `multi-track-${i + 1}`,
        title: `Song ${i + 1}`,
      }));

      for (const tr of tracks) {
        const audioBlob = new Blob(["audio"], { type: "audio/mpeg" });
        const coverBlob = new Blob(["cover"], { type: "image/jpeg" });
        await saveDownloadedTrack(tr, audioBlob, undefined, coverBlob);
      }

      // Obtain cover URLs for all 20 tracks
      const coverUrls: (string | null)[] = [];
      for (const tr of tracks) {
        coverUrls.push(await getDownloadedCoverBlobUrl(tr.id));
      }

      // Verify all 20 cover URLs were created and NONE were prematurely revoked
      expect(coverUrls).toHaveLength(20);
      expect(coverUrls.every((u) => u !== null)).toBe(true);
      expect(revokedUrls).toHaveLength(0); // 0 revoked!

      // Now verify that cleanAllDownloadedTracks revokes all of them
      await clearAllDownloadedTracks();
      expect(revokedUrls.length).toBeGreaterThanOrEqual(20);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("accepts string lyrics and stores fallback cleanly", async () => {
    const audioBlob = new Blob(["audio"], { type: "audio/mpeg" });
    const saved = await saveDownloadedTrack(mockTrack, audioBlob, "Line 1\nLine 2");
    expect(saved.lyrics?.source).toBe("plain");
    expect(saved.lyrics?.lines.length).toBe(2);

    const fetched = await getDownloadedTrack(mockTrack.id);
    expect(fetched?.lyrics?.source).toBe("plain");
    expect(fetched?.lyrics?.lines[0].text).toBe("Line 1");
  });

  it("parses LRC formatted string lyrics and sets timestamped lines", async () => {
    const audioBlob = new Blob(["audio"], { type: "audio/mpeg" });
    const lrcText = "[00:12.50]First line of lyrics\n[00:25.00]Second line of lyrics";
    const saved = await saveDownloadedTrack(mockTrack, audioBlob, lrcText);
    expect(saved.lyrics?.source).toBe("lrc");
    expect(saved.lyrics?.lines.length).toBe(2);
    expect(saved.lyrics?.lines[0].timeMs).toBe(12500);
    expect(saved.lyrics?.lines[0].text).toBe("First line of lyrics");
  });

  it("updates offline lyrics for an existing downloaded track via updateDownloadedLyrics", async () => {
    const audioBlob = new Blob(["audio"], { type: "audio/mpeg" });
    await saveDownloadedTrack(mockTrack, audioBlob);

    const initial = await getDownloadedLyrics(mockTrack.id);
    expect(initial).toBeNull();

    const updated = await updateDownloadedLyrics(mockTrack.id, {
      lines: [
        { timeMs: 5000, text: "Updated line 1" },
        { timeMs: 10000, text: "Updated line 2" },
      ],
      source: "custom-sync",
      lyricsOffsetMs: -200,
    });
    expect(updated).toBe(true);

    const afterUpdate = await getDownloadedLyrics(mockTrack.id);
    expect(afterUpdate).not.toBeNull();
    expect(afterUpdate?.source).toBe("custom-sync");
    expect(afterUpdate?.lines[0].text).toBe("Updated line 1");
    expect(afterUpdate?.lyricsOffsetMs).toBe(-200);
  });
});
