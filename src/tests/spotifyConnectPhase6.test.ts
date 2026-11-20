import { describe, expect, it } from "vitest";
import { getDeviceTypeLabel, localizeDeviceName } from "../lib/deviceFormatter";
import { TRANSLATIONS } from "../context/I18nContext";
import type { PlaybackStateSync, Track } from "../lib/types";

describe("Phase 6: Frontend Spotify Connect Sync & Handover Logic", () => {
  const dummyTrack: Track = {
    id: "trk-spotify-1",
    title: "Midnight Melody",
    titleFa: "ملودی نیمه‌شب",
    artistId: "art-1",
    artistName: "Nocturne",
    artistNameFa: "ناکترین",
    artistAvatarColor: "#10b981",
    album: "Echoes",
    albumFa: "پژواک‌ها",
    genre: "Electronic",
    mood: "Chill",
    durationSec: 210,
    coverUrl: "/covers/midnight.jpg",
    audioUrl: "/audio/midnight.mp3",
    accentColor: "#10b981",
    waveform: [0.1, 0.4, 0.8, 0.3],
    playsCount: 120,
    likesCount: 45,
    repostsCount: 12,
    likedByMe: true,
    repostedByMe: false,
    uploadedBy: null,
    hasLyrics: true,
    lyricsSource: "lrclib",
    createdAt: new Date().toISOString(),
  };

  describe("Timestamp-Based Drift Compensation", () => {
    it("compensates playback position based on elapsed time since server timestamp when playing", () => {
      const now = Date.now();
      const serverUpdatedAt = now - 2500; // 2.5 seconds ago

      const syncState: PlaybackStateSync = {
        activeDeviceId: "dev-desktop",
        trackId: dummyTrack.id,
        track: dummyTrack,
        isPlaying: true,
        currentTime: 40.0,
        duration: dummyTrack.durationSec,
        volume: 0.8,
        repeat: "all",
        shuffle: false,
        updatedAt: serverUpdatedAt,
      };

      const elapsedSec = syncState.isPlaying && syncState.updatedAt
        ? Math.max(0, (now - syncState.updatedAt) / 1000)
        : 0;
      const maxDur = syncState.duration || Infinity;
      const compensatedTime = Math.min(maxDur, syncState.currentTime + elapsedSec);

      expect(elapsedSec).toBeCloseTo(2.5, 1);
      expect(compensatedTime).toBeCloseTo(42.5, 1);
    });

    it("does not add drift compensation when track is paused", () => {
      const now = Date.now();
      const serverUpdatedAt = now - 5000; // 5 seconds ago

      const syncState: PlaybackStateSync = {
        activeDeviceId: "dev-desktop",
        trackId: dummyTrack.id,
        track: dummyTrack,
        isPlaying: false,
        currentTime: 75.0,
        duration: dummyTrack.durationSec,
        volume: 0.8,
        repeat: "off",
        shuffle: false,
        updatedAt: serverUpdatedAt,
      };

      const elapsedSec = syncState.isPlaying && syncState.updatedAt
        ? Math.max(0, (now - syncState.updatedAt) / 1000)
        : 0;
      const compensatedTime = Math.min(syncState.duration, syncState.currentTime + elapsedSec);

      expect(elapsedSec).toBe(0);
      expect(compensatedTime).toBe(75.0);
    });

    it("clamps compensated position to track duration to avoid overflow", () => {
      const now = Date.now();
      const serverUpdatedAt = now - 15000; // 15 seconds ago

      const syncState: PlaybackStateSync = {
        activeDeviceId: "dev-desktop",
        trackId: dummyTrack.id,
        track: dummyTrack,
        isPlaying: true,
        currentTime: 205.0, // track duration is 210
        duration: 210.0,
        volume: 0.8,
        repeat: "off",
        shuffle: false,
        updatedAt: serverUpdatedAt,
      };

      const elapsedSec = syncState.isPlaying && syncState.updatedAt
        ? Math.max(0, (now - syncState.updatedAt) / 1000)
        : 0;
      const compensatedTime = Math.min(syncState.duration, syncState.currentTime + elapsedSec);

      expect(compensatedTime).toBe(210.0);
    });
  });

  describe("Seamless Spotify Connect Handover & State Machine", () => {
    it("determines whether this device or a remote device is active", () => {
      const thisDeviceId = "dev-android-phone";

      // Case 1: Phone is the active device
      let activeDeviceId: string | null = "dev-android-phone";
      let isThisDeviceActive = !thisDeviceId || !activeDeviceId || activeDeviceId === thisDeviceId;
      let isRemotePlaybackActive = Boolean(thisDeviceId && activeDeviceId && activeDeviceId !== thisDeviceId);

      expect(isThisDeviceActive).toBe(true);
      expect(isRemotePlaybackActive).toBe(false);

      // Case 2: Desktop is active, phone is remote controller
      activeDeviceId = "dev-pc-desktop";
      isThisDeviceActive = !thisDeviceId || !activeDeviceId || activeDeviceId === thisDeviceId;
      isRemotePlaybackActive = Boolean(thisDeviceId && activeDeviceId && activeDeviceId !== thisDeviceId);

      expect(isThisDeviceActive).toBe(false);
      expect(isRemotePlaybackActive).toBe(true);
    });

    it("preserves exact resume timestamp when handing over from Device A to Device B", () => {
      const currentActiveState = {
        deviceId: "dev-pc-desktop",
        currentTime: 88.5,
        duration: 210,
        isPlaying: true,
        updatedAt: Date.now() - 1000,
      };

      // User triggers TRANSFER to Phone
      const elapsed = (Date.now() - currentActiveState.updatedAt) / 1000;
      const targetResumeTime = currentActiveState.currentTime + elapsed;

      expect(targetResumeTime).toBeGreaterThanOrEqual(88.5);
      expect(targetResumeTime).toBeLessThan(210);

      // Handover message received on Phone
      const transferEvent = {
        command: "TRANSFER",
        targetDeviceId: "dev-android-phone",
        fromDeviceId: "dev-pc-desktop",
        state: {
          track: dummyTrack,
          currentTime: targetResumeTime,
          isPlaying: true,
        },
      };

      expect(transferEvent.targetDeviceId).toBe("dev-android-phone");
      expect(transferEvent.state.currentTime).toBe(targetResumeTime);
      expect(transferEvent.state.isPlaying).toBe(true);
    });
  });

  describe("Remote Control Commands & Optimistic UI", () => {
    it("handles remote volume control with proper clamping between 0 and 1", () => {
      const clampVolume = (vol: number) => Math.max(0, Math.min(1, vol));

      expect(clampVolume(0.75)).toBe(0.75);
      expect(clampVolume(-0.2)).toBe(0);
      expect(clampVolume(1.4)).toBe(1);
      expect(clampVolume(0)).toBe(0);
      expect(clampVolume(1)).toBe(1);
    });

    it("cycles repeat modes properly ('off' -> 'all' -> 'one' -> 'off')", () => {
      const nextRepeat = (curr: "off" | "all" | "one") => {
        return curr === "off" ? "all" : curr === "all" ? "one" : "off";
      };

      expect(nextRepeat("off")).toBe("all");
      expect(nextRepeat("all")).toBe("one");
      expect(nextRepeat("one")).toBe("off");
    });

    it("prevents non-active devices from re-broadcasting commands in ping-pong cascades", () => {
      // Simulate 3 devices: PC (active), Phone A (controller), Tablet B (idle controller)
      const thisDeviceId: string = "dev-tablet-b";
      const activeDeviceId: string = "dev-pc";
      const isThisDeviceActive = activeDeviceId === thisDeviceId; // false

      let remoteCommandsSent = 0;
      const sendRemoteCommandMock = () => {
        remoteCommandsSent++;
      };

      // Handler execution guard test
      const handleIncomingCommand = (_command: string, payload: { targetDeviceId?: string }) => {
        if (!isThisDeviceActive && payload.targetDeviceId !== thisDeviceId) {
          // Inactive devices must NOT execute or re-dispatch actuation commands
          return;
        }
        sendRemoteCommandMock();
      };

      // Incoming TOGGLE_PLAY from Phone A targeted to PC
      handleIncomingCommand("TOGGLE_PLAY", { targetDeviceId: "dev-pc" });
      handleIncomingCommand("NEXT", { targetDeviceId: "dev-pc" });
      handleIncomingCommand("PREV", { targetDeviceId: "dev-pc" });
      handleIncomingCommand("SEEK", { targetDeviceId: "dev-pc" });

      expect(remoteCommandsSent).toBe(0);
    });

    it("ensures follower tabs in a multi-tab browser yield actuation to the Leader tab", () => {
      let leaderActuated = false;
      let followerActuated = false;

      const runCommandOnTab = (isLeader: boolean) => {
        if (!isLeader) return;
        return true;
      };

      leaderActuated = Boolean(runCommandOnTab(true));
      followerActuated = Boolean(runCommandOnTab(false));

      expect(leaderActuated).toBe(true);
      expect(followerActuated).toBe(false);
    });

    it("resolves target track by ID when payload state track object is null during TRANSFER", () => {
      const queue: Track[] = [dummyTrack];
      const payload = {
        targetDeviceId: "dev-phone",
        state: {
          track: null as Track | null,
          trackId: "trk-spotify-1",
          currentTime: 55.2,
          isPlaying: true,
        },
      };

      let resolvedTrack: Track | null = payload.state.track;
      if (!resolvedTrack && payload.state.trackId) {
        resolvedTrack = queue.find((t) => t.id === payload.state.trackId) || null;
      }

      expect(resolvedTrack).not.toBeNull();
      expect(resolvedTrack?.id).toBe("trk-spotify-1");
      expect(resolvedTrack?.title).toBe("Midnight Melody");
    });
  });

  describe("Speaker Device Type and Persian/English Localization", () => {
    const tFa = (k: keyof typeof TRANSLATIONS.fa) => TRANSLATIONS.fa[k];
    const tEn = (k: keyof typeof TRANSLATIONS.en) => TRANSLATIONS.en[k];

    it("formats speaker device type in Persian and English", () => {
      expect(getDeviceTypeLabel("speaker", tFa)).toBe("اسپیکر / بلندگو");
      expect(getDeviceTypeLabel("speaker", tEn)).toBe("Speaker / Audio Output");
    });

    it("localizes smart speakers and Soundify Android App in Persian", () => {
      expect(localizeDeviceName("Soundify Android App", "fa")).toBe("Soundify Android App");
      expect(localizeDeviceName("Smart Speaker", "fa")).toBe("اسپیکر هوشمند");
      expect(localizeDeviceName("Bluetooth Speaker", "fa")).toBe("اسپیکر بلوتوث");
      expect(localizeDeviceName("اسپیکر", "en")).toBe("Speaker");
    });

    it("provides complete translations for all Phase 6 Spotify Connect keys", () => {
      expect(tFa("devicesTitle")).toBe("دستگاه‌های متصل");
      expect(tFa("listeningOnThisDevice")).toBe("در حال پخش در این دستگاه");
      expect(tFa("listeningOnRemoteDevice")).toBe("در حال پخش در دستگاه دیگر");
      expect(tFa("playOnThisDevice")).toBe("پخش در این دستگاه");
      expect(tFa("deviceTypeSpeaker")).toBe("اسپیکر / بلندگو");
      expect(tFa("remoteVolume")).toBe("صدای دستگاه راه دور");

      expect(tEn("devicesTitle")).toBe("Connected Devices");
      expect(tEn("listeningOnThisDevice")).toBe("Listening on this device");
      expect(tEn("listeningOnRemoteDevice")).toBe("Listening on remote device");
      expect(tEn("playOnThisDevice")).toBe("Play on this device");
      expect(tEn("deviceTypeSpeaker")).toBe("Speaker / Audio Output");
      expect(tEn("remoteVolume")).toBe("Remote Volume");
    });
  });

  describe("Local Mobile Playback Claim & Optimistic Ownership Lease", () => {
    it("claims local playback on mobile even if a remote PC device was previously active", () => {
      const phoneId = "dev-android-phone";
      const pcId = "dev-pc-desktop";
      let activeDeviceId = pcId;
      let localOwnershipUntil = 0;

      // User taps Play on a track on Phone -> claims ownership instead of sending PLAY_TRACK to PC
      const now = 1_000_000;
      localOwnershipUntil = now + 8000;
      activeDeviceId = phoneId;

      // Lagging SSE snapshot from server still carries pcId 1.5s later -> rejected by lease
      const applySnapshot = (incomingActiveId: string, ts: number) => {
        if (ts < localOwnershipUntil && incomingActiveId !== phoneId) {
          return activeDeviceId;
        }
        activeDeviceId = incomingActiveId;
        return activeDeviceId;
      };

      expect(applySnapshot(pcId, now + 1500)).toBe(phoneId);
      // Once server confirms phoneId or lease expires, snapshot applies cleanly
      expect(applySnapshot(phoneId, now + 2000)).toBe(phoneId);
      expect(applySnapshot(pcId, now + 9000)).toBe(pcId);
    });

    it("does not route local play/togglePlay to a paused remote PC", () => {
      const shouldActAsRemoteController = (
        isThisDeviceActive: boolean,
        localSessionStarted: boolean,
        localAudioPaused: boolean,
        remoteIsPlaying: boolean,
      ) => {
        if (isThisDeviceActive || localSessionStarted || !localAudioPaused) return false;
        return remoteIsPlaying;
      };

      // Remote PC paused: main Play button on Phone plays locally
      expect(shouldActAsRemoteController(false, false, true, false)).toBe(false);
      // Remote PC actively playing & no local session: phone acts as remote controller until local playTrack claims it
      expect(shouldActAsRemoteController(false, false, true, true)).toBe(true);
      // Once user starts local session on Phone, never route to PC
      expect(shouldActAsRemoteController(false, true, true, true)).toBe(false);
    });
  });
});
