import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectPlaylistLink } from "@/lib/externalPlaylist";

describe("Android External Playlist Importer", () => {
  it("detects YouTube, YouTube Music, Spotify, and SoundCloud playlist URLs and rejects invalid URLs", () => {
    const yt = detectPlaylistLink("https://www.youtube.com/playlist?list=PL9tY0BWXOZFvtest123");
    expect(yt).toEqual({
      source: "youtube",
      normalizedUrl: "https://www.youtube.com/playlist?list=PL9tY0BWXOZFvtest123",
    });

    const ytMix = detectPlaylistLink("https://music.youtube.com/watch?v=abcdefghijk&list=OLAK5uy_abc12345");
    expect(ytMix?.source).toBe("youtube");
    expect(ytMix?.normalizedUrl).toBe("https://www.youtube.com/playlist?list=OLAK5uy_abc12345");

    const sp = detectPlaylistLink("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=xyz");
    expect(sp?.source).toBe("spotify");
    expect(sp?.normalizedUrl).toBe("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");

    const sc = detectPlaylistLink("https://soundcloud.com/dj-persia/sets/night-drive");
    expect(sc?.source).toBe("soundcloud");
    expect(sc?.normalizedUrl).toBe("https://soundcloud.com/dj-persia/sets/night-drive");

    expect(detectPlaylistLink("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT")).toBeNull();
    expect(detectPlaylistLink("mohsen yeganeh")).toBeNull();
  });

  it("wires ExternalPlaylistImporter cleanly in Search, Library, and API client", () => {
    const apiSrc = fs.readFileSync(path.resolve(__dirname, "../lib/api.ts"), "utf8");
    expect(apiSrc).toContain("fetchExternalPlaylist");
    expect(apiSrc).toContain("importExternalPlaylist");

    const importerSrc = fs.readFileSync(
      path.resolve(__dirname, "../components/ExternalPlaylistImporter.tsx"),
      "utf8",
    );
    expect(importerSrc).toContain("batchDownloadTracks");
    expect(importerSrc).toContain("createCustomPlaylist");
    expect(importerSrc).toContain("importExternalPlaylist");

    const searchSrc = fs.readFileSync(path.resolve(__dirname, "../app/search/page.tsx"), "utf8");
    expect(searchSrc).toContain("detectPlaylistLink");
    expect(searchSrc).toContain("ExternalPlaylistImporter");

    const librarySrc = fs.readFileSync(path.resolve(__dirname, "../app/library/page.tsx"), "utf8");
    expect(librarySrc).toContain("ExternalPlaylistImporter");
  });
});
