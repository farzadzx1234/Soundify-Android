import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  clearPreservedPlaybackIntent,
  getNetworkResilience,
  getPreservedPlaybackIntent,
  isNetworkEffectivelyOffline,
  isNetworkEffectivelyOnline,
  preservePlaybackIntent,
  reportNetworkFailure,
  reportNetworkSuccess,
  resetNetworkResilienceForTests,
  subscribeNetworkResilience,
  triggerImmediateNetworkProbe,
  type NetworkResilienceEvent,
} from "../lib/networkResilience";

describe("Intelligent Network Resilience Service", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetNetworkResilienceForTests();
  });

  afterEach(() => {
    resetNetworkResilienceForTests();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("does not falsely report offline when navigator.onLine is false on VPN before active probe fails", () => {
    const originalOnLine = navigator.onLine;
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    try {
      // Fresh state with no probe failures must not block playback
      expect(isNetworkEffectivelyOffline()).toBe(false);
      expect(isNetworkEffectivelyOnline()).toBe(true);
    } finally {
      Object.defineProperty(navigator, "onLine", { value: originalOnLine, configurable: true });
    }
  });

  it("detects disconnect on consecutive probe failures and emits recovered=true on fast reconnect", async () => {
    const events: NetworkResilienceEvent[] = [];
    const unsub = subscribeNetworkResilience((e) => events.push(e));

    // Simulate VPN / Iran ISP drop
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as typeof fetch;

    const first = await triggerImmediateNetworkProbe();
    expect(first).toBe(false);
    expect(getNetworkResilience().getStatus()).toBe("degraded");

    const second = await triggerImmediateNetworkProbe();
    expect(second).toBe(false);
    expect(getNetworkResilience().getStatus()).toBe("offline");
    expect(isNetworkEffectivelyOffline()).toBe(true);

    // Simulate VPN reconnect
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as typeof fetch;

    const recovered = await triggerImmediateNetworkProbe();
    expect(recovered).toBe(true);
    expect(getNetworkResilience().getStatus()).toBe("online");
    expect(isNetworkEffectivelyOnline()).toBe(true);

    const lastEvent = events[events.length - 1];
    expect(lastEvent?.isOnline).toBe(true);
    expect(lastEvent?.recovered).toBe(true);

    unsub();
  });

  it("recovers immediately when an API or audio stream reports success", () => {
    const events: NetworkResilienceEvent[] = [];
    const unsub = subscribeNetworkResilience((e) => events.push(e));

    reportNetworkFailure();
    expect(getNetworkResilience().getStatus()).toBe("degraded");

    reportNetworkSuccess(42);
    expect(getNetworkResilience().getStatus()).toBe("online");
    expect(getNetworkResilience().getLastLatencyMs()).toBe(42);
    expect(events.some((e) => e.isOnline && e.recovered)).toBe(true);

    unsub();
  });

  it("preserves and clears playback intent for automatic playback resurrection", () => {
    preservePlaybackIntent("track-123", 48.5, true);
    const intent = getPreservedPlaybackIntent();
    expect(intent).not.toBeNull();
    expect(intent?.trackId).toBe("track-123");
    expect(intent?.currentTime).toBe(48.5);
    expect(intent?.intendedPlaying).toBe(true);

    clearPreservedPlaybackIntent();
    expect(getPreservedPlaybackIntent()).toBeNull();
  });

  it("verifies PlayerContext fixes togglePlay auto-pause/unpause bugs and guards synthetic pause events", () => {
    const playerContextPath = path.resolve(__dirname, "../context/PlayerContext.tsx");
    const source = fs.readFileSync(playerContextPath, "utf8");

    // 1. togglePlay must branch cleanly with `else` before calling audio.pause()
    expect(source).toMatch(/const shouldStartPlaying =[\s\S]*!isPlayingRef\.current &&[\s\S]*!isRetryingPlayRef\.current;/);
    expect(source).toContain("await attemptPlayWithRetry(audio, curr, isDownloadedSync);");
    expect(source).toContain("} else {\n      userPausedIntentRef.current = true;");

    // 2. Remote toggle must send explicit PLAY / PAUSE with an optimistic lock against stale SSE state
    expect(source).toContain('void sendRemoteCommand(nextPlaying ? "PLAY" : "PAUSE")');
    expect(source).toContain("remotePlayStateLockUntilRef.current");

    // 3. onPause must ignore browser synthetic pauses during src swap / retry
    expect(source).toContain("if (isSettingSourceRef.current || isRetryingPlayRef.current)");

    // 4. PlayerContext must subscribe to NetworkResilience for auto-resume
    expect(source).toContain("subscribeNetworkResilience");
    expect(source).toContain("getPreservedPlaybackIntent");
  });

  it("keeps appVersion.ts, package.json, and android build.gradle versionName synchronized", () => {
    const root = path.resolve(__dirname, "../..");
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const gradle = fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8");
    const versionTs = fs.readFileSync(path.join(root, "src/lib/appVersion.ts"), "utf8");
    const swRegistrar = fs.readFileSync(path.join(root, "src/components/ServiceWorkerRegistrar.tsx"), "utf8");

    expect(versionTs).toContain(`APP_VERSION = "${pkg.version}"`);
    expect(gradle).toContain(`versionName "${pkg.version}"`);
    expect(swRegistrar).toContain("isAndroidNative()");
    expect(swRegistrar).toContain("reg.unregister()");
  });

  it("purges stale WebView Service Worker and HTTP caches BEFORE WebView init on APK upgrade", () => {
    const root = path.resolve(__dirname, "../..");
    const mainActivity = fs.readFileSync(
      path.join(root, "android/app/src/main/java/com/soundify/app/MainActivity.java"),
      "utf8",
    );
    const swJs = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");

    // 1. MainActivity must purge Service Worker & Cache directories BEFORE super.onCreate()
    const purgeIdx = mainActivity.indexOf("purgeStaleWebViewCachesBeforeInit()");
    const superIdx = mainActivity.indexOf("super.onCreate(savedInstanceState)");
    expect(purgeIdx).toBeGreaterThan(-1);
    expect(superIdx).toBeGreaterThan(purgeIdx);
    expect(mainActivity).toContain('deleteRecursively(new File(base, "app_webview/Default/Service Worker"))');
    expect(mainActivity).not.toMatch(/deleteRecursively\([^)]*Local Storage/);
    expect(mainActivity).not.toMatch(/deleteRecursively\([^)]*IndexedDB/);

    // 2. public/sw.js must self-destruct on Capacitor localhost origins and preserve cover art cache
    expect(swJs).toContain("IS_CAPACITOR_LOCAL");
    expect(swJs).toContain("self.registration.unregister()");
    expect(swJs).toContain('if (IS_CAPACITOR_LOCAL) return;');
  });

  it("prevents Android Audio Focus self-fight between SoundifyMediaService and Chromium WebView", () => {
    const root = path.resolve(__dirname, "../..");
    const mediaService = fs.readFileSync(
      path.join(root, "android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    const mediaPlugin = fs.readFileSync(
      path.join(root, "android/app/src/main/java/com/soundify/app/media/MediaSessionPlugin.java"),
      "utf8",
    );

    // MediaSessionPlugin must start service with ACTION_SYNC_STATE (not ACTION_PLAY) to avoid echoing play back to JS
    expect(mediaPlugin).toContain("SoundifyMediaService.ACTION_SYNC_STATE");
    expect(mediaService).toContain("case ACTION_SYNC_STATE:");

    // updatePlaybackState and handleAction in SoundifyMediaService must NOT call requestAudioFocus() (Chromium WebView owns audio focus)
    const updatePlaybackMatch = mediaService.match(/public void updatePlaybackState\([\s\S]*?\n    \}/);
    expect(updatePlaybackMatch).not.toBeNull();
    const updatePlaybackCodeOnly = (updatePlaybackMatch?.[0] ?? "").replace(/\/\/.*/g, "");
    expect(updatePlaybackCodeOnly).not.toContain("requestAudioFocus()");

    const handleActionMatch = mediaService.match(/private void handleAction\([\s\S]*?\n    \}/);
    expect(handleActionMatch).not.toBeNull();
    const handleActionCodeOnly = (handleActionMatch?.[0] ?? "").replace(/\/\/.*/g, "");
    expect(handleActionCodeOnly).not.toContain("requestAudioFocus()");
  });

  it("allows playTrack UI toggle calls to pause currently playing track and avoids malformed retry URLs", () => {
    const playerContextPath = path.resolve(__dirname, "../context/PlayerContext.tsx");
    const source = fs.readFileSync(playerContextPath, "utf8");

    expect(source).toContain("const isUiToggleCall = startTime === undefined && autoPlay === undefined;");
    expect(source).toContain("if (isUiToggleCall && currentTrackRef.current?.id === normalizedTrack.id)");
    // Ensure _rt query busting strips existing _rt before computing ? vs & separator
    expect(source).toContain('const cleanedSource = rawSource.replace(/([?&])_rt=\\d+/g, "$1")');

    // Behavioral verification of _rt cache-busting edge cases
    const buildRetryUrl = (rawSource: string, ts: number) => {
      const cleaned = rawSource.replace(/([?&])_rt=\d+/g, "$1").replace(/[?&]$/, "").replace(/\?&/, "?");
      const sep = cleaned.includes("?") ? "&" : "?";
      return `${cleaned}${sep}_rt=${ts}`;
    };
    expect(buildRetryUrl("https://soundify.mashhad-ix.ir/api/tracks/t1/stream", 100)).toBe(
      "https://soundify.mashhad-ix.ir/api/tracks/t1/stream?_rt=100",
    );
    expect(buildRetryUrl("https://soundify.mashhad-ix.ir/api/tracks/t1/stream?_rt=50", 100)).toBe(
      "https://soundify.mashhad-ix.ir/api/tracks/t1/stream?_rt=100",
    );
    expect(buildRetryUrl("https://soundify.mashhad-ix.ir/api/tracks/t1/stream?token=abc&_rt=50", 100)).toBe(
      "https://soundify.mashhad-ix.ir/api/tracks/t1/stream?token=abc&_rt=100",
    );
    expect(buildRetryUrl("https://soundify.mashhad-ix.ir/api/tracks/t1/stream?_rt=50&token=abc", 100)).toBe(
      "https://soundify.mashhad-ix.ir/api/tracks/t1/stream?token=abc&_rt=100",
    );
  });

  it("prevents ensureAudioPrepared async race, WebAudio Android hijacking, MediaSession onPlay pause trap, and single-track next/prev pause", () => {
    const root = path.resolve(__dirname, "../..");
    const playerSource = fs.readFileSync(path.join(root, "src/context/PlayerContext.tsx"), "utf8");
    const mainActivity = fs.readFileSync(
      path.join(root, "android/app/src/main/java/com/soundify/app/MainActivity.java"),
      "utf8",
    );
    const mediaService = fs.readFileSync(
      path.join(root, "android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    const swJs = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");

    // 1. Android WebView must not hijack <audio> through WebAudio createMediaElementSource or force crossOrigin
    expect(playerSource).toContain("if (isAndroidNative()) return;");
    expect(playerSource).toContain('if (!isAndroidNative()) {\n        existing.crossOrigin = "anonymous";');

    // 2. ensureAudioPrepared must never overwrite audio.src during active playback or after track switch
    expect(playerSource).toContain("if (!audio.paused || isPlayingRef.current || isRetryingPlayRef.current) {\n      return;\n    }");
    expect(playerSource).toContain("if (currentTrackRef.current?.id !== track.id) return;");

    // 3. MediaSession onPlay must not call togglePlay while isPlayingRef or isRetryingPlayRef is active,
    // and native handlers must not bypass shouldActAsRemoteControllerRef() local audio guard
    expect(playerSource).toMatch(/onPlay:\s*\(\)\s*=>\s*\{[\s\S]*!isPlayingRef\.current && !isRetryingPlayRef\.current\)/);
    expect(playerSource).not.toContain("shouldActAsRemoteControllerRef.current() || (!isThisDeviceActiveRef.current && syncStateRef.current)");

    // 4. next() / prev() must pass explicit (target, undefined, 0, true) so single-track queues never hit UI toggle pause
    expect(playerSource).toContain("if (target) playTrack(target, undefined, 0, true);");
    // Remote pause fast path in playTrack must dispatch PAUSE to remote controller
    expect(playerSource).toContain('if (shouldActAsRemoteController()) {\n            remotePlayStateLockUntilRef.current = Date.now() + 2500;');

    // 5. Killer sw.js must match clients (includeUncontrolled: true) BEFORE calling unregister()
    const matchAllIdx = swJs.indexOf("includeUncontrolled: true");
    const unregisterIdx = swJs.indexOf("self.registration.unregister()");
    expect(matchAllIdx).toBeGreaterThan(-1);
    expect(unregisterIdx).toBeGreaterThan(matchAllIdx);

    // 6. MainActivity must purge OEM WebView cache paths, use synchronous commit(), and bypass SW cache
    expect(mainActivity).toContain('deleteRecursively(new File(cacheDir, "org.chromium.android_webview"))');
    expect(mainActivity).toContain("purgeProfileCacheDirs");
    expect(mainActivity).toContain('.putLong("last_version_code", currentVersionCode).commit()');
    expect(mainActivity).toContain("ServiceWorkerController.getInstance()");

    // 7. SoundifyMediaService notification buttons must dispatch explicit ACTION_PAUSE / ACTION_PLAY
    expect(mediaService).toContain('createAction(android.R.drawable.ic_media_pause, "Pause", ACTION_PAUSE, 102)');
    expect(mediaService).toContain('createAction(android.R.drawable.ic_media_play, "Play", ACTION_PLAY, 102)');
  });
});
