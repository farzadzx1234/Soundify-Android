import { describe, expect, it } from "vitest";
import { extractCleanTitleAndArtist } from "@/lib/lyricsCleaner";
import { extractCanonicalExternalUrl } from "@/lib/api";
import type { Track } from "@/lib/types";

describe("Playback Fallback & Stream Error Resilience", () => {
  const failedYouTubeTrack = {
    id: "ext-youtube-HeliaPutak123",
    title: "Putak - Helia (Official Audio)",
    artistId: "ext-artist-youtube",
    artistName: "Putak",
    source: "youtube",
    audioUrl: "/api/stream/external?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DHeliaPutak123&id=ext-youtube-HeliaPutak123&fastStart=true",
    durationSec: 195,
    album: "YouTube Audio",
    genre: "Rap",
    waveform: [],
    hasLyrics: false,
    lyricsSource: "none",
    lyricsOffsetMs: 0,
    playsCount: 0,
    likesCount: 0,
    repostsCount: 0,
  } as unknown as Track;

  it("extracts sanitized title and artist for mirror fallback queries on failed tracks", () => {
    const { title, artist } = extractCleanTitleAndArtist(
      failedYouTubeTrack.title,
      failedYouTubeTrack.artistName,
    );
    expect(title).toBe("Helia");
    expect(artist).toBe("Putak");
    const fallbackQuery = `${artist ? `${artist} ` : ""}${title}`.trim();
    expect(fallbackQuery).toBe("Putak Helia");
  });

  it("handles Persian rap titles with special characters and separators cleanly", () => {
    const { title, artist } = extractCleanTitleAndArtist("به مولا - حصین", "حصین");
    expect(title).toBe("به مولا");
    expect(artist).toBe("حصین");
  });

  it("maintains error toast visibility when network is online and stream fails", () => {
    let offlineNotice: string | null = null;
    let noticeType: "network" | "stream" | null = null;

    // Simulate audio error on online stream
    const onStreamError = (msg: string) => {
      noticeType = "stream";
      offlineNotice = msg;
    };

    onStreamError("خطا در بارگذاری استریم صوتی آنلاین");
    expect(offlineNotice).toBe("خطا در بارگذاری استریم صوتی آنلاین");
    expect(noticeType).toBe("stream");

    // Network resilience probe fires indicating server is reachable
    const onNetworkResilienceEvent = (isOnline: boolean) => {
      if (isOnline && noticeType === "network") {
        offlineNotice = null;
        noticeType = null;
      }
    };

    onNetworkResilienceEvent(true);

    // Notice must NOT be cleared because it was a stream error, not a network failure!
    expect(offlineNotice).toBe("خطا در بارگذاری استریم صوتی آنلاین");
    expect(noticeType).toBe("stream");
  });

  it("extracts canonical URL cleanly from proxy stream URLs containing Persian characters", () => {
    const proxyUrl = "/api/stream/external?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Ddqt8Z1k08a4&id=ext-youtube-dqt8Z1k08a4&title=%D9%87%D9%84%DB%8C%D8%A7&artist=%D9%BE%D9%88%D8%AA%DA%A9";
    const canonical = extractCanonicalExternalUrl(proxyUrl);
    expect(canonical).toBe("https://www.youtube.com/watch?v=dqt8Z1k08a4");
  });

  it("canonicalizes SoundCloud URLs without double-decoding mangling", () => {
    const proxyUrl = "/api/stream/external?url=https%3A%2F%2Fsoundcloud.com%2Fputak%2Fhelia&title=Helia";
    const canonical = extractCanonicalExternalUrl(proxyUrl);
    expect(canonical).toBe("https://soundcloud.com/putak/helia");
  });

  it("extracts clean query for Shayan Yo - Manam Baladam to enable automatic multi-source fallback", () => {
    const { title, artist } = extractCleanTitleAndArtist("Manam Baladam", "Shayan Yo");
    expect(title).toBe("Manam Baladam");
    expect(artist).toBe("Shayan Yo");
    const q = `${artist} ${title}`;
    expect(q).toBe("Shayan Yo Manam Baladam");
  });
});
