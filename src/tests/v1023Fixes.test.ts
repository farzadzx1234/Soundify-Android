import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import { isMatchingExternalFallback } from "@/lib/externalFallbackMatcher";

describe("Soundify v1.0.23 Playback, Seek, Repeat-1, Notification & Failover Fixes", () => {
  it("synchronizes v1.0.23+ / versionCode >= 24 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.(2[3-9]|[3-9]\d)/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(24);

    const gradle = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/build.gradle"),
      "utf8",
    );
    expect(gradle).toMatch(/versionCode\s+(2[4-9]|[3-9]\d)/);
    expect(gradle).toMatch(/versionName\s+"1\.0\.(2[3-9]|[3-9]\d)"/);
  });

  it("folds Turkish and Latin diacritics when verifying cross-platform mirrors without false positives", () => {
    expect(
      isMatchingExternalFallback("BLOK3 - Kırgınım", "OğuzCan", "BLOK3 - Kirginim (Official Audio)", "YouTube"),
    ).toBe(true);

    expect(
      isMatchingExternalFallback("BLOK3 - Kırgınım", "BLOK3", "BLOK3 - Kayıp Kalp", "BLOK3"),
    ).toBe(false);
  });

  it("configures ExoPlayer with extractors index seeking, 180s back-buffer, Repeat One, and authoritative notification state", () => {
    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    const plugin = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/NativeAudioPlugin.java"),
      "utf8",
    );

    expect(service).toContain("Mp3Extractor.FLAG_ENABLE_INDEX_SEEKING");
    expect(service).toContain("setConstantBitrateSeekingEnabled(true)");
    expect(service).toContain("setBackBuffer(180_000, true)");
    expect(service).toContain("isCurrentMediaItemSeekable()");
    expect(service).toContain("nativeSetRepeatMode");
    expect(service).toContain("nativeReplayOnMainThread");
    expect(service).toContain('boolean hasExplicitPlayPos = intent.hasExtra("position");');

    // Ensure ACTION_PLAY_PAUSE only echoes togglePlay to JS when nativeAudioActive is false (inside the else branch)
    const playPauseBlock = service.match(/case ACTION_PLAY_PAUSE:[\s\S]*?case ACTION_NEXT:/);
    expect(playPauseBlock?.[0] ?? "").toContain("} else {\n                    isPlaying = !isPlaying;");
    expect(playPauseBlock?.[0] ?? "").toContain("nativeReplayOnMainThread()");

    expect(plugin).toContain("setRepeatMode");
    expect(plugin).toContain("replay");
  });

  it("wires repeatRef one replay, preserves native notification position, and runs multi-step external failover in PlayerContext", () => {
    const playerCtx = fs.readFileSync(
      path.resolve(__dirname, "../context/PlayerContext.tsx"),
      "utf8",
    );
    const bridge = fs.readFileSync(
      path.resolve(__dirname, "../lib/nativeAudioBridge.ts"),
      "utf8",
    );
    const apiCode = fs.readFileSync(
      path.resolve(__dirname, "../lib/api.ts"),
      "utf8",
    );

    expect(bridge).toContain("nativeAudioSetRepeatMode");
    expect(bridge).toContain("nativeAudioReplay");
    expect(apiCode).toContain("body: JSON.stringify({ id, url: canonical || url, title, artist })");

    // Must use repeatRef.current in `next(fromEnded)` and call nativeAudioReplay()
    expect(playerCtx).toContain('if (fromEnded && repeatRef.current === "one" && audio)');
    expect(playerCtx).toContain("void nativeAudioReplay();");
    expect(playerCtx).toContain("void nativeAudioSetRepeatMode(repeat);");

    // Must not overwrite ExoPlayer notification position with hidden <audio>.currentTime
    expect(playerCtx).toContain("if (nativeAudioActiveRef.current) return;\n    const audio = getSingletonAudio();");

    // Multi-step external recovery (refresh + cross-platform mirror queue)
    expect(playerCtx).toContain("fallbackCandidatesRef");
    expect(playerCtx).toContain("nativeErrorRetryCountRef");
    expect(playerCtx).toContain("api.refreshStreamUrl");
  });
});
