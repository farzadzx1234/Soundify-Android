import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import {
  extractYouTubeIdClient,
  getCachedCatalogPlaylists,
  getCachedCatalogTracks,
  normalizePlaylist,
  normalizeTrack,
} from "@/lib/api";
import { getPlaylistDetailHref, getTrackDetailHref, resolveMediaUrl } from "@/lib/mobileBackend";
import { registerDeviceLocalAudioFile, resolveLocalDeviceAudioUri } from "@/lib/downloadManager";
import type { Track } from "@/lib/types";

describe("Soundify v1.0.38 Home Crash, Downloads Tab, Screen-Off AutoMix/Loop & Zero-Skip Fixes", () => {
  beforeEach(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem("soundify_catalog_cache_v1_tracks");
      window.localStorage.removeItem("soundify_catalog_cache_v1_playlists");
    }
  });

  it("synchronizes v1.0.38+ / versionCode >= 39 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_VERSION).toMatch(/^1\.0\.(3[89]|[4-9]\d)$/);
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(39);

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

  it("guards malformed/non-string cache & media URLs so Home screen cannot crash", () => {
    expect(resolveMediaUrl(null)).toBe("");
    expect(resolveMediaUrl(undefined)).toBe("");
    expect(resolveMediaUrl(12345 as unknown as string)).toBe("");
    expect(resolveMediaUrl({ url: "bad" } as unknown as string)).toBe("");

    expect(extractYouTubeIdClient("")).toBeNull();
    expect(extractYouTubeIdClient(42 as unknown as string)).toBeNull();
    expect(getTrackDetailHref("track-1")).toBe("/track/default?id=track-1");
    expect(getPlaylistDetailHref(123 as unknown as string)).toBe("/playlist/default?id=123");

    const dirtyTrack = normalizeTrack({
      id: "t-dirty",
      title: 999 as unknown as string,
      titleFa: "Safe",
      artistId: "a-1",
      artistName: null as unknown as string,
      artistNameFa: "",
      artistAvatarColor: "#6366f1",
      audioUrl: { bad: true } as unknown as string,
      coverUrl: 42 as unknown as string,
      durationSec: 120,
      playsCount: 1,
      likesCount: 0,
      repostsCount: 0,
      likedByMe: false,
      repostedByMe: false,
      waveform: [],
      album: "",
      albumFa: "",
      genre: "Pop",
      mood: "",
      hasLyrics: false,
      lyricsSource: "none",
      createdAt: "",
      accentColor: "#6366f1",
    });
    expect(dirtyTrack.title).toBe("999");
    expect(dirtyTrack.audioUrl).toBe("");
    expect(dirtyTrack.coverUrl).toBe("");

    const dirtyPl = normalizePlaylist({
      id: "pl-1",
      title: "Mix",
      coverUrls: [null as unknown as string, "/covers/track-01.jpg"],
    } as never);
    expect(dirtyPl.coverUrls).toEqual(["/covers/track-01.jpg"]);

    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(
        "soundify_catalog_cache_v1_tracks",
        JSON.stringify({
          ts: Date.now(),
          data: [null, { id: "" }, { id: "ok-1", title: "Safe", artistName: "Artist", audioUrl: 123, coverUrl: null }],
        }),
      );
      const cachedTracks = getCachedCatalogTracks();
      expect(cachedTracks?.length).toBe(1);
      expect(cachedTracks?.[0].id).toBe("ok-1");

      window.localStorage.setItem(
        "soundify_catalog_cache_v1_playlists",
        JSON.stringify({ ts: Date.now(), data: [null, { id: "pl-ok", title: "Ok", coverUrls: [123, "/covers/track-01.jpg"] }] }),
      );
      const cachedPlaylists = getCachedCatalogPlaylists();
      expect(cachedPlaylists?.length).toBe(1);
    }

    const pageTsx = fs.readFileSync(path.resolve(__dirname, "../app/page.tsx"), "utf8");
    expect(pageTsx).toContain("HomeSectionErrorBoundary");
    expect(pageTsx).toContain("safeTracks");
  });

  it("merges device-storage offline files into Library Downloads and registers local native URIs", () => {
    registerDeviceLocalAudioFile({
      uri: "file:///storage/emulated/0/Music/Soundify/Shayan%20Yo%20-%20Kam%20Kam.mp3",
      fileName: "Shayan Yo - Kam Kam.mp3",
      title: "Kam Kam",
      artist: "Shayan Yo",
      trackId: "ext-kam-kam",
      durationSec: 184,
      sizeBytes: 4200000,
    });
    const matchedUri = resolveLocalDeviceAudioUri({
      id: "different-catalog-id",
      title: "Kam Kam",
      artistName: "Shayan Yo",
    } as Track);
    expect(matchedUri).toBe("file:///storage/emulated/0/Music/Soundify/Shayan%20Yo%20-%20Kam%20Kam.mp3");

    const dm = fs.readFileSync(path.resolve(__dirname, "../lib/downloadManager.ts"), "utf8");
    expect(dm).toContain("deviceOnlyRecords");
    expect(dm).toContain("listDeviceSoundifyAudioFiles");
    expect(dm).toContain("parseDeviceFileMeta");
  });

  it("enforces WifiLock, native queue, 'all' loop mode, zero-skip AutoMix fallback, and trackChanged wakeup sync", () => {
    const service = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/SoundifyMediaService.java"),
      "utf8",
    );
    expect(service).toContain("WIFI_MODE_FULL_HIGH_PERF");
    expect(service).toContain("wifiLock.acquire()");
    expect(service).toContain("syncNativeQueue");
    expect(service).toContain("maybeAutoPrepareNextFromQueueOnMainThread");
    expect(service).toContain('"all".equals(mode) ? "all" : "off"');
    expect(service).toContain("remSec <= 4.3");
    expect(service).toContain('emitNativeState("trackChanged", null)');

    const plugin = fs.readFileSync(
      path.resolve(__dirname, "../../android/app/src/main/java/com/soundify/app/media/NativeAudioPlugin.java"),
      "utf8",
    );
    expect(plugin).toContain("public void syncQueue(");
    expect(plugin).toContain("public void setAutoMixEnabled(");

    const bridge = fs.readFileSync(path.resolve(__dirname, "../lib/nativeAudioBridge.ts"), "utf8");
    expect(bridge).toContain("nativeAudioSyncQueue");
    expect(bridge).toContain("nativeAudioSetAutoMixEnabled");
    expect(bridge).toContain("nativeAudioGetState");
    expect(bridge).toContain('"trackChanged"');

    const playerCtx = fs.readFileSync(path.resolve(__dirname, "../context/PlayerContext.tsx"), "utf8");
    expect(playerCtx).toContain("syncNativeQueueSnapshot");
    expect(playerCtx).toContain("nativeAudioGetState()");
    expect(playerCtx).toContain('state.event === "trackChanged"');
  });
});
