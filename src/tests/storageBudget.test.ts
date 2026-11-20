import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  clearAllDownloadedTracks,
  enforceStorageBudget,
  getAllDownloadedTracks,
  getDownloadedTrack,
  getDownloadedTrackBlobUrl,
  getStorageBudget,
  getStorageBudgetInfo,
  registerEvictionListener,
  saveDownloadedTrack,
  setStorageBudget,
  touchTrackAccess,
} from "@/lib/offlineAudioStorage";
import type { Track } from "@/lib/types";

function createTestTrack(id: string, title: string): Track {
  return {
    id,
    title,
    titleFa: title,
    artistId: "artist-1",
    artistName: "Test Artist",
    artistNameFa: "هنرمند آزمایشی",
    artistAvatarColor: "#6366f1",
    album: "Test Album",
    albumFa: "آلبوم آزمایشی",
    genre: "Pop",
    mood: "Chill",
    durationSec: 180,
    audioUrl: `/api/tracks/${id}/stream`,
    coverUrl: `/api/tracks/${id}/cover`,
    accentColor: "#6366f1",
    waveform: [0.1, 0.5, 0.9],
    hasLyrics: true,
    lyricsSource: "lrclib",
    playsCount: 50,
    likesCount: 10,
    repostsCount: 2,
    likedByMe: false,
    repostedByMe: false,
    uploadedBy: "tester",
    createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("Offline Storage LRU & Cache Budgeting", () => {
  beforeEach(async () => {
    await clearAllDownloadedTracks();
    setStorageBudget({
      maxStorageBytes: 250 * 1024 * 1024,
      maxTracks: 50,
    });
  });

  afterEach(async () => {
    await clearAllDownloadedTracks();
    setStorageBudget({
      maxStorageBytes: 250 * 1024 * 1024,
      maxTracks: 50,
    });
  });

  it("configures and retrieves storage budget accurately", () => {
    setStorageBudget({
      maxStorageBytes: 100 * 1024 * 1024,
      maxTracks: 20,
    });

    const budget = getStorageBudget();
    expect(budget.maxStorageBytes).toBe(100 * 1024 * 1024);
    expect(budget.maxTracks).toBe(20);
  });

  it("evicts least recently accessed tracks when track count budget is exceeded", async () => {
    // Set max limit to 3 tracks
    setStorageBudget({ maxTracks: 3, maxStorageBytes: 10 * 1024 * 1024 });

    const track1 = createTestTrack("track-1", "Track 1");
    const track2 = createTestTrack("track-2", "Track 2");
    const track3 = createTestTrack("track-3", "Track 3");
    const track4 = createTestTrack("track-4", "Track 4");

    const audioBlob = new Blob(["audio-bytes"], { type: "audio/mpeg" });

    // Save 3 tracks
    await saveDownloadedTrack(track1, audioBlob);
    await new Promise((r) => setTimeout(r, 20));
    await saveDownloadedTrack(track2, audioBlob);
    await new Promise((r) => setTimeout(r, 20));
    await saveDownloadedTrack(track3, audioBlob);

    let all = await getAllDownloadedTracks();
    expect(all.length).toBe(3);

    // Touch track 1 access so it is more recently used than track 2!
    await new Promise((r) => setTimeout(r, 20));
    await touchTrackAccess(track1.id);

    // Now save track 4, which should trigger LRU eviction of track 2 (least recently used)
    await new Promise((r) => setTimeout(r, 20));
    await saveDownloadedTrack(track4, audioBlob);

    all = await getAllDownloadedTracks();
    expect(all.length).toBe(3);

    const ids = all.map((t) => t.trackId);
    expect(ids).toContain("track-1"); // Kept because accessed
    expect(ids).toContain("track-3"); // Kept because newer than track 2
    expect(ids).toContain("track-4"); // Newly added
    expect(ids).not.toContain("track-2"); // Evicted!
  });

  it("evicts least recently accessed tracks when byte budget is exceeded", async () => {
    // 30 KB max budget
    const maxBytes = 30 * 1024;
    setStorageBudget({ maxStorageBytes: maxBytes, maxTracks: 100 });

    const trackA = createTestTrack("track-a", "Track A");
    const trackB = createTestTrack("track-b", "Track B");
    const trackC = createTestTrack("track-c", "Track C");

    // Each track is 12 KB
    const blob12k = new Blob([new Uint8Array(12 * 1024)], { type: "audio/mpeg" });

    await saveDownloadedTrack(trackA, blob12k);
    await new Promise((r) => setTimeout(r, 20));
    await saveDownloadedTrack(trackB, blob12k);

    let info = await getStorageBudgetInfo();
    expect(info.trackCount).toBe(2);
    expect(info.usageBytes).toBe(24 * 1024);

    // Adding track C (12KB) -> total would be 36KB (> 30KB budget)
    // Should evict track A (oldest)
    await new Promise((r) => setTimeout(r, 20));
    await saveDownloadedTrack(trackC, blob12k);

    info = await getStorageBudgetInfo();
    expect(info.trackCount).toBe(2);
    expect(info.usageBytes).toBe(24 * 1024);

    const all = await getAllDownloadedTracks();
    const ids = all.map((t) => t.trackId);
    expect(ids).toContain("track-b");
    expect(ids).toContain("track-c");
    expect(ids).not.toContain("track-a"); // Evicted!
  });

  it("notifies registered eviction listeners when tracks are evicted", async () => {
    setStorageBudget({ maxTracks: 2, maxStorageBytes: 10 * 1024 * 1024 });

    const evictedIds: string[] = [];
    const unregister = registerEvictionListener((ids) => {
      evictedIds.push(...ids);
    });

    const track1 = createTestTrack("evict-1", "Track 1");
    const track2 = createTestTrack("evict-2", "Track 2");
    const track3 = createTestTrack("evict-3", "Track 3");
    const blob = new Blob(["test"], { type: "audio/mpeg" });

    await saveDownloadedTrack(track1, blob);
    await new Promise((r) => setTimeout(r, 10));
    await saveDownloadedTrack(track2, blob);
    await new Promise((r) => setTimeout(r, 10));
    await saveDownloadedTrack(track3, blob); // should evict evict-1

    expect(evictedIds).toContain("evict-1");
    unregister();
  });

  it("updates access metadata on getDownloadedTrack", async () => {
    const track = createTestTrack("meta-1", "Meta Track");
    const blob = new Blob(["test"], { type: "audio/mpeg" });
    const saved = await saveDownloadedTrack(track, blob);

    expect(saved.accessCount).toBe(1);
    const initialAccess = saved.lastAccessedAt;

    await new Promise((r) => setTimeout(r, 25));
    const fetched = await getDownloadedTrack(track.id);
    expect(fetched).not.toBeNull();

    // Verify touchTrackAccess updated timestamp
    await touchTrackAccess(track.id);
    const refetched = await getDownloadedTrack(track.id);
    expect(refetched?.lastAccessedAt).toBeGreaterThanOrEqual(initialAccess || 0);
  });

  it("manually enforces storage budget and retrieves blob URL", async () => {
    setStorageBudget({ maxTracks: 2, maxStorageBytes: 10 * 1024 * 1024 });
    const track1 = createTestTrack("blob-1", "Blob Track 1");
    const track2 = createTestTrack("blob-2", "Blob Track 2");
    const track3 = createTestTrack("blob-3", "Blob Track 3");
    const blob = new Blob(["audio-sample"], { type: "audio/mpeg" });

    await saveDownloadedTrack(track1, blob);
    await saveDownloadedTrack(track2, blob);

    const blobUrl = await getDownloadedTrackBlobUrl(track1.id);
    expect(blobUrl).toBeDefined();

    // Trigger explicit enforcement with incoming bytes for track3
    const eviction = await enforceStorageBudget(blob.size);
    expect(eviction).toBeDefined();
    await saveDownloadedTrack(track3, blob);
    const count = (await getAllDownloadedTracks()).length;
    expect(count).toBeLessThanOrEqual(2);
  });

  it("protects currently playing track's Object URL from eviction when library or prebuffering is active", async () => {
    const { setCurrentlyPlayingTrackId, getCachedAudioBlobUrl } = await import("@/lib/offlineAudioStorage");

    setStorageBudget({ maxTracks: 50, maxStorageBytes: 100 * 1024 * 1024 });

    // Create playing track
    const activeTrack = createTestTrack("playing-now", "Active Playing Track");
    const sampleBlob = new Blob(["sample-audio"], { type: "audio/mpeg" });
    await saveDownloadedTrack(activeTrack, sampleBlob);

    const activeUrl = await getDownloadedTrackBlobUrl(activeTrack.id);
    expect(activeUrl).not.toBeNull();

    // Mark as currently playing
    setCurrentlyPlayingTrackId(activeTrack.id);

    // Now simulate prebuffering 26 upcoming tracks into blob URLs (exceeding MAX_ACTIVE_BLOB_URLS = 24)
    for (let i = 0; i < 26; i++) {
      const qTrack = createTestTrack(`queue-track-${i}`, `Queue ${i}`);
      await saveDownloadedTrack(qTrack, sampleBlob);
      await getDownloadedTrackBlobUrl(qTrack.id);
    }

    // Active track URL must still be preserved and NOT revoked!
    const preservedUrl = getCachedAudioBlobUrl(activeTrack.id);
    expect(preservedUrl).toBe(activeUrl);

    // Cleanup
    setCurrentlyPlayingTrackId(null);
  });
});
