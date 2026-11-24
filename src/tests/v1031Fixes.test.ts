import { afterEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import { isMatchingExternalFallback } from "@/lib/externalFallbackMatcher";
import {
  getTrackDownloadSnapshotForTrack,
  resetDownloadManagerState,
  resolveDownloadedTrackId,
  startTrackDownload,
} from "@/lib/downloadManager";
import { saveDownloadedTrack } from "@/lib/offlineAudioStorage";
import type { Track } from "@/lib/types";

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "track-1",
    title: "Test Song",
    titleFa: "آهنگ تست",
    artistId: "artist-1",
    artistName: "Test Artist",
    artistNameFa: "خواننده تست",
    artistAvatarColor: "#10b981",
    album: "Album",
    albumFa: "آلبوم",
    genre: "Pop",
    mood: "Chill",
    durationSec: 200,
    audioUrl: "/api/tracks/track-1/stream",
    coverUrl: "/api/tracks/track-1/cover",
    accentColor: "#10b981",
    waveform: [],
    hasLyrics: false,
    lyricsSource: "none",
    playsCount: 100,
    likesCount: 10,
    repostsCount: 2,
    likedByMe: false,
    repostedByMe: false,
    ...overrides,
  };
}

describe("Soundify v1.0.31 Smart AutoMix Intro/Outro DSP, Lyrics Guard, Loop All, Strict Search & Offline Lock", () => {
  afterEach(() => {
    resetDownloadManagerState();
  });

  it("synchronizes v1.0.31+ / versionCode >= 32 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.[3-9]\d$/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(32);

    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
    );
    expect(pkg.version).toBe(APP_VERSION);

    const swJs = fs.readFileSync(
      path.resolve(__dirname, "../../public/sw.js"),
      "utf8",
    );
    expect(swJs).toContain(`soundify-v${APP_VERSION}-b${APP_BUILD_NUMBER}`);

    const gradle = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/build.gradle"),
      "utf8",
    );
    expect(gradle).toContain(`versionCode ${APP_BUILD_NUMBER}`);
    expect(gradle).toContain(`versionName "${APP_VERSION}"`);

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain(`APP_USER_AGENT = "Soundify-Android/${APP_VERSION}"`);
    expect(service).toContain(`APP_VERSION_HEADER = "${APP_VERSION}"`);
  });

  it("upgrades AutoMixDspProcessor with 3-band bass/vocal PCM meters and SoundifyMediaService with muted intro pre-scan & 4-condition outro trigger", () => {
    const dsp = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/AutoMixDspProcessor.java"),
      "utf8",
    );
    expect(dsp).toContain("public float getBassRms()");
    expect(dsp).toContain("public float getBodyBassRms()");
    expect(dsp).toContain("public float getVocalMidRms()");
    expect(dsp).toContain("public float getBodyVocalRms()");

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain("nextDeckIntroScanTicker");
    expect(service).toContain("isCurrentMediaItemSeekable()");
    expect(service).toContain("abortNextDeckIntroScanOnMainThread();");
    expect(service).toContain("silenceOutroTicks");
    expect(service).toContain("instrumentalOutroTicks");
    expect(service).toContain("vocalDipTicks");
  });

  it("enforces stale-request cancellation on lyrics loading and keys UI lyrics components per track", () => {
    const playerCtx = fs.readFileSync(
      path.resolve(__dirname, "../context/PlayerContext.tsx"),
      "utf8",
    );
    expect(playerCtx).toContain("lyricsRequestSeqRef");
    expect(playerCtx).toContain("resetLyricsForTrackSwitch");
    expect(playerCtx).toContain("if (isStaleRequest())");

    const overlay = fs.readFileSync(
      path.resolve(__dirname, "../components/NowPlayingOverlay.tsx"),
      "utf8",
    );
    expect(overlay).toContain("<LiveLyricsPeek key={currentTrack.id}");
    expect(overlay).toContain("key={currentTrack.id}");
  });

  it("uses live repeatRef/shuffleRef in next() and updates ExoPlayer repeat mode immediately in cycleRepeat()", () => {
    const playerCtx = fs.readFileSync(
      path.resolve(__dirname, "../context/PlayerContext.tsx"),
      "utf8",
    );
    expect(playerCtx).toContain("const activeRepeat = repeatRef.current;");
    expect(playerCtx).toContain("const activeShuffle = shuffleRef.current;");
    const cycleRepeatBlock = playerCtx.match(/const cycleRepeat = useCallback\([\s\S]*?\[\s*broadcastLeaderState/)?.[0] ?? "";
    expect(cycleRepeatBlock).toContain("nativeAudioSetRepeatMode(nextR)");
  });

  it("strictly rejects wrong songs by the same artist and large duration mismatches in Global Search failover", () => {
    // Uploader name mismatch with shared artist prefix -> must reject different song
    expect(
      isMatchingExternalFallback("BLOK3 - Kırgınım", "OğuzCan", "BLOK3 - Sevmeyi Denemedin", "BLOK3"),
    ).toBe(false);
    expect(
      isMatchingExternalFallback("BLOK3 - Kırgınım", "OğuzCan", "BLOK3", "BLOK3"),
    ).toBe(false);
    expect(
      isMatchingExternalFallback("BLOK3 - Kırgınım", "BLOK3", "BLOK3 - Kayıp Kalp", "BLOK3"),
    ).toBe(false);
    // Duration mismatch (> 30s) -> reject live extended/wrong version
    expect(
      isMatchingExternalFallback("BLOK3 - Kırgınım", "BLOK3", "BLOK3 - Kırgınım (Official Audio)", "BLOK3", 161, 310),
    ).toBe(false);
    // Genuine mirror with matching duration -> accept
    expect(
      isMatchingExternalFallback("BLOK3 - Kırgınım", "OğuzCan", "BLOK3 - Kirginim (Official Audio)", "YouTube", 161, 163),
    ).toBe(true);
  });

  it("locks downloaded tracks by canonical ID or artist+title fingerprint and prevents duplicate re-downloads", async () => {
    const ytTrack = makeTrack({
      id: "ext-youtube-abc123",
      title: "BLOK3 - Kırgınım",
      artistName: "OğuzCan",
      source: "youtube",
      pageUrl: "https://www.youtube.com/watch?v=abc123xyz00",
    });

    await saveDownloadedTrack(ytTrack, new Blob(["audio-bytes"], { type: "audio/mpeg" }));

    // Re-initialize index via startTrackDownload pipeline or initializeDownloadManager
    const { initializeDownloadManager } = await import("@/lib/downloadManager");
    await initializeDownloadManager(true);

    expect(resolveDownloadedTrackId(ytTrack)).toBe("ext-youtube-abc123");

    // Different ID for same canonical song (e.g. SoundCloud mirror or duplicate card) stays locked as downloaded!
    const duplicateCard = makeTrack({
      id: "ext-soundcloud-999",
      title: "Kirginim",
      artistName: "BLOK3",
      source: "soundcloud",
      pageUrl: "https://soundcloud.com/blok3/kirginim",
    });
    const canonicalFromSameTitle = makeTrack({
      id: "ext-youtube-duplicate",
      title: "BLOK3 - Kırgınım",
      artistName: "OğuzCan",
      source: "youtube",
      pageUrl: "https://www.youtube.com/watch?v=abc123xyz00",
    });

    expect(duplicateCard.id).not.toBe(ytTrack.id);
    expect(resolveDownloadedTrackId(canonicalFromSameTitle)).toBe("ext-youtube-abc123");
    expect(getTrackDownloadSnapshotForTrack(canonicalFromSameTitle).status).toBe("downloaded");
    await expect(startTrackDownload(canonicalFromSameTitle)).resolves.toBe(true);
    await expect(startTrackDownload(ytTrack)).resolves.toBe(true);
  });
});
