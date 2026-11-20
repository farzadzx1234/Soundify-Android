import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  startTrackDownload,
  cancelTrackDownload,
  pauseTrackDownload,
  resumeTrackDownload,
  retryTrackDownload,
  batchDeleteTracks,
  removeTrackDownload,
  getTrackDownloadSnapshot,
  initializeDownloadManager,
  processDownloadQueue,
  resetDownloadManagerState,
} from "@/lib/downloadManager";
import { clearAllDownloadedTracks, isTrackDownloaded } from "@/lib/offlineAudioStorage";
import type { Track } from "@/lib/types";

const sampleTrack: Track = {
  id: "dl-track-1",
  title: "Offline Song",
  titleFa: "آهنگ آفلاین",
  artistId: "artist-offline",
  artistName: "Offline Artist",
  artistNameFa: "خواننده آفلاین",
  artistAvatarColor: "#10b981",
  album: "Offline Album",
  albumFa: "آلبوم آفلاین",
  genre: "Traditional",
  mood: "Peaceful",
  durationSec: 210,
  audioUrl: "/api/tracks/dl-track-1/stream",
  coverUrl: "/api/tracks/dl-track-1/cover",
  accentColor: "#10b981",
  waveform: [0.2, 0.4, 0.6],
  hasLyrics: true,
  lyricsSource: "lrclib",
  playsCount: 50,
  likesCount: 10,
  repostsCount: 2,
  likedByMe: false,
  repostedByMe: false,
  uploadedBy: "creator-1",
  createdAt: "2026-02-01T00:00:00Z",
};

describe("downloadManager", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    resetDownloadManagerState();
    await clearAllDownloadedTracks();
    await initializeDownloadManager(true);
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    resetDownloadManagerState();
    await clearAllDownloadedTracks();
  });

  it("returns idle status initially for non-downloaded track", () => {
    const snapshot = getTrackDownloadSnapshot("unknown-track");
    expect(snapshot.status).toBe("idle");
    expect(snapshot.progress).toBe(0);
  });

  it("downloads a track successfully and transitions state to downloaded", async () => {
    // Mock fetch for audio and cover
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/cover")) {
        return Promise.resolve({
          ok: true,
          headers: new Headers({ "content-type": "image/jpeg", "content-length": "100" }),
          blob: () => Promise.resolve(new Blob(["mock-cover-bytes"], { type: "image/jpeg" })),
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "audio/mpeg", "content-length": "500" }),
        blob: () => Promise.resolve(new Blob(["mock-audio-bytes"], { type: "audio/mpeg" })),
      } as unknown as Response);
    });

    const success = await startTrackDownload(sampleTrack);
    expect(success).toBe(true);

    const snapshot = getTrackDownloadSnapshot(sampleTrack.id);
    expect(snapshot.status).toBe("downloaded");
    expect(snapshot.progress).toBe(100);

    const isStored = await isTrackDownloaded(sampleTrack.id);
    expect(isStored).toBe(true);
  });

  it("handles fetch failure gracefully and sets error state", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network connection lost"));

    const success = await startTrackDownload(sampleTrack);
    expect(success).toBe(false);

    const snapshot = getTrackDownloadSnapshot(sampleTrack.id);
    expect(snapshot.status).toBe("error");
    expect(snapshot.error).toContain("Network connection lost");
  });

  it("removes downloaded track and updates snapshot to idle", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "audio/mpeg" }),
      blob: () => Promise.resolve(new Blob(["audio-sample"], { type: "audio/mpeg" })),
    } as unknown as Response);

    await startTrackDownload(sampleTrack);
    expect(getTrackDownloadSnapshot(sampleTrack.id).status).toBe("downloaded");

    const removed = await removeTrackDownload(sampleTrack.id);
    expect(removed).toBe(true);
    expect(getTrackDownloadSnapshot(sampleTrack.id).status).toBe("idle");
  });

  it("allows cancelling an active download session", async () => {
    let abortListener: (() => void) | null = null;
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        if (init?.signal) {
          abortListener = () => reject(new DOMException("Aborted", "AbortError"));
          init.signal.addEventListener("abort", abortListener);
        }
      });
    });

    // Start download without awaiting immediately
    const dlPromise = startTrackDownload(sampleTrack);

    expect(getTrackDownloadSnapshot(sampleTrack.id).status).toBe("downloading");

    cancelTrackDownload(sampleTrack.id);

    const result = await dlPromise;
    expect(result).toBe(false);
    expect(getTrackDownloadSnapshot(sampleTrack.id).status).toBe("idle");
  });

  it("concurrently downloads 5 tracks and cleanly cancels one without transaction abort collisions", async () => {
    const tracks: Track[] = Array.from({ length: 5 }, (_, i) => ({
      ...sampleTrack,
      id: `dl-concurrent-${i + 1}`,
      title: `Song ${i + 1}`,
      audioUrl: `/api/tracks/dl-concurrent-${i + 1}/stream`,
      coverUrl: `/api/tracks/dl-concurrent-${i + 1}/cover`,
    }));

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: { signal?: AbortSignal }) => {
      return new Promise((resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }
        // Small delay to simulate network latency
        setTimeout(() => {
          if (init?.signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          if (typeof url === "string" && url.includes("/cover")) {
            resolve({
              ok: true,
              headers: new Headers({ "content-type": "image/jpeg" }),
              blob: () => Promise.resolve(new Blob(["cover"], { type: "image/jpeg" })),
            } as unknown as Response);
          } else {
            resolve({
              ok: true,
              headers: new Headers({ "content-type": "audio/mpeg", "content-length": "100" }),
              blob: () => Promise.resolve(new Blob(["audio"], { type: "audio/mpeg" })),
            } as unknown as Response);
          }
        }, 15);
      });
    });

    // Start all 5 downloads concurrently
    const promises = tracks.map((t) => startTrackDownload(t));

    // Cancel track 3 mid-flight
    cancelTrackDownload(tracks[2].id);

    const results = await Promise.all(promises);

    expect(results[0]).toBe(true);
    expect(results[1]).toBe(true);
    expect(results[2]).toBe(false); // Cancelled!
    expect(results[3]).toBe(true);
    expect(results[4]).toBe(true);

    expect(getTrackDownloadSnapshot(tracks[0].id).status).toBe("downloaded");
    expect(getTrackDownloadSnapshot(tracks[1].id).status).toBe("downloaded");
    expect(getTrackDownloadSnapshot(tracks[2].id).status).toBe("idle");
    expect(getTrackDownloadSnapshot(tracks[3].id).status).toBe("downloaded");
    expect(getTrackDownloadSnapshot(tracks[4].id).status).toBe("downloaded");
  });

  it("routes external YouTube cover URLs through external-cover proxy", async () => {
    const externalTrack: Track = {
      ...sampleTrack,
      id: "ext-youtube-dQw4w9WgXcQ",
      coverUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    };

    const fetchUrls: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      fetchUrls.push(url);
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "audio/mpeg" }),
        blob: () => Promise.resolve(new Blob(["mock-data"])),
      } as unknown as Response);
    });

    await startTrackDownload(externalTrack);

    const hasProxiedCover = fetchUrls.some((u) => u.includes("/api/stream/external-cover"));
    expect(hasProxiedCover).toBe(true);
  });

  it("re-attempts download with refreshed stream URL if initial external fetch returns 403", async () => {
    const externalTrack: Track = {
      ...sampleTrack,
      id: "ext-youtube-expired",
      audioUrl: "/api/stream/external?url=https%3A%2F%2Fyoutube.com%2Fexpired",
      source: "youtube",
    };

    let fetchAttempts = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      fetchAttempts++;
      if (typeof url === "string" && url.includes("/refresh-stream")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, audioUrl: "/api/stream/external?url=https%3A%2F%2Fyoutube.com%2Ffresh" }),
        } as unknown as Response);
      }
      if (typeof url === "string" && url.includes("expired")) {
        return Promise.resolve({
          ok: false,
          status: 403,
          statusText: "Forbidden",
        } as unknown as Response);
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "audio/mpeg", "content-length": "200" }),
        blob: () => Promise.resolve(new Blob(["fresh-audio-data"], { type: "audio/mpeg" })),
      } as unknown as Response);
    });

    const success = await startTrackDownload(externalTrack);
    expect(success).toBe(true);
    expect(getTrackDownloadSnapshot(externalTrack.id).status).toBe("downloaded");
    expect(fetchAttempts).toBeGreaterThanOrEqual(2);
  });

  it("estimates progress smoothly when content-length header is 0/missing", async () => {
    const chunkTrack: Track = {
      ...sampleTrack,
      id: "dl-chunked-track",
      durationSec: 180,
    };

    // ReadableStream without content-length
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 100)); // 100KB
        controller.enqueue(new Uint8Array(1024 * 100)); // 100KB
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "audio/mpeg" }), // NO content-length!
      body: stream,
    } as unknown as Response);

    const success = await startTrackDownload(chunkTrack);
    expect(success).toBe(true);
    expect(getTrackDownloadSnapshot(chunkTrack.id).status).toBe("downloaded");
  });

  it("queues downloads when concurrent limit (2) is exceeded and drains queue automatically", async () => {
    const trackA: Track = { ...sampleTrack, id: "q-track-a" };
    const trackB: Track = { ...sampleTrack, id: "q-track-b" };
    const trackC: Track = { ...sampleTrack, id: "q-track-c" };

    let resolveFetchA!: (res: Response) => void;
    let resolveFetchB!: (res: Response) => void;
    let resolveFetchC!: (res: Response) => void;

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const mockResponse = {
        ok: true,
        headers: new Headers({ "content-type": "audio/mpeg" }),
        blob: () => Promise.resolve(new Blob(["audio"])),
      } as unknown as Response;

      if (url.includes("q-track-a")) {
        return new Promise<Response>((r) => {
          resolveFetchA = () => r(mockResponse);
        });
      }
      if (url.includes("q-track-b")) {
        return new Promise<Response>((r) => {
          resolveFetchB = () => r(mockResponse);
        });
      }
      if (url.includes("q-track-c")) {
        return new Promise<Response>((r) => {
          resolveFetchC = () => r(mockResponse);
        });
      }
      return Promise.resolve(mockResponse);
    });

    const pA = startTrackDownload(trackA);
    const pB = startTrackDownload(trackB);
    const pC = startTrackDownload(trackC);

    // Track A and B should be downloading, Track C should be queued
    expect(getTrackDownloadSnapshot("q-track-a").status).toBe("downloading");
    expect(getTrackDownloadSnapshot("q-track-b").status).toBe("downloading");
    expect(getTrackDownloadSnapshot("q-track-c").status).toBe("queued");

    // Allow microtasks to run so fetch is entered
    await new Promise((r) => setTimeout(r, 10));

    // Resolve track A
    resolveFetchA({} as Response);
    await pA;
    expect(getTrackDownloadSnapshot("q-track-a").status).toBe("downloaded");

    // Track C should now have been pulled from queue and start downloading
    expect(getTrackDownloadSnapshot("q-track-c").status).toBe("downloading");

    // Allow Track C fetch to be entered
    await new Promise((r) => setTimeout(r, 10));

    // Complete B and C
    resolveFetchB({} as Response);
    resolveFetchC({} as Response);
    await Promise.all([pB, pC]);

    expect(getTrackDownloadSnapshot("q-track-b").status).toBe("downloaded");
    expect(getTrackDownloadSnapshot("q-track-c").status).toBe("downloaded");
  });

  it("supports pausing and resuming a track download", async () => {
    const pauseTrack: Track = { ...sampleTrack, id: "pause-resume-track" };

    let abortFired = false;
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          abortFired = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    const p = startTrackDownload(pauseTrack);
    expect(getTrackDownloadSnapshot(pauseTrack.id).status).toBe("downloading");

    // Allow fetch to be initiated
    await new Promise((r) => setTimeout(r, 10));

    pauseTrackDownload(pauseTrack.id);
    expect(abortFired).toBe(true);
    expect(getTrackDownloadSnapshot(pauseTrack.id).status).toBe("paused");
    const pausedResult = await p;
    expect(pausedResult).toBe(false);

    // Now resume download with a succeeding mock fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "audio/mpeg" }),
      blob: () => Promise.resolve(new Blob(["resumed-audio"])),
    } as unknown as Response);

    const resumeSuccess = await resumeTrackDownload(pauseTrack);
    expect(resumeSuccess).toBe(true);
    expect(getTrackDownloadSnapshot(pauseTrack.id).status).toBe("downloaded");
  });

  it("supports retrying a failed download", async () => {
    const retryTrack: Track = { ...sampleTrack, id: "retry-track" };

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Timeout failure"));
    const failRes = await startTrackDownload(retryTrack);
    expect(failRes).toBe(false);
    expect(getTrackDownloadSnapshot(retryTrack.id).status).toBe("error");

    // Change fetch to succeed on retry
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "audio/mpeg" }),
      blob: () => Promise.resolve(new Blob(["recovered-audio"])),
    } as unknown as Response);

    const retryRes = await retryTrackDownload(retryTrack);
    expect(retryRes).toBe(true);
    expect(getTrackDownloadSnapshot(retryTrack.id).status).toBe("downloaded");
  });

  it("batch deletes multiple downloaded tracks atomically", async () => {
    const t1: Track = { ...sampleTrack, id: "batch-del-1" };
    const t2: Track = { ...sampleTrack, id: "batch-del-2" };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "audio/mpeg" }),
      blob: () => Promise.resolve(new Blob(["audio"])),
    } as unknown as Response);

    await Promise.all([startTrackDownload(t1), startTrackDownload(t2)]);
    expect(getTrackDownloadSnapshot(t1.id).status).toBe("downloaded");
    expect(getTrackDownloadSnapshot(t2.id).status).toBe("downloaded");

    const batchSuccess = await batchDeleteTracks([t1.id, t2.id]);
    expect(batchSuccess).toBe(true);
    expect(getTrackDownloadSnapshot(t1.id).status).toBe("idle");
    expect(getTrackDownloadSnapshot(t2.id).status).toBe("idle");
  });

  it("suspends draining queue when device goes offline and preserves queued tracks", async () => {
    const tA: Track = { ...sampleTrack, id: "offline-q-a" };
    const tB: Track = { ...sampleTrack, id: "offline-q-b" };
    const tC: Track = { ...sampleTrack, id: "offline-q-c" };

    let failFirst = true;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (failFirst && url.includes("offline-q-a")) {
        failFirst = false;
        return Promise.reject(new Error("Network offline"));
      }
      return Promise.resolve({
        ok: true,
        headers: new Headers({ "content-type": "audio/mpeg" }),
        blob: () => Promise.resolve(new Blob(["mock-audio"])),
      } as unknown as Response);
    });

    // Start track A and queue B and C
    const pA = startTrackDownload(tA);
    const pB = startTrackDownload(tB);
    const pC = startTrackDownload(tC);

    expect(getTrackDownloadSnapshot(tC.id).status).toBe("queued");

    // Simulate device going offline
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true, writable: true });

    await pA; // Track A fails due to network error

    // Because device is offline, Track C must remain queued and NOT fail immediately!
    expect(getTrackDownloadSnapshot(tC.id).status).toBe("queued");

    // Now restore connection
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true, writable: true });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("online"));
    } else {
      processDownloadQueue();
    }

    // Allow queue to be processed
    await pB;
    await pC;

    expect(getTrackDownloadSnapshot(tB.id).status).toBe("downloaded");
    expect(getTrackDownloadSnapshot(tC.id).status).toBe("downloaded");
  });
});
