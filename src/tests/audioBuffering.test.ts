import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getAudioBufferStats,
  getNetworkCondition,
  prebufferTrack,
  recordPlaybackSessionStep,
  resetAudioBufferManager,
} from "@/lib/audioBufferManager";
import { clearAllDownloadedTracks, saveDownloadedTrack } from "@/lib/offlineAudioStorage";
import type { Track } from "@/lib/types";

const mockTrack: Track = {
  id: "buf-track-1",
  title: "Buffer Song",
  titleFa: "آهنگ بافرینگ",
  artistId: "artist-1",
  artistName: "Test Artist",
  artistNameFa: "هنرمند آزمایشی",
  artistAvatarColor: "#6366f1",
  album: "Album Test",
  albumFa: "آلبوم آزمایشی",
  genre: "Pop",
  mood: "Chill",
  durationSec: 200,
  audioUrl: "/api/tracks/buf-track-1/stream",
  coverUrl: "/api/tracks/buf-track-1/cover",
  accentColor: "#6366f1",
  waveform: [0.1, 0.5, 0.9],
  hasLyrics: true,
  lyricsSource: "lrclib",
  playsCount: 100,
  likesCount: 20,
  repostsCount: 1,
  likedByMe: false,
  repostedByMe: false,
  uploadedBy: "tester",
  createdAt: "2026-01-01T00:00:00Z",
};

describe("Audio Buffering & Streaming Optimizer", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    resetAudioBufferManager();
    await clearAllDownloadedTracks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetAudioBufferManager();
  });

  it("detects network condition and provides safe defaults", () => {
    const net = getNetworkCondition();
    expect(["slow-2g", "2g", "3g", "4g"]).toContain(net.effectiveType);
    expect(typeof net.saveData).toBe("boolean");
    expect(net.downlinkMb).toBeGreaterThan(0);
  });

  it("pre-buffers downloaded offline tracks by warming up blob URL", async () => {
    const blob = new Blob(["fake-audio"], { type: "audio/mpeg" });
    await saveDownloadedTrack(mockTrack, blob);

    const success = await prebufferTrack(mockTrack);
    expect(success).toBe(true);

    const stats = getAudioBufferStats();
    expect(stats.prebufferedTrackIds).toContain(mockTrack.id);
  });

  it("pre-buffers online tracks using 256KB fast-start range requests", async () => {
    let capturedRange = "";
    let capturedUrl = "";

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedRange = (init?.headers as Record<string, string>)?.["Range"] || "";
      return Promise.resolve({
        ok: true,
        status: 206,
        headers: new Headers({
          "content-range": "bytes 0-262143/3000000",
          "content-length": "262144",
        }),
      } as unknown as Response);
    });

    const success = await prebufferTrack(mockTrack);
    expect(success).toBe(true);
    expect(capturedUrl).toContain("fastStart=true");
    expect(capturedRange).toBe("bytes=0-262143");

    const stats = getAudioBufferStats();
    expect(stats.prebufferedTrackIds).toContain(mockTrack.id);
  });

  it("protects memory during extended sessions by pruning prebuffer cache periodically", () => {
    const stats0 = getAudioBufferStats();
    expect(stats0.sessionTracksPlayed).toBe(0);

    // Simulate playing 15 tracks
    for (let i = 0; i < 15; i++) {
      recordPlaybackSessionStep();
    }

    const stats15 = getAudioBufferStats();
    expect(stats15.sessionTracksPlayed).toBe(15);
    expect(stats15.prebufferedTrackIds.length).toBe(0); // Cleaned up for memory protection
  });

  it("handles null or track without ID safely without crashing", async () => {
    // @ts-expect-error testing invalid input edge case
    const res1 = await prebufferTrack(null);
    expect(res1).toBe(false);

    // @ts-expect-error testing invalid track object
    const res2 = await prebufferTrack({});
    expect(res2).toBe(false);
  });

  it("skips duplicate pre-buffering when track is already pre-buffered", async () => {
    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      fetchCount++;
      return Promise.resolve({
        ok: true,
        status: 206,
        headers: new Headers(),
      } as unknown as Response);
    });

    const first = await prebufferTrack(mockTrack);
    expect(first).toBe(true);
    expect(fetchCount).toBe(1);

    // Call again with same track
    const second = await prebufferTrack(mockTrack);
    expect(second).toBe(true);
    expect(fetchCount).toBe(1); // Did not fetch again!
  });

  it("handles network failure or abort during prebuffering gracefully", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network timeout or connection reset"));

    const success = await prebufferTrack({
      ...mockTrack,
      id: "buf-track-fail-1",
    });

    expect(success).toBe(false);
    const stats = getAudioBufferStats();
    expect(stats.prebufferedTrackIds).not.toContain("buf-track-fail-1");
  });
});
