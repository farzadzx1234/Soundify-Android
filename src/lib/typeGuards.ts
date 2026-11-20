/**
 * Soundify Phase 10: Strict TypeScript Type-Guards & Discriminated Unions
 * Provides exhaustive type assertions, safe runtime validation, and zero-any safety.
 */

import type {
  DeviceInfo,
  EncryptedEnvelope,
  PlaybackStateSync,
  Playlist,
  Track,
  User,
} from "./types";

/**
 * Exhaustive check helper for switch statements on discriminated unions.
 * Fails compilation if any union branch is left unhandled.
 */
export function assertNever(x: never, message?: string): never {
  throw new Error(message ?? `Unexpected unreachable case: ${JSON.stringify(x)}`);
}

/**
 * Validates that an arbitrary value is a non-null object record.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runtime type guard for Soundify Track entity.
 */
export function isTrack(value: unknown): value is Track {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.artistName === "string" &&
    typeof value.audioUrl === "string" &&
    typeof value.durationSec === "number" &&
    Array.isArray(value.waveform)
  );
}

/**
 * Runtime type guard for Soundify Playlist entity.
 */
export function isPlaylist(value: unknown): value is Playlist {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.trackCount === "number" &&
    Array.isArray(value.coverUrls)
  );
}

/**
 * Runtime type guard for authenticated User entity.
 */
export function isUser(value: unknown): value is User {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.username === "string" &&
    typeof value.email === "string" &&
    (value.role === "user" || value.role === "creator" || value.role === "admin")
  );
}

/**
 * Runtime type guard for DeviceInfo entity.
 */
export function isDeviceInfo(value: unknown): value is DeviceInfo {
  if (!isRecord(value)) return false;
  const validTypes = ["desktop", "smartphone", "tablet", "browser", "speaker"];
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    validTypes.includes(value.type) &&
    typeof value.isActive === "boolean" &&
    typeof value.isCurrent === "boolean" &&
    (typeof value.lastActive === "string" || value.lastActive === undefined)
  );
}

/**
 * Runtime type guard for PlaybackStateSync snapshot.
 */
export function isPlaybackStateSync(value: unknown): value is PlaybackStateSync {
  if (!isRecord(value)) return false;
  const validActiveDeviceId =
    value.activeDeviceId === null ||
    typeof value.activeDeviceId === "string" ||
    value.activeDeviceId === undefined;
  const validTrackId =
    value.trackId === null ||
    typeof value.trackId === "string" ||
    value.trackId === undefined;
  const validTrack =
    value.track === null ||
    value.track === undefined ||
    isTrack(value.track);
  return (
    validActiveDeviceId &&
    validTrackId &&
    validTrack &&
    typeof value.isPlaying === "boolean" &&
    typeof value.currentTime === "number" &&
    typeof value.duration === "number" &&
    typeof value.volume === "number" &&
    (value.repeat === "off" || value.repeat === "all" || value.repeat === "one") &&
    typeof value.shuffle === "boolean" &&
    typeof value.updatedAt === "number"
  );
}

/**
 * Runtime type guard for End-to-End Encrypted Envelope.
 */
export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!isRecord(value)) return false;
  return (
    value.encrypted === true &&
    typeof value.iv === "string" &&
    typeof value.tag === "string" &&
    typeof value.ciphertext === "string"
  );
}

/**
 * Discriminated union for all cross-device remote player commands.
 */
export type RemotePlaybackCommand =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "TOGGLE_PLAY" }
  | { type: "NEXT"; auto?: boolean }
  | { type: "PREV" }
  | { type: "SEEK"; seconds: number }
  | { type: "SET_VOLUME"; volume: number }
  | { type: "SET_REPEAT"; repeat: "off" | "all" | "one" }
  | { type: "SET_SHUFFLE"; shuffle: boolean }
  | { type: "PLAY_TRACK"; track?: Track; trackId?: string; queue?: Track[] }
  | {
      type: "TRANSFER";
      targetDeviceId?: string;
      fromDeviceId?: string;
      state?: PlaybackStateSync;
      trackId?: string;
      track?: Track;
    };

/**
 * Safe parser for incoming remote commands with discriminated union validation.
 */
export function parseRemoteCommand(
  rawType: string,
  rawPayload?: Record<string, unknown>,
): RemotePlaybackCommand | null {
  const normalized = rawType.toUpperCase().trim();
  switch (normalized) {
    case "PLAY": {
      const track = isTrack(rawPayload?.track) ? rawPayload.track : undefined;
      const trackId = typeof rawPayload?.trackId === "string" ? rawPayload.trackId : track?.id;
      if (track || trackId) {
        const queue = Array.isArray(rawPayload?.queue)
          ? rawPayload.queue.filter(isTrack)
          : undefined;
        return { type: "PLAY_TRACK", track, trackId, queue };
      }
      return { type: "PLAY" };
    }
    case "PAUSE":
      return { type: "PAUSE" };
    case "TOGGLE_PLAY":
      return { type: "TOGGLE_PLAY" };
    case "NEXT":
      return { type: "NEXT", auto: Boolean(rawPayload?.auto) };
    case "PREV":
      return { type: "PREV" };
    case "SEEK": {
      const sec = Number(
        rawPayload?.positionSec ??
          rawPayload?.position ??
          rawPayload?.seconds ??
          (typeof rawPayload?.positionMs === "number" ? rawPayload.positionMs / 1000 : 0),
      );
      return { type: "SEEK", seconds: Number.isFinite(sec) ? sec : 0 };
    }
    case "VOLUME":
    case "SET_VOLUME": {
      const vol = Number(rawPayload?.volume ?? 1);
      return { type: "SET_VOLUME", volume: Math.max(0, Math.min(1, vol)) };
    }
    case "SET_REPEAT": {
      const rep = rawPayload?.repeat;
      const validRepeat = rep === "all" || rep === "one" ? rep : "off";
      return { type: "SET_REPEAT", repeat: validRepeat };
    }
    case "SET_SHUFFLE":
      return { type: "SET_SHUFFLE", shuffle: Boolean(rawPayload?.shuffle) };
    case "PLAY_TRACK": {
      const track = isTrack(rawPayload?.track) ? rawPayload.track : undefined;
      const trackId = typeof rawPayload?.trackId === "string" ? rawPayload.trackId : track?.id;
      if (!track && !trackId) return null;
      const queue = Array.isArray(rawPayload?.queue)
        ? rawPayload.queue.filter(isTrack)
        : undefined;
      return { type: "PLAY_TRACK", track, trackId, queue };
    }
    case "TRANSFER":
    case "TRANSFER_PLAYBACK": {
      const state = isPlaybackStateSync(rawPayload?.state) ? rawPayload.state : undefined;
      const track = isTrack(rawPayload?.track) ? rawPayload.track : undefined;
      const targetDeviceId = typeof rawPayload?.targetDeviceId === "string" ? rawPayload.targetDeviceId : undefined;
      const fromDeviceId = typeof rawPayload?.fromDeviceId === "string" ? rawPayload.fromDeviceId : undefined;
      const trackId = typeof rawPayload?.trackId === "string" ? rawPayload.trackId : undefined;
      return {
        type: "TRANSFER",
        targetDeviceId,
        fromDeviceId,
        state,
        trackId,
        track,
      };
    }
    default:
      return null;
  }
}
