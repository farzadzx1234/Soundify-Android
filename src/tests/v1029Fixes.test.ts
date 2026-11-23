import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import { djCrossfadeGains } from "@/lib/smartAutoMix";

describe("Soundify v1.0.29 Universal 4-Way Hybrid AutoMix, Wait-Ready Gate & Vocal-Safe Curve", () => {
  it("synchronizes v1.0.29+ / versionCode >= 30 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.(29|3\d)/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(30);

    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
    );
    expect(pkg.version).toMatch(/^1\.0\.(29|3\d)/);

    const swJs = fs.readFileSync(
      path.resolve(__dirname, "../../public/sw.js"),
      "utf8",
    );
    expect(swJs).toMatch(/soundify-v1\.0\.(29|3\d)-b3\d/);

    const gradle = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/build.gradle"),
      "utf8",
    );
    expect(gradle).toMatch(/versionCode 3\d/);
    expect(gradle).toMatch(/versionName "1\.0\.(29|3\d)"/);

    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toMatch(/APP_USER_AGENT = "Soundify-Android\/1\.0\.(29|3\d)"/);
    expect(service).toMatch(/APP_VERSION_HEADER = "1\.0\.(29|3\d)"/);
  });

  it("shapes DJ Bass-Swap crossfade gains smoothly with crisp tail clearance by 85%+", () => {
    const entry = djCrossfadeGains(0.1);
    expect(entry.inGain).toBeLessThan(0.08);
    expect(entry.outGain).toBeGreaterThan(0.99);

    const handoff = djCrossfadeGains(0.6);
    expect(handoff.outGain).toBeLessThan(0.5);
    expect(handoff.inGain).toBeGreaterThan(0.9);

    const tailCleared = djCrossfadeGains(0.9);
    expect(tailCleared.outGain).toBeLessThan(0.02);
    expect(tailCleared.inGain).toBe(1);
  });

  it("supports 4-way hybrid AutoMix (native, web, native-to-web, web-to-native) and early pre-buffer in PlayerContext", () => {
    const playerCtx = fs.readFileSync(
      path.resolve(__dirname, "../context/PlayerContext.tsx"),
      "utf8",
    );
    expect(playerCtx).toContain('"native-to-web"');
    expect(playerCtx).toContain('"web-to-native"');
    expect(playerCtx).toContain("nativeAudioFadeOutAndStop");
    expect(playerCtx).toMatch(/plan\.mixOutSec - (35|45)/);
    expect(playerCtx).toContain("queueRef.current.find((t) => t.id === state.trackId)");
  });

  it("wires wait-until-ready gate, 650ms early-EOF gapless rescue, and native fadeOutAndStop in SoundifyMediaService & Plugin", () => {
    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain("pendingCrossfadeWaitTicker");
    expect(service).toContain("fadeOutAndStopNative");
    expect(service).toContain("crossfadeFadeInOnly");
    expect(service).toContain("executeReadyNativeCrossfade(");

    const plugin = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/NativeAudioPlugin.java"),
      "utf8",
    );
    expect(plugin).toContain("public void fadeOutAndStop(PluginCall call)");
  });
});
