import { afterEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import {
  getTrackDownloadSnapshotForTrack,
  registerDeviceLocalAudioFile,
  resetDownloadManagerState,
  resolveDownloadedTrackId,
  resolveLocalDeviceAudioUri,
  startTrackDownload,
} from "@/lib/downloadManager";
import { isMatchingExternalFallback } from "@/lib/externalFallbackMatcher";
import {
  clearCustomPlaylists,
  createCustomPlaylist,
  getCustomPlaylistById,
  updateTrackCoverInCustomPlaylist,
} from "@/lib/customPlaylists";
import type { Track } from "@/lib/types";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "ext-youtube-kamkam-1",
    title: "Kam Kam",
    titleFa: "Kam Kam",
    artistId: "artist-1",
    artistName: "Shayan Yo",
    artistNameFa: "Shayan Yo",
    artistAvatarColor: "#10b981",
    album: "Single",
    albumFa: "تک‌آهنگ",
    genre: "Hip-Hop",
    mood: "Chill",
    durationSec: 184,
    audioUrl: "/api/stream/external?id=ext-youtube-kamkam-1",
    coverUrl: "",
    accentColor: "#10b981",
    waveform: [],
    hasLyrics: false,
    lyricsSource: "none",
    playsCount: 100,
    likesCount: 10,
    repostsCount: 2,
    likedByMe: false,
    repostedByMe: false,
    source: "youtube",
    ...overrides,
  };
}

describe("Soundify v1.0.34 Device Music/Soundify Detection, Strict Fallback Artist Lock & Cover Auto-Heal", () => {
  afterEach(() => {
    resetDownloadManagerState();
    clearCustomPlaylists();
  });

  it("synchronizes v1.0.34 / versionCode 35 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toBe("1.0.34");
    expect(APP_BUILD_NUMBER).toBe(35);

    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));
    expect(pkg.version).toBe("1.0.34");

    const swJs = fs.readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
    expect(swJs).toContain("soundify-v1.0.34-b35");

    const gradle = fs.readFileSync(path.resolve(__dirname, "../../android/app/build.gradle"), "utf8");
    expect(gradle).toContain("versionCode 35");
    expect(gradle).toContain('versionName "1.0.34"');

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain('APP_USER_AGENT = "Soundify-Android/1.0.34"');
    expect(service).toContain("DefaultDataSource.Factory(this, nativeHttpFactory)");
  });

  it("wires listDeviceSoundifyAudio, getLocalCoverDataUrl, soundify_offline dir, and content/file URI decoding in Java", () => {
    const mediaStore = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/MediaStorePlugin.java"),
      "utf8",
    );
    expect(mediaStore).toContain("public void listDeviceSoundifyAudio(PluginCall call)");
    expect(mediaStore).toContain("public void getLocalCoverDataUrl(PluginCall call)");
    expect(mediaStore).toContain("public void deleteOfflineFiles(PluginCall call)");
    expect(mediaStore).toContain("soundify_offline");

    const analyzer = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/AutoMixPcmAnalyzer.java"),
      "utf8",
    );
    expect(analyzer).toContain('url.startsWith("content://")');
    expect(analyzer).toContain('url.startsWith("file://")');
  });

  it("recognizes existing Music/Soundify files immediately, locks DownloadButton, and plays locally without re-downloading", async () => {
    registerDeviceLocalAudioFile({
      uri: "content://media/external/audio/media/4201",
      fileName: "Shayan Yo - Kam Kam.mp3",
      title: "Kam Kam",
      artist: "Shayan Yo",
      source: "mediastore",
    });
    registerDeviceLocalAudioFile({
      uri: "content://media/external/audio/media/4202",
      fileName: "OğuzCan - BLOK3 - Kırgınım.mp3",
      title: "BLOK3 - Kırgınım",
      artist: "OğuzCan",
      source: "mediastore",
    });

    const kamKam = makeTrack();
    const kirginim = makeTrack({
      id: "ext-youtube-kirginim-2",
      title: "BLOK3 - Kırgınım",
      artistName: "OğuzCan",
    });

    expect(resolveDownloadedTrackId(kamKam)).toBeTruthy();
    expect(resolveLocalDeviceAudioUri(kamKam)).toBe("content://media/external/audio/media/4201");
    expect(getTrackDownloadSnapshotForTrack(kamKam).status).toBe("downloaded");
    await expect(startTrackDownload(kamKam)).resolves.toBe(true);

    expect(resolveDownloadedTrackId(kirginim)).toBeTruthy();
    expect(resolveLocalDeviceAudioUri(kirginim)).toBe("content://media/external/audio/media/4202");
    expect(getTrackDownloadSnapshotForTrack(kirginim).status).toBe("downloaded");
  });

  it("strictly rejects unrelated artists in external fallback even on short repeated titles like Kam Kam", () => {
    // Random unrelated artist with same single repeated word -> must REJECT
    expect(
      isMatchingExternalFallback("Kam Kam", "Shayan Yo", "Kam Kam", "Random Singer", 184, 182),
    ).toBe(false);
    expect(
      isMatchingExternalFallback("Kam Kam", "Shayan Yo", "Kam", "Ali Veli", 184, 180),
    ).toBe(false);

    // Same artist -> must ACCEPT
    expect(
      isMatchingExternalFallback("Kam Kam", "Shayan Yo", "Shayan Yo - Kam Kam (Official Audio)", "YouTube", 184, 185),
    ).toBe(true);
    expect(
      isMatchingExternalFallback("BLOK3 - Kırgınım", "OğuzCan", "BLOK3 - Kirginim", "SoundCloud", 161, 162),
    ).toBe(true);
  });

  it("heals missing covers in custom playlists cleanly and passes trackTitle/artistName in VirtualizedTrackTable", () => {
    const scope = globalThis as unknown as { window?: unknown };
    const origWindow = scope.window;
    const lsStore = new Map<string, string>();
    scope.window = {
      localStorage: {
        getItem: (k: string) => lsStore.get(k) ?? null,
        setItem: (k: string, v: string) => { lsStore.set(k, v); },
        removeItem: (k: string) => { lsStore.delete(k); },
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };
    try {
      const tr = makeTrack({ coverUrl: "" });
      const pl = createCustomPlaylist({ title: "خودم", initialTracks: [tr] });
      updateTrackCoverInCustomPlaylist(pl.id, tr.id, "https://i1.sndcdn.com/artworks-kamkam-t500x500.jpg");
      const updated = getCustomPlaylistById(pl.id);
      expect(updated?.tracks[0]?.coverUrl).toBe("https://i1.sndcdn.com/artworks-kamkam-t500x500.jpg");
    } finally {
      clearCustomPlaylists();
      if (origWindow === undefined) delete scope.window;
      else scope.window = origWindow;
    }

    const vTable = fs.readFileSync(
      path.resolve(__dirname, "../components/VirtualizedTrackTable.tsx"),
      "utf8",
    );
    expect(vTable).toContain("trackTitle={tr.title}");
    expect(vTable).toContain("artistName={tr.artistName}");

    const playlistClient = fs.readFileSync(
      path.resolve(__dirname, "../app/playlist/[id]/PlaylistClient.tsx"),
      "utf8",
    );
    expect(playlistClient).toContain("updateTrackCoverInCustomPlaylist");
  });
});
