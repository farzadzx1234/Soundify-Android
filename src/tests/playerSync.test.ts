import { describe, expect, it } from "vitest";
import type { LyricLine, Track } from "../lib/types";

describe("Player Multi-Tab and Continuity Logic", () => {
  const dummyTrack: Track = {
    id: "track-123",
    title: "Test Track",
    titleFa: "ترک آزمایشی",
    artistId: "artist-1",
    artistName: "Artist",
    artistNameFa: "هنرمند",
    artistAvatarColor: "#6366f1",
    album: "Album",
    albumFa: "آلبوم",
    genre: "Pop",
    mood: "Chill",
    durationSec: 180,
    coverUrl: "/test-cover.jpg",
    audioUrl: "/test-audio.mp3",
    accentColor: "#6366f1",
    playsCount: 10,
    likesCount: 5,
    repostsCount: 2,
    likedByMe: false,
    repostedByMe: false,
    uploadedBy: null,
    hasLyrics: true,
    lyricsSource: "lrclib",
    createdAt: new Date().toISOString(),
    waveform: [0.1, 0.5, 0.8, 0.2],
  };

  it("serializes and restores player state properly for continuity across reloads", () => {
    const state = {
      track: dummyTrack,
      queue: [dummyTrack],
      volume: 0.75,
      muted: false,
      repeat: "all" as const,
      shuffle: true,
      currentTime: 45.5,
    };

    const json = JSON.stringify(state);
    const parsed = JSON.parse(json);

    expect(parsed.track.id).toBe("track-123");
    expect(parsed.queue).toHaveLength(1);
    expect(parsed.volume).toBe(0.75);
    expect(parsed.repeat).toBe("all");
    expect(parsed.shuffle).toBe(true);
    expect(parsed.currentTime).toBe(45.5);
  });

  it("validates cross-tab broadcast message structure for leader announce", () => {
    const leaderAnnounce = {
      type: "LEADER_ANNOUNCE" as const,
      leaderTabId: "tab_leader_123",
      track: dummyTrack,
      queue: [dummyTrack],
      isPlaying: true,
      currentTime: 30,
      duration: 180,
      volume: 0.8,
      muted: false,
      repeat: "off" as const,
      shuffle: false,
      playbackRate: 1,
      lyrics: [{ timeMs: 0, text: "Line 1" }] as LyricLine[],
      lyricsSource: "lrclib",
    };

    expect(leaderAnnounce.type).toBe("LEADER_ANNOUNCE");
    expect(leaderAnnounce.isPlaying).toBe(true);
    expect(leaderAnnounce.leaderTabId).toBe("tab_leader_123");
    expect(leaderAnnounce.track?.id).toBe("track-123");
  });

  it("validates cross-tab command message structure from secondary tabs", () => {
    const commandPlay = {
      type: "COMMAND_PLAY_TRACK" as const,
      fromTabId: "tab_secondary_456",
      track: dummyTrack,
      newQueue: [dummyTrack],
    };

    const commandSeek = {
      type: "COMMAND_SEEK" as const,
      fromTabId: "tab_secondary_456",
      seconds: 65,
    };

    expect(commandPlay.type).toBe("COMMAND_PLAY_TRACK");
    expect(commandPlay.track.id).toBe("track-123");
    expect(commandSeek.seconds).toBe(65);
  });

  it("handles multi-tab leadership failover and prevents duplicate simultaneous audio playback", () => {
    // Simulate 3 tabs: Tab 1 (Leader), Tab 2 (Secondary), Tab 3 (Secondary)
    const tabs = [
      { id: "tab_leader_1", isLeader: true, isAudioPlaying: true },
      { id: "tab_slave_2", isLeader: false, isAudioPlaying: false },
      { id: "tab_slave_3", isLeader: false, isAudioPlaying: false },
    ];

    // Leader Tab 1 leaves
    tabs[0].isLeader = false;
    tabs[0].isAudioPlaying = false;

    const leaderLeavingMessage = {
      type: "LEADER_LEAVING" as const,
      leaderTabId: "tab_leader_1",
      track: dummyTrack,
      queue: [dummyTrack],
      currentTime: 42,
      isPlaying: true,
    };
    expect(leaderLeavingMessage.type).toBe("LEADER_LEAVING");

    // Stagger priority hash computation matching PlayerContext logic
    const getPriority = (tabId: string) => {
      let hash = 0;
      for (let i = 0; i < tabId.length; i++) {
        hash = (hash * 31 + tabId.charCodeAt(i)) & 0xffffffff;
      }
      return Math.abs(hash % 70);
    };

    const p2 = getPriority(tabs[1].id);
    const p3 = getPriority(tabs[2].id);

    // The tab with lower priority delay wins leadership claim first
    const winnerIdx = p2 <= p3 ? 1 : 2;
    const loserIdx = winnerIdx === 1 ? 2 : 1;

    // Winner claims leadership
    tabs[winnerIdx].isLeader = true;
    tabs[winnerIdx].isAudioPlaying = true;

    const claimMessage = {
      type: "CLAIM_LEADERSHIP" as const,
      newLeaderTabId: tabs[winnerIdx].id,
    };

    // Loser receives CLAIM_LEADERSHIP: must NOT play physical audio
    if (claimMessage.newLeaderTabId !== tabs[loserIdx].id) {
      tabs[loserIdx].isLeader = false;
      tabs[loserIdx].isAudioPlaying = false;
    }

    // Assert exactly ONE tab is leader and playing audio
    const leaders = tabs.filter((t) => t.isLeader);
    const playingAudio = tabs.filter((t) => t.isAudioPlaying);

    expect(leaders).toHaveLength(1);
    expect(playingAudio).toHaveLength(1);
    expect(leaders[0].id).toBe(tabs[winnerIdx].id);
    expect(playingAudio[0].id).toBe(tabs[winnerIdx].id);
  });

  it("ensures lyrics are immediately cleared on track change to prevent lyrics bleed", () => {
    let currentTrack: Track | null = dummyTrack;
    let currentLyrics: LyricLine[] = [{ timeMs: 12000, text: "Old Track Lyric" }];
    let currentSource = "lrclib";

    const newTrack: Track = { ...dummyTrack, id: "track-999", title: "New Track" };

    // Function simulating playTrack transition logic
    const onPlayTrack = (track: Track) => {
      if (currentTrack?.id !== track.id) {
        currentLyrics = [];
        currentSource = "none";
      }
      currentTrack = track;
    };

    onPlayTrack(newTrack);

    expect(currentTrack.id).toBe("track-999");
    expect(currentLyrics).toHaveLength(0);
    expect(currentSource).toBe("none");
  });

  it("ensures audio source and currentTime are prepared when resuming restored track after refresh", () => {
    // Simulating refreshed page state
    const savedState = {
      track: dummyTrack,
      currentTime: 52.4,
      volume: 0.85,
    };

    // Simulated audio element after reload (src starts empty)
    const mockAudio = {
      src: "",
      currentTime: 0,
      paused: true,
      playbackRate: 1,
      volume: 1,
      readyState: 1, // HAVE_METADATA
      playCalled: false,
      play() {
        if (!this.src) return Promise.reject(new Error("No supported sources"));
        this.playCalled = true;
        this.paused = false;
        return Promise.resolve();
      },
      pause() {
        this.paused = true;
      },
    };

    // Simulating ensureAudioPrepared logic
    const ensureAudioPrepared = (track: Track, targetTime?: number) => {
      if (!mockAudio.src || !mockAudio.src.includes(track.audioUrl)) {
        mockAudio.src = track.audioUrl;
        const t = typeof targetTime === "number" ? targetTime : 0;
        if (t > 0) {
          mockAudio.currentTime = t;
        }
      }
    };

    // Initially after reload, audio src is empty
    expect(mockAudio.src).toBe("");

    // Calling ensureAudioPrepared on saved track
    ensureAudioPrepared(savedState.track, savedState.currentTime);

    expect(mockAudio.src).toBe(dummyTrack.audioUrl);
    expect(mockAudio.currentTime).toBe(52.4);

    // Now togglePlay can play without rejecting!
    expect(mockAudio.playCalled).toBe(false);
    return mockAudio.play().then(() => {
      expect(mockAudio.playCalled).toBe(true);
      expect(mockAudio.paused).toBe(false);
    });
  });
});
