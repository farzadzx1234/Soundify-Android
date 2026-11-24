import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import {
  batchDeleteTracks,
  clearAllDownloads,
  registerDeviceLocalAudioFile,
  removeTrackDownload,
  resetDownloadManagerState,
  resolveDownloadedTrackId,
} from "@/lib/downloadManager";
import {
  clearExportedTrackMemory,
  isTrackExported,
  markTrackAsExported,
} from "@/lib/mediaExport";

describe("v1.0.41 Fixes: Full Device + MediaStore Deletion Without Re-Appearing", () => {
  const scope = globalThis as unknown as {
    window?: Record<string, unknown>;
    Capacitor?: unknown;
  };
  let origWindow: unknown;
  let origCapacitor: unknown;
  let deleteOfflineFilesMock: ReturnType<typeof vi.fn>;
  let deleteAllOfflineFilesMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    origWindow = scope.window;
    origCapacitor = scope.Capacitor;
    resetDownloadManagerState();
    clearExportedTrackMemory();

    deleteOfflineFilesMock = vi.fn().mockResolvedValue({ success: true });
    deleteAllOfflineFilesMock = vi.fn().mockResolvedValue({ success: true });

    const ls = new Map<string, string>();
    const fakeCap = {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: {
        MediaStorePlugin: {
          deleteOfflineFiles: deleteOfflineFilesMock,
          deleteAllOfflineFiles: deleteAllOfflineFilesMock,
          listDeviceSoundifyAudio: vi.fn().mockResolvedValue({ files: [] }),
        },
      },
    };
    scope.Capacitor = fakeCap;
    scope.window = {
      Capacitor: fakeCap,
      localStorage: {
        getItem: (k: string) => (ls.has(k) ? ls.get(k)! : null),
        setItem: (k: string, v: string) => {
          ls.set(k, String(v));
        },
        removeItem: (k: string) => {
          ls.delete(k);
        },
        clear: () => {
          ls.clear();
        },
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };
  });

  afterEach(() => {
    resetDownloadManagerState();
    clearExportedTrackMemory();
    scope.window = origWindow as Record<string, unknown> | undefined;
    scope.Capacitor = origCapacitor;
  });

  it("1. Calls native deleteOfflineFiles with full device URI, fileName, and metadata on batchDeleteTracks & unmarks export", async () => {
    registerDeviceLocalAudioFile({
      uri: "content://media/external/audio/media/9012",
      fileName: "Shayan Yo - Kam Kam.mp3",
      title: "Kam Kam",
      artist: "Shayan Yo",
      trackId: "ext-youtube-kamkam01",
      source: "mediastore",
    });
    markTrackAsExported("ext-youtube-kamkam01");
    expect(isTrackExported("ext-youtube-kamkam01")).toBe(true);
    expect(
      resolveDownloadedTrackId({
        id: "ext-youtube-kamkam01",
        title: "Kam Kam",
        artistName: "Shayan Yo",
      }),
    ).toBe("ext-youtube-kamkam01");

    await batchDeleteTracks(["ext-youtube-kamkam01"]);

    expect(deleteOfflineFilesMock).toHaveBeenCalledTimes(1);
    const payload = deleteOfflineFilesMock.mock.calls[0][0];
    expect(payload.trackId).toBe("ext-youtube-kamkam01");
    expect(payload.audioUri).toBe("content://media/external/audio/media/9012");
    expect(payload.fileName).toBe("Shayan Yo - Kam Kam.mp3");
    expect(payload.title).toBe("Kam Kam");
    expect(payload.artist).toBe("Shayan Yo");

    expect(isTrackExported("ext-youtube-kamkam01")).toBe(false);
    expect(
      resolveDownloadedTrackId({
        id: "ext-youtube-kamkam01",
        title: "Kam Kam",
        artistName: "Shayan Yo",
      }),
    ).toBeNull();
  });

  it("2. Deletes cross-source alias (online ID -> device-* file) via removeTrackDownload and wipes native files on clearAllDownloads", async () => {
    registerDeviceLocalAudioFile({
      uri: "content://media/external/audio/media/7744",
      fileName: "BLOK3 - Kirginim.mp3",
      title: "Kirginim",
      artist: "BLOK3",
      source: "mediastore",
    });

    await removeTrackDownload("ext-youtube-otherid", {
      id: "ext-youtube-otherid",
      title: "Kirginim",
      artistName: "BLOK3",
    });

    expect(deleteOfflineFilesMock).toHaveBeenCalledTimes(1);
    const callArg = deleteOfflineFilesMock.mock.calls[0][0];
    expect(callArg.audioUri).toBe("content://media/external/audio/media/7744");
    expect(callArg.fileName).toBe("BLOK3 - Kirginim.mp3");
    expect(callArg.extraTrackIds).toContain("device-blok3-kirginim");

    await clearAllDownloads();
    expect(deleteAllOfflineFilesMock).toHaveBeenCalledTimes(1);
  });

  it("3. Implements full MediaStore + Music/Soundify + Android 11+ createDeleteRequest cleanup in MediaStorePlugin.java", () => {
    const javaSrc = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/MediaStorePlugin.java"),
      "utf8",
    );
    expect(javaSrc).toContain("public void deleteOfflineFiles(PluginCall call)");
    expect(javaSrc).toContain("public void deleteAllOfflineFiles(PluginCall call)");
    expect(javaSrc).toContain("MediaStore.createDeleteRequest");
    expect(javaSrc).toContain("StartIntentSenderForResult");
    expect(javaSrc).toContain("tryDeleteContentUri");
    expect(javaSrc).toContain("MediaScannerConnection.scanFile");

    const librarySrc = fs.readFileSync(
      path.resolve(__dirname, "../app/library/page.tsx"),
      "utf8",
    );
    expect(librarySrc).toContain("حذف آهنگ از دانلودها و گوشی؟");
    expect(librarySrc).toContain("Music/Soundify");
  });

  it("4. Preserves v1.0.41+ / versionCode >= 42 forward synchronization across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.(?:4[1-9]|[5-9]\d+|\d{3,})$/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(42);
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
    expect(pkg.version).toBe(APP_VERSION);
    const swJs = fs.readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
    expect(swJs).toContain(`soundify-v${APP_VERSION}-b${APP_BUILD_NUMBER}`);
    const gradle = fs.readFileSync(path.resolve(__dirname, "../../android/app/build.gradle"), "utf8");
    expect(gradle).toContain(`versionCode ${APP_BUILD_NUMBER}`);
    expect(gradle).toContain(`versionName "${APP_VERSION}"`);
    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain(`APP_USER_AGENT = "Soundify-Android/${APP_VERSION}"`);
    expect(service).toContain(`APP_VERSION_HEADER = "${APP_VERSION}"`);
  });
});
