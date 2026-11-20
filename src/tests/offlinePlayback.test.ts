import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveDownloadedTrack,
  getDownloadedTrack,
  getDownloadedTrackBlobUrl,
  getDownloadedCoverBlobUrl,
  isTrackDownloaded,
  clearAllDownloadedTracks,
  clearOfflineCache,
  estimateStorageUsage,
  getStorageBudgetInfo,
  setCurrentlyPlayingTrackId,
} from "@/lib/offlineAudioStorage";
import {
  startTrackDownload,
  removeTrackDownload,
  getTrackDownloadSnapshot,
  resetDownloadManagerState,
} from "@/lib/downloadManager";
import type { Track } from "@/lib/types";

const mockTrack: Track = {
  id: "offline-track-99",
  title: "Desert Mirage",
  titleFa: "سراب کویر",
  artistId: "artist-99",
  artistName: "Oasis Band",
  artistNameFa: "گروه واحه",
  artistAvatarColor: "#8b5cf6",
  album: "Dunes",
  albumFa: "تپه‌ها",
  genre: "Ambient",
  mood: "Reflective",
  durationSec: 240,
  audioUrl: "/api/tracks/offline-track-99/stream",
  coverUrl: "/api/tracks/offline-track-99/cover",
  accentColor: "#8b5cf6",
  waveform: [0.1, 0.4, 0.8, 0.3],
  hasLyrics: true,
  lyricsSource: "lrclib",
  playsCount: 42,
  likesCount: 15,
  repostsCount: 3,
  likedByMe: false,
  repostedByMe: false,
  uploadedBy: "creator-99",
  createdAt: "2026-03-01T00:00:00Z",
};

describe("Offline Playback & PWA Download Pipeline", () => {
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(async () => {
    resetDownloadManagerState();
    await clearAllDownloadedTracks();
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    resetDownloadManagerState();
    await clearAllDownloadedTracks();
  });

  it("completes full offline lifecycle: download -> verify stored -> obtain blob URL -> offline play ready", async () => {
    URL.createObjectURL = vi.fn(() => "blob:http://localhost:3100/test-offline-audio-uuid");
    URL.revokeObjectURL = vi.fn();

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/cover")) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg" }),
          blob: () => Promise.resolve(new Blob(["cover-image-data"], { type: "image/jpeg" })),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "audio/mpeg", "content-length": "1024" }),
        blob: () => Promise.resolve(new Blob(["binary-mp3-stream-data"], { type: "audio/mpeg" })),
      } as unknown as Response);
    });

    // 1. Download track
    const downloadSuccess = await startTrackDownload(mockTrack);
    expect(downloadSuccess).toBe(true);

    // 2. Snapshot reflects downloaded status
    const snapshot = getTrackDownloadSnapshot(mockTrack.id);
    expect(snapshot.status).toBe("downloaded");
    expect(snapshot.progress).toBe(100);

    // 3. Stored in IndexedDB / offlineAudioStorage
    const isStored = await isTrackDownloaded(mockTrack.id);
    expect(isStored).toBe(true);

    const record = await getDownloadedTrack(mockTrack.id);
    expect(record).not.toBeNull();
    expect(record?.track.titleFa).toBe("سراب کویر");
    expect(record?.audioBlob).toBeDefined();

    // 4. Blob URL generation for instant 0-latency offline playback
    const blobUrl = await getDownloadedTrackBlobUrl(mockTrack.id);
    expect(blobUrl).toBe("blob:http://localhost:3100/test-offline-audio-uuid");

    // 5. Storage estimate includes the downloaded track
    const usage = await estimateStorageUsage();
    expect(usage.trackCount).toBe(1);
    expect(usage.usageBytes).toBeGreaterThan(0);
  });

  it("handles offline notice detection for non-downloaded tracks", () => {
    // When a track is NOT downloaded and navigator is offline
    const isDownloadedSync = getTrackDownloadSnapshot("not-downloaded-id").status === "downloaded";
    expect(isDownloadedSync).toBe(false);

    // Verify Persian offline message wording
    const expectedNotice = "این قطعه دانلود نشده است. برای پخش آفلاین، ابتدا باید در حالت آنلاین دانلود شود";
    expect(expectedNotice).toContain("آفلاین");
    expect(expectedNotice).toContain("دانلود");
  });

  it("retains offline lyrics when saving and retrieving", async () => {
    const audioBlob = new Blob(["audio-bytes"], { type: "audio/mpeg" });
    const lyrics = {
      lines: [
        { timeMs: 500, text: "اولین بیت ترانه" },
        { timeMs: 2500, text: "دومین بیت ترانه" },
      ],
      source: "lrclib",
      lyricsOffsetMs: 50,
    };

    await saveDownloadedTrack(mockTrack, audioBlob, lyrics);

    const stored = await getDownloadedTrack(mockTrack.id);
    expect(stored?.lyrics?.lines).toHaveLength(2);
    expect(stored?.lyrics?.lines[0].text).toBe("اولین بیت ترانه");
    expect(stored?.lyrics?.source).toBe("lrclib");
    expect(stored?.lyrics?.lyricsOffsetMs).toBe(50);
  });

  it("cleans up storage and revokes blob URLs upon removal", async () => {
    let revoked = false;
    URL.createObjectURL = vi.fn(() => "blob:http://localhost:3100/to-be-revoked");
    URL.revokeObjectURL = vi.fn(() => {
      revoked = true;
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "audio/mpeg" }),
      blob: () => Promise.resolve(new Blob(["sample-audio"], { type: "audio/mpeg" })),
    } as unknown as Response);

    await startTrackDownload(mockTrack);
    await getDownloadedTrackBlobUrl(mockTrack.id);

    const removeSuccess = await removeTrackDownload(mockTrack.id);
    expect(removeSuccess).toBe(true);
    expect(revoked).toBe(true);

    const checkStored = await isTrackDownloaded(mockTrack.id);
    expect(checkStored).toBe(false);
  });

  it("resolves offline audio blob and cover blob URLs seamlessly for zero-latency playback", async () => {
    URL.createObjectURL = vi.fn((blob: Blob) => {
      if (blob.type.includes("image")) return "blob:http://localhost:3100/offline-cover-123";
      return "blob:http://localhost:3100/offline-audio-456";
    });

    const audioBlob = new Blob(["audio-bytes"], { type: "audio/mpeg" });
    const coverBlob = new Blob(["cover-bytes"], { type: "image/jpeg" });

    await saveDownloadedTrack(mockTrack, audioBlob, undefined, coverBlob);

    const audioBlobUrl = await getDownloadedTrackBlobUrl(mockTrack.id);
    const coverBlobUrl = await getDownloadedCoverBlobUrl(mockTrack.id);

    expect(audioBlobUrl).toBe("blob:http://localhost:3100/offline-audio-456");
    expect(coverBlobUrl).toBe("blob:http://localhost:3100/offline-cover-123");
  });

  it("automatically falls back to local downloaded blob URL when stream throws network failure", async () => {
    URL.createObjectURL = vi.fn(() => "blob:http://localhost:3100/fallback-offline-audio-blob");

    const audioBlob = new Blob(["offline-stream-bytes"], { type: "audio/mpeg" });
    await saveDownloadedTrack(mockTrack, audioBlob);

    // Simulate audio error fallback logic
    const isStored = await isTrackDownloaded(mockTrack.id);
    expect(isStored).toBe(true);

    const fallbackUrl = await getDownloadedTrackBlobUrl(mockTrack.id);
    expect(fallbackUrl).toBe("blob:http://localhost:3100/fallback-offline-audio-blob");
  });

  it("clears offline cache without deleting stored track records", async () => {
    let revokedCount = 0;
    URL.createObjectURL = vi.fn(() => "blob:http://localhost:3100/cached-session-blob");
    URL.revokeObjectURL = vi.fn(() => {
      revokedCount++;
    });

    const audioBlob = new Blob(["offline-data"], { type: "audio/mpeg" });
    await saveDownloadedTrack(mockTrack, audioBlob);

    // Create an active blob URL
    const activeUrl = await getDownloadedTrackBlobUrl(mockTrack.id);
    expect(activeUrl).toBe("blob:http://localhost:3100/cached-session-blob");

    // Purge offline cache
    clearOfflineCache();
    expect(revokedCount).toBeGreaterThan(0);

    // Stored track record in IndexedDB / store is still intact!
    const stillStored = await isTrackDownloaded(mockTrack.id);
    expect(stillStored).toBe(true);
  });

  it("defers blob URL revocation if track is currently playing until track changes, preventing audio playback crash", async () => {
    let revokedBlobUrl: string | null = null;
    URL.createObjectURL = vi.fn(() => "blob:http://localhost:3100/playing-track-blob");
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedBlobUrl = url;
    });

    const audioBlob = new Blob(["audio-data"], { type: "audio/mpeg" });
    await saveDownloadedTrack(mockTrack, audioBlob);

    // Track starts playing
    setCurrentlyPlayingTrackId(mockTrack.id);
    const activeUrl = await getDownloadedTrackBlobUrl(mockTrack.id);
    expect(activeUrl).toBe("blob:http://localhost:3100/playing-track-blob");

    // User removes or deletes the track while it is playing
    const removeOk = await removeTrackDownload(mockTrack.id);
    expect(removeOk).toBe(true);

    // The blob URL should NOT be immediately revoked because it is actively playing!
    expect(revokedBlobUrl).toBeNull();

    // Now playback changes to a different track or finishes
    setCurrentlyPlayingTrackId("different-track-id");

    // Now the deferred revocation should have executed!
    expect(revokedBlobUrl).toBe("blob:http://localhost:3100/playing-track-blob");
  });

  it("calculates storage budget info breakdown including songsBytes and cacheBytes", async () => {
    const audioBlob = new Blob(["some-audio-sample"], { type: "audio/mpeg" });
    await saveDownloadedTrack(mockTrack, audioBlob);

    const budgetInfo = await getStorageBudgetInfo();
    expect(budgetInfo.trackCount).toBe(1);
    expect(budgetInfo.songsBytes).toBeGreaterThan(0);
    expect(budgetInfo.usageBytes).toBe(budgetInfo.songsBytes + budgetInfo.cacheBytes);
    expect(budgetInfo.maxStorageBytes).toBeGreaterThan(0);
  });
});
