import { describe, expect, it } from "vitest";
import {
  assertNever,
  isDeviceInfo,
  isEncryptedEnvelope,
  isPlaybackStateSync,
  isPlaylist,
  isRecord,
  isTrack,
  isUser,
  parseRemoteCommand,
  type RemotePlaybackCommand,
} from "../lib/typeGuards";
import type { Track } from "../lib/types";

describe("Phase 10: Strict TypeScript Type-Guards & Discriminated Unions", () => {
  const validTrack: Track = {
    id: "trk-100",
    title: "Tehran Skyline",
    titleFa: "افق تهران",
    artistId: "art-1",
    artistName: "Sirvan",
    artistNameFa: "سیروان",
    artistAvatarColor: "#6366F1",
    album: "Monologue",
    albumFa: "مونولوگ",
    genre: "Pop",
    mood: "Chill",
    durationSec: 240,
    audioUrl: "/audio/trk-100.mp3",
    coverUrl: "/covers/trk-100.jpg",
    accentColor: "#6366F1",
    waveform: [0.1, 0.5, 0.9],
    hasLyrics: true,
    lyricsSource: "lrclib",
    playsCount: 1500,
    likesCount: 300,
    repostsCount: 45,
    likedByMe: true,
    repostedByMe: false,
    uploadedBy: null,
    createdAt: "2026-01-01T00:00:00Z",
  };

  describe("isRecord", () => {
    it("identifies non-null plain objects and rejects primitives/arrays/null", () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ a: 1 })).toBe(true);
      expect(isRecord(null)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
      expect(isRecord([])).toBe(false);
      expect(isRecord("string")).toBe(false);
      expect(isRecord(42)).toBe(false);
      expect(isRecord(true)).toBe(false);
    });
  });

  describe("isTrack", () => {
    it("validates compliant Track objects", () => {
      expect(isTrack(validTrack)).toBe(true);
    });

    it("rejects incomplete or malformed objects", () => {
      expect(isTrack(null)).toBe(false);
      expect(isTrack({})).toBe(false);
      expect(isTrack({ ...validTrack, durationSec: "240" })).toBe(false);
      expect(isTrack({ ...validTrack, waveform: "not-an-array" })).toBe(false);
    });
  });

  describe("isPlaylist", () => {
    it("validates compliant Playlist objects", () => {
      const pl = {
        id: "pl-1",
        title: "Chill Hits",
        titleFa: "آهنگ‌های آرامش‌بخش",
        trackCount: 15,
        coverUrls: ["/covers/1.jpg"],
      };
      expect(isPlaylist(pl)).toBe(true);
    });

    it("rejects invalid Playlist objects", () => {
      expect(isPlaylist({ id: "pl-1" })).toBe(false);
      expect(isPlaylist({ id: "pl-1", title: "Test", trackCount: "15", coverUrls: [] })).toBe(false);
    });
  });

  describe("isUser", () => {
    it("validates valid User with role constraints", () => {
      expect(
        isUser({
          id: "u-1",
          username: "farzad",
          email: "farzad@example.com",
          role: "admin",
        }),
      ).toBe(true);
      expect(
        isUser({
          id: "u-2",
          username: "user1",
          email: "user1@example.com",
          role: "unknown_role",
        }),
      ).toBe(false);
    });
  });

  describe("isDeviceInfo", () => {
    it("validates connected device info", () => {
      expect(
        isDeviceInfo({
          id: "dev-phone",
          name: "Pixel 9 Pro",
          type: "smartphone",
          isActive: true,
          isCurrent: true,
        }),
      ).toBe(true);
      expect(isDeviceInfo({ id: "dev-phone" })).toBe(false);
    });
  });

  describe("isPlaybackStateSync", () => {
    it("validates synchronized playback snapshot", () => {
      expect(
        isPlaybackStateSync({
          isPlaying: true,
          currentTime: 45.2,
          duration: 200,
          volume: 0.8,
          repeat: "all",
          shuffle: false,
          updatedAt: Date.now(),
        }),
      ).toBe(true);
      expect(
        isPlaybackStateSync({
          isPlaying: true,
          currentTime: 45.2,
          duration: 200,
          volume: 0.8,
          repeat: "invalid_repeat",
          shuffle: false,
          updatedAt: Date.now(),
        }),
      ).toBe(false);
    });
  });

  describe("isEncryptedEnvelope", () => {
    it("validates encrypted payload structure", () => {
      expect(
        isEncryptedEnvelope({
          encrypted: true,
          iv: "aabbcc",
          tag: "ddeeff",
          ciphertext: "112233",
        }),
      ).toBe(true);
      expect(isEncryptedEnvelope({ encrypted: false })).toBe(false);
    });
  });

  describe("parseRemoteCommand & assertNever", () => {
    it("parses valid commands into discriminated union types", () => {
      expect(parseRemoteCommand("play")).toEqual({ type: "PLAY" });
      expect(parseRemoteCommand("pause")).toEqual({ type: "PAUSE" });
      expect(parseRemoteCommand("toggle_play")).toEqual({ type: "TOGGLE_PLAY" });
      expect(parseRemoteCommand("next", { auto: true })).toEqual({ type: "NEXT", auto: true });
      expect(parseRemoteCommand("prev")).toEqual({ type: "PREV" });
      expect(parseRemoteCommand("seek", { position: 125 })).toEqual({ type: "SEEK", seconds: 125 });
      expect(parseRemoteCommand("set_volume", { volume: 0.75 })).toEqual({
        type: "SET_VOLUME",
        volume: 0.75,
      });
      expect(parseRemoteCommand("set_repeat", { repeat: "one" })).toEqual({
        type: "SET_REPEAT",
        repeat: "one",
      });
      expect(parseRemoteCommand("set_shuffle", { shuffle: true })).toEqual({
        type: "SET_SHUFFLE",
        shuffle: true,
      });
    });

    it("parses play_track with full track payload and filters invalid queue items", () => {
      const cmd = parseRemoteCommand("play_track", {
        track: validTrack,
        queue: [validTrack, { invalid: "item" }],
      });
      expect(cmd).not.toBeNull();
      expect(cmd?.type).toBe("PLAY_TRACK");
      if (cmd?.type === "PLAY_TRACK") {
        expect(cmd.track?.id).toBe("trk-100");
        expect(cmd.queue).toHaveLength(1);
      }
    });

    it("parses play_track with trackId only", () => {
      const cmd = parseRemoteCommand("play_track", { trackId: "trk-remote-99" });
      expect(cmd).toEqual({
        type: "PLAY_TRACK",
        track: undefined,
        trackId: "trk-remote-99",
        queue: undefined,
      });
    });

    it("parses transfer command correctly", () => {
      const cmd = parseRemoteCommand("transfer", {
        targetDeviceId: "dev-mobile-1",
        fromDeviceId: "dev-desktop-2",
        trackId: "trk-100",
      });
      expect(cmd).toEqual({
        type: "TRANSFER",
        targetDeviceId: "dev-mobile-1",
        fromDeviceId: "dev-desktop-2",
        state: undefined,
        trackId: "trk-100",
        track: undefined,
      });
    });

    it("returns null for unrecognized command types", () => {
      expect(parseRemoteCommand("unsupported_action")).toBeNull();
    });

    it("assertNever throws error at runtime if executed", () => {
      expect(() => assertNever("unexpected" as never)).toThrow();
    });

    it("allows exhaustive switch handling over RemotePlaybackCommand", () => {
      const handleCmd = (cmd: RemotePlaybackCommand): string => {
        switch (cmd.type) {
          case "PLAY":
            return "playing";
          case "PAUSE":
            return "paused";
          case "TOGGLE_PLAY":
            return "toggled";
          case "NEXT":
            return `next:${cmd.auto ? "auto" : "manual"}`;
          case "PREV":
            return "prev";
          case "SEEK":
            return `seek:${cmd.seconds}`;
          case "SET_VOLUME":
            return `volume:${cmd.volume}`;
          case "SET_REPEAT":
            return `repeat:${cmd.repeat}`;
          case "SET_SHUFFLE":
            return `shuffle:${cmd.shuffle}`;
          case "PLAY_TRACK":
            return `track:${cmd.track?.id ?? cmd.trackId}`;
          case "TRANSFER":
            return `transfer:${cmd.targetDeviceId ?? "any"}`;
          default:
            return assertNever(cmd);
        }
      };

      expect(handleCmd({ type: "PLAY" })).toBe("playing");
      expect(handleCmd({ type: "SEEK", seconds: 30 })).toBe("seek:30");
      expect(handleCmd({ type: "TRANSFER", targetDeviceId: "dev-abc" })).toBe("transfer:dev-abc");
    });
  });
});
