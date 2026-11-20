import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  blobToBase64,
  getExportFileName,
  exportTrackToDeviceStorage,
  getExportedTrackIds,
  isTrackExported,
  markTrackAsExported,
  clearExportedTrackMemory,
} from "@/lib/mediaExport";
import {
  clearAllDownloadedTracks,
  saveDownloadedTrack,
} from "@/lib/offlineAudioStorage";
import type { Track } from "@/lib/types";

const mockTrack: Track = {
  id: "track-exp-1",
  title: "Aramesh / Peace: Track #1?",
  titleFa: "آرامش: قطعه ۱",
  artistId: "artist-1",
  artistName: "Homayoun Shajarian / همایون",
  artistNameFa: "همایون شجریان",
  artistAvatarColor: "#6366f1",
  album: "Nasim",
  albumFa: "نسیم",
  genre: "Traditional",
  mood: "Calm",
  durationSec: 210,
  audioUrl: "/api/tracks/track-exp-1/stream",
  coverUrl: "/api/tracks/track-exp-1/cover",
  accentColor: "#6366f1",
  waveform: [0.2, 0.4, 0.8, 0.3],
  hasLyrics: true,
  lyricsSource: "lrclib",
  playsCount: 50,
  likesCount: 12,
  repostsCount: 2,
  likedByMe: false,
  repostedByMe: false,
  uploadedBy: "admin",
  createdAt: "2026-01-01T00:00:00Z",
};

describe("mediaExport", () => {
  let originalWindow: unknown;
  let originalDocument: unknown;

  beforeEach(async () => {
    await clearAllDownloadedTracks();
    clearExportedTrackMemory();
    originalWindow = (globalThis as unknown as { window?: unknown }).window;
    originalDocument = (globalThis as unknown as { document?: unknown }).document;
  });

  afterEach(async () => {
    await clearAllDownloadedTracks();
    clearExportedTrackMemory();
    (globalThis as unknown as { window?: unknown }).window = originalWindow;
    (globalThis as unknown as { document?: unknown }).document = originalDocument;
    vi.restoreAllMocks();
  });

  describe("getExportFileName", () => {
    it("sanitizes forbidden filesystem characters and appends .mp3", () => {
      const fileName = getExportFileName(mockTrack);
      expect(fileName).not.toContain("/");
      expect(fileName).not.toContain("?");
      expect(fileName).not.toContain(":");
      expect(fileName.endsWith(".mp3")).toBe(true);
      expect(fileName).toContain("Homayoun Shajarian _ همایون");
      expect(fileName).toContain("Aramesh _ Peace_ Track #1_");
    });

    it("falls back to track id if title and artist are missing", () => {
      const minimalTrack: Track = {
        ...mockTrack,
        id: "track-fallback-99",
        title: "",
        titleFa: "",
        artistName: "",
        artistNameFa: "",
      };
      const fileName = getExportFileName(minimalTrack);
      expect(fileName).toBe("Soundify - Track_track-fallback-99.mp3");
    });
  });

  describe("blobToBase64", () => {
    it("converts a Blob to a raw base64 string without data-uri prefix", async () => {
      const blob = new Blob(["hello-soundify-media"], { type: "audio/mpeg" });
      const b64 = await blobToBase64(blob);
      expect(typeof b64).toBe("string");
      expect(b64.length).toBeGreaterThan(0);
      expect(b64).not.toContain("data:");
      expect(b64).not.toContain("base64,");
    });
  });

  describe("exportTrackToDeviceStorage", () => {
    it("successfully triggers web download anchor when running in browser", async () => {
      const audioBlob = new Blob(["test-audio-content"], { type: "audio/mpeg" });
      await saveDownloadedTrack(mockTrack, audioBlob);

      const mockAnchor = {
        href: "",
        download: "",
        rel: "",
        style: { display: "" },
        click: vi.fn(),
      };
      const mockDocument = {
        createElement: vi.fn().mockReturnValue(mockAnchor),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      };

      (globalThis as unknown as { window?: unknown }).window = {
        location: { origin: "http://localhost:3100" },
      };
      (globalThis as unknown as { document?: unknown }).document = mockDocument;

      const result = await exportTrackToDeviceStorage(mockTrack);
      expect(result.success).toBe(true);
      expect(result.method).toBe("web-download");
      expect(result.path?.endsWith(".mp3")).toBe(true);

      expect(mockDocument.createElement).toHaveBeenCalledWith("a");
      expect(mockDocument.body.appendChild).toHaveBeenCalled();
      expect(mockAnchor.click).toHaveBeenCalled();
      expect(mockDocument.body.removeChild).toHaveBeenCalled();
    });

    it("uses native MediaStorePlugin when running in Android native wrapper", async () => {
      const audioBlob = new Blob(["native-audio-bytes"], { type: "audio/mpeg" });
      await saveDownloadedTrack(mockTrack, audioBlob);

      const mockSaveAudio = vi.fn().mockResolvedValue({
        success: true,
        path: "Music/Soundify/Homayoun Shajarian - Aramesh.mp3",
      });

      // Mock Capacitor native environment on globalThis.window
      (globalThis as unknown as { window?: unknown }).window = {
        location: { protocol: "capacitor:", origin: "capacitor://localhost" },
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => "android",
          Plugins: {
            MediaStorePlugin: {
              saveAudioToDevice: mockSaveAudio,
            },
          },
        },
      };

      const result = await exportTrackToDeviceStorage(mockTrack);
      expect(result.success).toBe(true);
      expect(result.method).toBe("native-mediastore");
      expect(result.path).toContain("Music/Soundify");
      expect(mockSaveAudio).toHaveBeenCalledOnce();
      const callArgs = mockSaveAudio.mock.calls[0][0];
      expect(callArgs.title).toBe(mockTrack.title);
      expect(callArgs.artist).toBe(mockTrack.artistName);
      expect(callArgs.album).toBe("Soundify");
      expect(callArgs.base64).toBeDefined();
    });

    it("falls back to web download if native plugin throws an error", async () => {
      const audioBlob = new Blob(["audio-error-fallback"], { type: "audio/mpeg" });
      await saveDownloadedTrack(mockTrack, audioBlob);

      const mockAnchor = {
        href: "",
        download: "",
        rel: "",
        style: { display: "" },
        click: vi.fn(),
      };
      const mockDocument = {
        createElement: vi.fn().mockReturnValue(mockAnchor),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      };

      (globalThis as unknown as { window?: unknown }).window = {
        location: { protocol: "capacitor:", origin: "capacitor://localhost" },
        Capacitor: {
          isNativePlatform: () => true,
          getPlatform: () => "android",
          Plugins: {
            MediaStorePlugin: {
              saveAudioToDevice: vi.fn().mockRejectedValue(new Error("Native storage full")),
            },
          },
        },
      };
      (globalThis as unknown as { document?: unknown }).document = mockDocument;

      const result = await exportTrackToDeviceStorage(mockTrack);
      expect(result.success).toBe(true);
      expect(result.method).toBe("web-download");
      expect(mockAnchor.click).toHaveBeenCalled();
    });

    it("returns error if track has no audio blob in offline storage and network fetch fails", async () => {
      const result = await exportTrackToDeviceStorage({
        ...mockTrack,
        id: "missing-track",
        audioUrl: "",
      });
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("exported tracking persistence", () => {
    it("correctly tracks and persists exported track ids in storage", () => {
      expect(isTrackExported("test-track-1")).toBe(false);
      markTrackAsExported("test-track-1");
      expect(isTrackExported("test-track-1")).toBe(true);
      const exportedSet = getExportedTrackIds();
      expect(exportedSet.has("test-track-1")).toBe(true);
    });
  });
});
