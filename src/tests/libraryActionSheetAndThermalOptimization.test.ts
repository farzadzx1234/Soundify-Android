import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  calculateDampedDrag,
  calculateVelocity,
} from "../lib/touchGestures";
import {
  isAppInForeground,
  setAppForegroundState,
  subscribeToAppState,
} from "../lib/androidBridge";

describe("Library, Action Sheet Dismiss, FastStart & Thermal Performance Audit", () => {
  describe("1. Action Sheet Interactive Drag-to-Dismiss & Grabber Target", () => {
    it("dampens drag downwards using spring physics", () => {
      // Downwards drag (positive delta) should follow physical damping
      const downDrag = calculateDampedDrag(80, 0.95);
      expect(downDrag).toBeGreaterThan(60);
      expect(downDrag).toBeLessThan(80);

      // Negative delta returns 0 (handled by rubber-band in component)
      const upDrag = calculateDampedDrag(-50);
      expect(upDrag).toBe(0);
    });

    it("calculates drag swipe velocity accurately for flick-to-dismiss", () => {
      // 120px movement over 100ms = 1.2 px/ms velocity (flick)
      const velocity = calculateVelocity(120, 100);
      expect(velocity).toBeCloseTo(1.2, 1);
      expect(velocity > 0.45).toBe(true);
    });

    it("verifies DownloadActionSheet contains touch swipe-down gesture and accessible grabber button", () => {
      const sheetPath = path.resolve(__dirname, "../components/DownloadActionSheet.tsx");
      const code = fs.readFileSync(sheetPath, "utf8");

      // Verify touch drag handlers
      expect(code).toContain("onTouchStart={handleTouchStart}");
      expect(code).toContain("onTouchMove={handleTouchMove}");
      expect(code).toContain("onTouchEnd={handleTouchEnd}");
      expect(code).toContain("calculateDampedDrag");
      expect(code).toContain("calculateVelocity");

      // Verify accessible grabber bar with tap-to-dismiss support
      expect(code).toContain('role="button"');
      expect(code).toContain("handleDismissWithPhysics");
      expect(code).toContain("aria-label=");
      expect(code).toContain("بستن منوی ادیت آهنگ");

      // Verify no flickering sf-fade-up on drag release
      expect(code).not.toContain("sf-fade-up");
    });
  });

  describe("2. Clean Spotify / Apple Music Library Redesign", () => {
    it("verifies library page has horizontal filter chips, airy header, and contextual batch toolbar", () => {
      const libraryPath = path.resolve(__dirname, "../app/library/page.tsx");
      const code = fs.readFileSync(libraryPath, "utf8");

      // Airy header with large typography
      expect(code).toContain('t("libraryTitle")');

      // Filter chips matching Spotify / Apple Music
      expect(code).toContain('"downloaded"');
      expect(code).toContain('"liked"');
      expect(code).toContain('"playlists"');
      expect(code).toContain('"reposts"');
      expect(code).toContain('"history"');

      // Contextual batch selection (only shown when selectMode is active)
      expect(code).toContain("selectMode &&");
      expect(code).toContain("batchDeleteTracks");
      expect(code).toContain("handleExportSelected");

      // Unboxed, clutter-free list/grid representation
      expect(code).toContain('downloadViewMode === "list"');
    });
  });

  describe("3. FastStart & Resilient Audio Resolution for Instant Playback", () => {
    it("verifies downloadManager appends fastStart=true and prevents lyrics queries from blocking downloads", () => {
      const dlManagerPath = path.resolve(__dirname, "../lib/downloadManager.ts");
      const code = fs.readFileSync(dlManagerPath, "utf8");

      // fastStart parameter for immediate HTTP 206 chunking
      expect(code).toContain("fastStart=true");

      // Non-blocking parallel aux resolution with strict timeout
      expect(code).toContain("Promise.allSettled");
      expect(code).toContain("Promise.race");
      expect(code).toContain("AbortController");
      expect(code).toContain("autoFetchLyrics");
    });

    it("verifies PlayerContext fast playback retries and debounce logic", () => {
      const playerPath = path.resolve(__dirname, "../context/PlayerContext.tsx");
      const code = fs.readFileSync(playerPath, "utf8");

      // Fast retry delays [0, 800, 1800] instead of sluggish multi-second waits
      expect(code).toContain("0, 800, 1800");

      // Pre-buffering track for queue items
      expect(code).toContain("prebufferTrack");

      // Fix 10-taps bug: does NOT pause if audio is connecting or buffering
      expect(code).toContain("isCurrentlyPlayingAudible");
      expect(code).toContain("currentAudio.currentTime > 0");

      // Preserves URL and proxy socket without cache-busting _rt on initial attempts
      expect(code).toContain("audio.error ?");
    });
  });

  describe("4. Thermal, GPU & Background Battery Preservations", () => {
    beforeEach(() => {
      setAppForegroundState(true);
    });

    it("updates foreground state and notifies subscribers", () => {
      expect(isAppInForeground()).toBe(true);

      const stateChanges: boolean[] = [];
      const unsub = subscribeToAppState((isActive) => {
        stateChanges.push(isActive);
      });

      setAppForegroundState(false);
      expect(isAppInForeground()).toBe(false);
      expect(stateChanges).toEqual([false]);

      setAppForegroundState(true);
      expect(isAppInForeground()).toBe(true);
      expect(stateChanges).toEqual([false, true]);

      unsub();
      setAppForegroundState(false);
      expect(stateChanges).toEqual([false, true]); // No new notifications after unsub
    });

    it("verifies SpectrumVisualizer pauses in background and removes canvas shadows on mobile", () => {
      const visualizerPath = path.resolve(__dirname, "../components/SpectrumVisualizer.tsx");
      const code = fs.readFileSync(visualizerPath, "utf8");

      // Cancels RAF loop when in background or hidden
      expect(code).toContain("!isAppInForeground()");
      expect(code).toContain("subscribeToAppState");

      // Disables expensive shadowBlur on mobile touch devices
      expect(code).toContain("if (!isMobile)");
      expect(code).toContain("ctx.shadowBlur = 5 * dpr;");
    });

    it("verifies PlayerContext throttles time updates when app is in background", () => {
      const playerPath = path.resolve(__dirname, "../context/PlayerContext.tsx");
      const code = fs.readFileSync(playerPath, "utf8");

      expect(code).toContain("isAppInForeground");
      expect(code).toContain("const inForeground = isAppInForeground() && (typeof document === \"undefined\" || !document.hidden);");
      expect(code).toContain("subscribeToAppState");
    });

    it("verifies WaveformScrubber and AmbientBackdrop pause in background", () => {
      const scrubberPath = path.resolve(__dirname, "../components/WaveformScrubber.tsx");
      const scrubberCode = fs.readFileSync(scrubberPath, "utf8");
      expect(scrubberCode).toContain("isAppInForeground()");

      const backdropPath = path.resolve(__dirname, "../components/AmbientBackdrop.tsx");
      const backdropCode = fs.readFileSync(backdropPath, "utf8");
      expect(backdropCode).toContain("subscribeToAppState");
    });

    it("verifies MainActivity.java disables offscreen pre-raster and hooks pause/resume lifecycle", () => {
      const mainActivityPath = path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/MainActivity.java");
      const code = fs.readFileSync(mainActivityPath, "utf8");

      // Thermal optimization: offscreen pre-raster set to false
      expect(code).toContain("settings.setOffscreenPreRaster(false);");

      // Lifecycle hooks to notify webview backgrounding
      expect(code).toContain("public void onPause()");
      expect(code).toContain("window.__soundifySetBackground(true)");
      expect(code).toContain("window.__soundifySetBackground(false)");
    });

    it("verifies globals.css pauses animations, removes backdrop-filter in background and on mobile", () => {
      const cssPath = path.resolve(__dirname, "../app/globals.css");
      const code = fs.readFileSync(cssPath, "utf8");

      expect(code).toContain('html[data-app-state="background"] .sf-ambient-stage');
      expect(code).toContain('html[data-app-state="background"] *');
      expect(code).toContain("animation-play-state: paused !important;");
      expect(code).toContain("backdrop-filter: none !important;");
      expect(code).toContain("blur(12px) saturate(130%) !important;");
    });
  });
});
