import { afterEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import { analyzePcmAutoMixPoints } from "@/lib/smartAutoMix";
import {
  getTrackDownloadSnapshotForTrack,
  initializeDownloadManager,
  resetDownloadManagerState,
  resolveDownloadedTrackId,
  startTrackDownload,
} from "@/lib/downloadManager";
import { getAllDownloadedTrackMeta, saveDownloadedTrack } from "@/lib/offlineAudioStorage";
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

describe("Soundify v1.0.32 Real PCM AutoMix Intro/Outro, Timeline Guard & Locked Downloads", () => {
  afterEach(() => {
    resetDownloadManagerState();
  });

  it("synchronizes v1.0.32+ / versionCode 33+ across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.(?:3[2-9]|[4-9]\d+|\d{3,})$/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(33);

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

  it("wires PCM_FLOAT + PCM_16BIT DSP processing, Sonic 3x intro scan, processedBlocks guard, and monotonic timeline guard in Java", () => {
    const dsp = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/AutoMixDspProcessor.java"),
      "utf8",
    );
    expect(dsp).toContain("C.ENCODING_PCM_FLOAT");
    expect(dsp).toContain("C.ENCODING_PCM_16BIT");
    expect(dsp).toContain("public int getProcessedBlocks()");

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain(".setEnableAudioTrackPlaybackParams(false)");
    expect(service).toContain(".setEnableFloatOutput(false)");
    expect(service).toContain("PlaybackParameters(3.0f)");
    expect(service).toContain("getProcessedBlocks() >= 16");
    expect(service).toContain("crossfadePositionGuardUntilMs");
  });

  it("detects real leading silence, quiet outro drop, and trailing dead silence in analyzePcmAutoMixPoints", () => {
    const sr = 8000;
    const totalSec = 45;
    const pcm = new Float32Array(sr * totalSec);

    // 0..4s: dead silence (0.0)
    // 4..34s: full musical body (RMS ~0.35)
    for (let i = 4 * sr; i < 34 * sr; i++) {
      pcm[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr);
    }
    // 34..40s: quiet ambient outro fade (RMS ~0.04 < 0.36 * 0.35)
    for (let i = 34 * sr; i < 40 * sr; i++) {
      pcm[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / sr);
    }
    // 40..45s: trailing dead silence (0.0)

    const res = analyzePcmAutoMixPoints(pcm, sr);
    expect(res.durationSec).toBe(45);
    // Skips 4s leading silence cleanly right before 4.0s beat onset
    expect(res.mixInSec).toBeGreaterThanOrEqual(3.2);
    expect(res.mixInSec).toBeLessThanOrEqual(4.2);
    // Trims 5s trailing dead air to ~40.0s
    expect(res.effectiveEndSec).toBeGreaterThanOrEqual(39.8);
    expect(res.effectiveEndSec).toBeLessThanOrEqual(40.5);
    // Triggers mix-out right into the quiet 34s outro
    expect(res.mixOutSec).toBeGreaterThanOrEqual(33.5);
    expect(res.mixOutSec).toBeLessThanOrEqual(36.0);
  });

  it("guards WebView <audio> listeners while native ExoPlayer is active and keys NowPlayingDockTimeline per track", () => {
    const playerCtx = fs.readFileSync(
      path.resolve(__dirname, "../context/PlayerContext.tsx"),
      "utf8",
    );
    expect(playerCtx).toContain("if (audio !== getSingletonAudio() || nativeAudioActiveRef.current) return;");
    expect(playerCtx).toContain("autoMixStartedRef.current = true;");
    expect(playerCtx).toContain("crossfadePositionGuardUntilRef.current");

    const overlay = fs.readFileSync(
      path.resolve(__dirname, "../components/NowPlayingOverlay.tsx"),
      "utf8",
    );
    expect(overlay).toMatch(/<NowPlayingDockTimeline[\s\r\n]+key=\{currentTrack\.id\}/);
  });

  it("locks DownloadButton when downloaded, uses cursor metadata + tx.oncomplete, and deduplicates cross-provider Turkish/embedded-artist downloads", async () => {
    const btn = fs.readFileSync(
      path.resolve(__dirname, "../components/DownloadButton.tsx"),
      "utf8",
    );
    expect(btn).toContain("disabled={!allowManageSheet || busy}");
    expect(btn).toContain("aria-disabled={!allowManageSheet}");

    const storage = fs.readFileSync(
      path.resolve(__dirname, "../lib/offlineAudioStorage.ts"),
      "utf8",
    );
    expect(storage).toContain("tx.oncomplete = () => resolve();");
    expect(storage).toContain("export async function getAllDownloadedTrackMeta()");

    const ytTrack = makeTrack({
      id: "ext-youtube-blok3-xyz",
      title: "BLOK3 - Kırgınım",
      artistName: "OğuzCan",
      source: "youtube",
      pageUrl: "https://www.youtube.com/watch?v=blok3xyz123",
    });
    await saveDownloadedTrack(ytTrack, new Blob(["audio"], { type: "audio/mpeg" }));

    const metas = await getAllDownloadedTrackMeta();
    expect(metas.some((m) => m.trackId === "ext-youtube-blok3-xyz")).toBe(true);

    await initializeDownloadManager(true);

    const scVariant = makeTrack({
      id: "ext-soundcloud-blok3-999",
      title: "Kirginim",
      artistName: "BLOK3",
      source: "soundcloud",
      pageUrl: "https://soundcloud.com/blok3/kirginim",
    });

    expect(resolveDownloadedTrackId(ytTrack)).toBe("ext-youtube-blok3-xyz");
    expect(resolveDownloadedTrackId(scVariant)).toBe("ext-youtube-blok3-xyz");
    expect(getTrackDownloadSnapshotForTrack(scVariant).status).toBe("downloaded");
    await expect(startTrackDownload(ytTrack)).resolves.toBe(true);
    await expect(startTrackDownload(scVariant)).resolves.toBe(true);
  });
});
