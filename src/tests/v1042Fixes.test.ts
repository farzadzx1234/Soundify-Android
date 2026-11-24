import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_BUILD_NUMBER, APP_VERSION } from "@/lib/appVersion";
import { isPlaylistContextPlaying } from "@/lib/trackIdentity";
import type { Track } from "@/lib/types";

function makeTrack(overrides: Partial<Track> = {}): Track {
  const id = overrides.id ?? "ext-youtube-abc12345678";
  return {
    id,
    title: overrides.title ?? "Kam Kam",
    titleFa: overrides.titleFa ?? "Kam Kam",
    artistId: "artist-1",
    artistName: overrides.artistName ?? "Shayan Yo",
    artistNameFa: overrides.artistNameFa ?? "Shayan Yo",
    artistAvatarColor: "#6366f1",
    album: "Single",
    albumFa: "Single",
    genre: "Pop",
    mood: "Chill",
    durationSec: 184,
    audioUrl: `/api/stream/external?id=${id}`,
    coverUrl: `/api/stream/external-cover?id=${id}`,
    accentColor: "#6366f1",
    waveform: [],
    hasLyrics: false,
    lyricsSource: "none",
    playsCount: 0,
    likesCount: 0,
    repostsCount: 0,
    likedByMe: false,
    repostedByMe: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("v1.0.42 Fixes: Playlist Play/Pause State Isolation vs External Playback", () => {
  it("1. Shows Play (false) inside playlist when a matching song is playing outside the playlist (Downloads, Search, Home, or other Playlist)", () => {
    const songInPlaylist = makeTrack({
      id: "ext-youtube-dQw4w9WgXcQ",
      title: "Kam Kam",
      artistName: "Shayan Yo",
    });
    const deviceVariant = makeTrack({
      id: "device-shayan-yo-kam-kam",
      title: "Kam Kam",
      artistName: "Shayan Yo",
    });

    // Played standalone (outside any playlist: playbackContextId === null)
    expect(
      isPlaylistContextPlaying({
        isPlaying: true,
        currentTrack: deviceVariant,
        playbackContextId: null,
        playlistId: "cpl-my-list",
        tracks: [songInPlaylist],
      }),
    ).toBe(false);

    // Played from a DIFFERENT playlist
    expect(
      isPlaylistContextPlaying({
        isPlaying: true,
        currentTrack: songInPlaylist,
        playbackContextId: "playlist:cpl-other-list",
        playlistId: "cpl-my-list",
        tracks: [songInPlaylist],
      }),
    ).toBe(false);

    // Played from THIS exact playlist
    expect(
      isPlaylistContextPlaying({
        isPlaying: true,
        currentTrack: deviceVariant,
        playbackContextId: "playlist:cpl-my-list",
        playlistId: "cpl-my-list",
        tracks: [songInPlaylist],
      }),
    ).toBe(true);

    // Paused inside THIS playlist -> false so button shows Play
    expect(
      isPlaylistContextPlaying({
        isPlaying: false,
        currentTrack: songInPlaylist,
        playbackContextId: "playlist:cpl-my-list",
        playlistId: "cpl-my-list",
        tracks: [songInPlaylist],
      }),
    ).toBe(false);
  });

  it("2. Wires playbackContextId across PlayerContext, PlaylistClient, HomePage mixes, and LibraryPage", () => {
    const playerCtx = fs.readFileSync(path.resolve(__dirname, "../context/PlayerContext.tsx"), "utf8");
    expect(playerCtx).toContain("playbackContextId");
    expect(playerCtx).toContain("nextPlaybackContextId");

    const playlistClient = fs.readFileSync(
      path.resolve(__dirname, "../app/playlist/[id]/PlaylistClient.tsx"),
      "utf8",
    );
    expect(playlistClient).toContain("isPlaylistContextPlaying");
    expect(playlistClient).toContain("`playlist:${playlist.id}`");

    const homePage = fs.readFileSync(path.resolve(__dirname, "../app/page.tsx"), "utf8");
    expect(homePage).toContain("isPlaylistContextPlaying");
    expect(homePage).toContain("`playlist:${mix.id}`");
  });

  it("3. Synchronizes v1.0.42+ / versionCode >= 43 across TS, package.json, sw.js, Gradle, and Java", () => {
    expect(APP_BUILD_NUMBER).toBeGreaterThanOrEqual(43);
    expect(APP_VERSION).toMatch(/^1\.0\.(4[2-9]|[5-9]\d|\d{3,})$/);
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
