export type DetectedExternalPlaylistSource = "youtube" | "soundcloud" | "spotify";

export interface DetectedPlaylistLink {
  source: DetectedExternalPlaylistSource;
  normalizedUrl: string;
}

/**
 * Detects whether the user entered a YouTube, YouTube Music, Spotify, or SoundCloud
 * playlist/album link so Search and Library can load the exact tracklist.
 */
export function detectPlaylistLink(rawInput: string): DetectedPlaylistLink | null {
  const trimmed = (rawInput || "").trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtu.be") {
    const listId = parsed.searchParams.get("list")?.trim() || "";
    if (!listId || !/^[a-zA-Z0-9_-]{8,}$/.test(listId)) {
      return null;
    }
    return {
      source: "youtube",
      normalizedUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`,
    };
  }

  if (host === "soundcloud.com" || host === "m.soundcloud.com") {
    const segs = parsed.pathname.split("/").filter(Boolean);
    if (segs.length >= 3 && segs[1].toLowerCase() === "sets") {
      return {
        source: "soundcloud",
        normalizedUrl: `https://soundcloud.com/${segs[0]}/sets/${segs[2]}`,
      };
    }
    return null;
  }

  if (host === "on.soundcloud.com" && parsed.pathname.split("/").filter(Boolean).length >= 1) {
    return { source: "soundcloud", normalizedUrl: parsed.toString() };
  }

  if (host === "open.spotify.com") {
    const match = parsed.pathname.match(/^\/(?:intl-[a-z-]+\/)?(playlist|album)\/([a-zA-Z0-9]{10,})/i);
    if (!match) return null;
    return {
      source: "spotify",
      normalizedUrl: `https://open.spotify.com/${match[1].toLowerCase()}/${match[2]}`,
    };
  }

  if ((host === "spotify.link" || host === "spoti.fi") && parsed.pathname.split("/").filter(Boolean).length >= 1) {
    return { source: "spotify", normalizedUrl: parsed.toString() };
  }

  return null;
}
