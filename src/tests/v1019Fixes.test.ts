import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isMatchingExternalFallback } from "@/lib/externalFallbackMatcher";
import { APP_VERSION, APP_BUILD_NUMBER } from "@/lib/appVersion";

describe("Soundify v1.0.19 Bug Fixes & UI Regression Suite", () => {
  describe("1. Strict External Mirror Matching (No Wrong-Song Fallback)", () => {
    it("rejects completely different songs even by the exact same artist", () => {
      expect(
        isMatchingExternalFallback("Kam Kam", "Shayan Yo", "Bavar Kon", "SHAYAN YO"),
      ).toBe(false);

      expect(
        isMatchingExternalFallback("Kam Kam", "Shayan Yo", "Babre Zakhmi (Official Track)", "Shayan Yo"),
      ).toBe(false);

      expect(
        isMatchingExternalFallback("منم بلدم", "شایان یو", "کم کم", "شایان یو"),
      ).toBe(false);
    });

    it("rejects candidates whose cleaned title is only the artist name", () => {
      expect(
        isMatchingExternalFallback("Bavar Kon", "Shayan Yo", "Shayan Yo", "Shayan Yo"),
      ).toBe(false);
    });

    it("accepts genuine title matches across official/audio/dash variants", () => {
      expect(
        isMatchingExternalFallback("Kam Kam", "Shayan Yo", "Shayan Yo - Kam Kam (Official Audio)", "YouTube"),
      ).toBe(true);

      expect(
        isMatchingExternalFallback("به مولا - حصین", "حصین", "به مولا", "حصین"),
      ).toBe(true);

      expect(
        isMatchingExternalFallback("Manam Baladam", "Shayan Yo", "منم بلدم", "شایان یو"),
      ).toBe(false);

      expect(
        isMatchingExternalFallback("منم بلدم", "شایان یو", "شایان یو - منم بلدم (ریمیکس)", "SoundCloud"),
      ).toBe(true);
    });
  });

  describe("2. DownloadActionSheet Reopen Fix", () => {
    it("decouples dismiss timer from isClosing state dependency and cleans up only on unmount", () => {
      const sheetPath = path.resolve(__dirname, "../components/DownloadActionSheet.tsx");
      const code = fs.readFileSync(sheetPath, "utf8");

      expect(code).toContain("const isClosingRef = useRef(false);");
      expect(code).toContain("}, [onClose]);");
      expect(code).toContain("}, [isOpen, track?.id]);");
      expect(code).not.toMatch(/\[isClosing,\s*onClose\]/);
    });
  });

  describe("3. Android Notification Artwork Clearing & Race Guard", () => {
    it("resets cachedArtworkBitmap immediately on track or cover change and uses monotonic artworkRequestSeq", () => {
      const servicePath = path.resolve(
        __dirname,
        "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java",
      );
      const code = fs.readFileSync(servicePath, "utf8");

      expect(code).toContain("private String currentTrackId = \"\";");
      expect(code).toContain("private final AtomicInteger artworkRequestSeq = new AtomicInteger(0);");
      expect(code).toContain("if (trackChanged || coverChanged)");
      expect(code).toContain("this.cachedArtworkBitmap = null;");
      expect(code).toContain("applyMediaMetadata();");
      expect(code).toContain("updateNotification();");
      expect(code).toContain("reqSeq == artworkRequestSeq.get()");
    });

    it("guards PlayerContext against passing blob: cover URLs to Android MediaMetadata", () => {
      const playerPath = path.resolve(__dirname, "../context/PlayerContext.tsx");
      const code = fs.readFileSync(playerPath, "utf8");

      expect(code).toContain("originalCoverUrlsRef");
      expect(code).toContain('!resolvedCover.startsWith("blob:")');
      expect(code).toContain("isMatchingExternalFallback");
      expect(code).toContain("bufferingDebounceTimerRef");
    });
  });

  describe("4. Cold-Start Launch Splash & Search/Library/Profile UX Fixes", () => {
    it("provides AppLaunchSplash mounted once in AppShell", () => {
      const splashPath = path.resolve(__dirname, "../components/AppLaunchSplash.tsx");
      const shellPath = path.resolve(__dirname, "../components/AppShell.tsx");
      expect(fs.existsSync(splashPath)).toBe(true);
      const shellCode = fs.readFileSync(shellPath, "utf8");
      expect(shellCode).toContain("<AppLaunchSplash />");
    });

    it("separates Search play button (no expand) from card/title click (expands player)", () => {
      const extCard = fs.readFileSync(
        path.resolve(__dirname, "../components/ExternalTrackCard.tsx"),
        "utf8",
      );
      const trackCard = fs.readFileSync(
        path.resolve(__dirname, "../components/TrackCard.tsx"),
        "utf8",
      );

      expect(extCard).toContain("handlePlayButtonClick");
      expect(extCard).toContain("handleCardClick");
      expect(trackCard).not.toContain("contain-paint");
    });

    it("places view mode toggle after selectMode on trailing edge and refines profile swatch ring", () => {
      const libCode = fs.readFileSync(
        path.resolve(__dirname, "../app/library/page.tsx"),
        "utf8",
      );
      const profileCode = fs.readFileSync(
        path.resolve(__dirname, "../app/profile/page.tsx"),
        "utf8",
      );

      const selectIdx = libCode.indexOf("setSelectMode(!selectMode)");
      const toggleIdx = libCode.indexOf('setDownloadViewMode("list")');
      expect(selectIdx).toBeGreaterThan(-1);
      expect(toggleIdx).toBeGreaterThan(selectIdx);

      expect(profileCode).toContain("ring-[1.5px] ring-white/85 ring-offset-[1.5px]");
    });

    it("has synchronized v1.0.19 build version constants", () => {
      expect(APP_VERSION).toBe("1.0.19");
      expect(APP_BUILD_NUMBER).toBe(20);
    });
  });
});
