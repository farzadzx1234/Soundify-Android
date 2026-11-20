"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  extractCanonicalExternalUrl,
  externalTracksCache,
  normalizeTrack,
  resolveMediaUrl,
} from "@/lib/api";
import { isAndroidNative } from "@/lib/androidBridge";
import { getServerConnectivityStatus, setServerConnectivityStatus } from "@/lib/mobileBackend";
import {
  clearPreservedPlaybackIntent,
  getPreservedPlaybackIntent,
  isNetworkEffectivelyOffline,
  preservePlaybackIntent,
  reportNetworkFailure,
  reportNetworkSuccess,
  startNetworkResilience,
  subscribeNetworkResilience,
  triggerImmediateNetworkProbe,
} from "@/lib/networkResilience";
import { findActiveLyricIndex } from "@/lib/lrc";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { useDeviceSync } from "@/context/DeviceSyncContext";
import {
  getCachedAudioBlobUrl,
  getCachedCoverBlobUrl,
  getDownloadedCoverBlobUrl,
  getDownloadedTrack,
  getDownloadedTrackBlobUrl,
  isTrackDownloaded,
  setCurrentlyPlayingTrackId,
  updateDownloadedLyrics,
} from "@/lib/offlineAudioStorage";
import { getTrackDownloadSnapshot, subscribeToDownloads } from "@/lib/downloadManager";
import { prebufferTrack, recordPlaybackSessionStep } from "@/lib/audioBufferManager";
import {
  initAndroidMediaSession,
  updateAndroidMediaMetadata,
  updateAndroidPlaybackState,
} from "@/lib/androidMediaSession";
import { assertNever, isRecord, parseRemoteCommand } from "@/lib/typeGuards";
import { WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import type { DeviceInfo, LyricLine, Track } from "@/lib/types";

export type RepeatMode = "off" | "all" | "one";

export interface LyricsRefreshResult {
  found: boolean;
  source: string;
}

interface PlayerContextValue {
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  playbackRate: number;
  expanded: boolean;
  queueOpen: boolean;
  visualizerEnabled: boolean;
  lyrics: LyricLine[];
  lyricsSource: string;
  lyricsLoading: boolean;
  analyserNode: AnalyserNode | null;
  getCurrentTime: () => number;
  playTrack: (track: Track, newQueue?: Track[], startTime?: number, autoPlay?: boolean) => void;
  togglePlay: () => void;
  next: (fromEnded?: boolean) => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setPlaybackRate: (rate: number) => void;
  setExpanded: (open: boolean) => void;
  setQueueOpen: (open: boolean) => void;
  setVisualizerEnabled: (enabled: boolean) => void;
  refreshLyrics: (
    forceFetch?: boolean,
    customQuery?: { queryTitle?: string; queryArtist?: string },
  ) => Promise<LyricsRefreshResult>;
  setLyricsLines: (lines: LyricLine[], source: string) => void;
  updateTrackInQueue: (updated: Track) => void;
  lyricsOffsetMs: number;
  adjustLyricsOffset: (deltaMs: number) => void;
  saveLyricsOffset: (targetOffsetMs?: number) => Promise<boolean>;
  applyLyricsSource: (source: string, lrcContent: string) => Promise<boolean>;
  offlineNotice: string | null;
  dismissOfflineNotice: () => void;
  isOffline: boolean;
  isCurrentTrackOffline: boolean;
}

interface PlayerProgressContextValue {
  currentTime: number;
  duration: number;
  activeLyricIndex: number;
}

type SyncMessage =
  | { type: "QUERY_LEADER"; fromTabId: string }
  | {
      type: "LEADER_ANNOUNCE";
      leaderTabId: string;
      track: Track | null;
      queue: Track[];
      isPlaying: boolean;
      currentTime: number;
      duration: number;
      volume: number;
      muted: boolean;
      repeat: RepeatMode;
      shuffle: boolean;
      playbackRate: number;
      lyrics: LyricLine[];
      lyricsSource: string;
    }
  | {
      type: "LEADER_STATE_CHANGE";
      leaderTabId: string;
      track: Track | null;
      queue: Track[];
      isPlaying: boolean;
      currentTime: number;
      duration: number;
      volume: number;
      muted: boolean;
      repeat: RepeatMode;
      shuffle: boolean;
      playbackRate: number;
      lyrics: LyricLine[];
      lyricsSource: string;
    }
  | {
      type: "TIME_SYNC";
      leaderTabId: string;
      currentTime: number;
      duration: number;
      isPlaying: boolean;
    }
  | {
      type: "COMMAND_PLAY_TRACK";
      fromTabId: string;
      track: Track;
      newQueue?: Track[];
    }
  | { type: "COMMAND_TOGGLE_PLAY"; fromTabId: string }
  | { type: "COMMAND_SEEK"; fromTabId: string; seconds: number }
  | { type: "COMMAND_NEXT"; fromTabId: string; fromEnded?: boolean }
  | { type: "COMMAND_PREV"; fromTabId: string }
  | { type: "COMMAND_SET_VOLUME"; fromTabId: string; volume: number }
  | { type: "COMMAND_TOGGLE_MUTE"; fromTabId: string }
  | { type: "COMMAND_TOGGLE_SHUFFLE"; fromTabId: string }
  | { type: "COMMAND_CYCLE_REPEAT"; fromTabId: string }
  | { type: "COMMAND_SET_RATE"; fromTabId: string; rate: number }
  | {
      type: "LEADER_LEAVING";
      leaderTabId: string;
      track: Track | null;
      queue: Track[];
      currentTime: number;
      isPlaying: boolean;
    }
  | { type: "CLAIM_LEADERSHIP"; newLeaderTabId: string };

function checkIsOffline(): boolean {
  if (typeof window === "undefined") return false;
  return isNetworkEffectivelyOffline();
}

const PlayerContext = createContext<PlayerContextValue | null>(null);
const PlayerProgressContext = createContext<PlayerProgressContextValue | null>(null);

let singletonAudio: HTMLAudioElement | null = null;
function getSingletonAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!singletonAudio) {
    let existing = document.getElementById("soundify-global-audio") as HTMLAudioElement | null;
    if (!existing) {
      existing = document.createElement("audio");
      existing.id = "soundify-global-audio";
      existing.preload = "metadata";
      if (!isAndroidNative()) {
        existing.crossOrigin = "anonymous";
      }
      existing.style.display = "none";
      if (document.body) {
        document.body.appendChild(existing);
      }
    }
    singletonAudio = existing;
  }
  return singletonAudio;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const recordedPlayForIdRef = useRef<string | null>(null);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const currentTrackRef = useRef<Track | null>(null);

  const tabIdRef = useRef<string>("");
  const getTabId = useCallback(() => {
    if (!tabIdRef.current) {
      tabIdRef.current =
        typeof window !== "undefined"
          ? "tab_" + Math.random().toString(36).slice(2, 9) + "_" + Date.now().toString(36)
          : "server";
    }
    return tabIdRef.current;
  }, []);

  const isLeaderRef = useRef<boolean>(true);
  const leaderTabIdRef = useRef<string | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const lastTimeSyncSentRef = useRef<number>(0);

  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.82);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [visualizerEnabled, setVisualizerEnabled] = useState(true);

  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricsSource, setLyricsSource] = useState("none");
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsOffsetMs, setLyricsOffsetMs] = useState(0);
  const [analyserState, setAnalyserState] = useState<AnalyserNode | null>(null);

  const [isOffline, setIsOffline] = useState(() => checkIsOffline());
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [downloadVersion, setDownloadVersion] = useState(0);

  useEffect(() => {
    return subscribeToDownloads(() => {
      setDownloadVersion((v) => v + 1);
    });
  }, []);

  const { t, lang } = useI18n();

  const dismissOfflineNotice = useCallback(() => {
    setOfflineNotice(null);
  }, []);

  const isPlayingRef = useRef(false);
  const volumeRef = useRef(0.82);
  const mutedRef = useRef(false);
  const repeatRef = useRef<RepeatMode>("off");
  const shuffleRef = useRef(false);
  const playbackRateRef = useRef(1);
  const queueRef = useRef<Track[]>([]);
  const lyricsRef = useRef<LyricLine[]>([]);
  const lyricsSourceRef = useRef<string>("none");

  const isSettingSourceRef = useRef(false);
  const isRetryingPlayRef = useRef(false);
  const userPausedIntentRef = useRef(false);
  const playRequestIdRef = useRef(0);
  const remotePlayStateLockUntilRef = useRef(0);
  const stallProbeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastSavedStateTimeRef = useRef<number>(0);
  const refreshAttemptsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    startNetworkResilience();
    const handleOnline = () => {
      setIsOffline(false);
      setOfflineNotice(null);
      void triggerImmediateNetworkProbe();
    };
    const handleOffline = () => {
      // Do not immediately hard-lock to offline on Android WebView (VPN handovers emit false offline events);
      // trigger an immediate active probe instead.
      void triggerImmediateNetworkProbe();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!offlineNotice) return;
    const timer = setTimeout(() => {
      setOfflineNotice(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [offlineNotice]);

  const savePlayerState = useCallback((timeOverride?: number) => {
    const track = currentTrackRef.current;
    if (!track) return;
    try {
      localStorage.setItem(
        "soundify_player_state",
        JSON.stringify({
          track,
          queue: queueRef.current,
          volume: volumeRef.current,
          muted: mutedRef.current,
          repeat: repeatRef.current,
          shuffle: shuffleRef.current,
          currentTime: typeof timeOverride === "number" ? timeOverride : currentTimeRef.current,
        }),
      );
    } catch {}
  }, []);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
    if (currentTrack) {
      savePlayerState();
    }
  }, [currentTrack, queue, volume, muted, repeat, shuffle, savePlayerState]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    repeatRef.current = repeat;
  }, [repeat]);

  useEffect(() => {
    shuffleRef.current = shuffle;
  }, [shuffle]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    lyricsRef.current = lyrics;
  }, [lyrics]);

  useEffect(() => {
    lyricsSourceRef.current = lyricsSource;
  }, [lyricsSource]);

  const broadcastLeaderState = useCallback(() => {
    if (!isLeaderRef.current || !channelRef.current) return;
    try {
      channelRef.current.postMessage({
        type: "LEADER_STATE_CHANGE",
        leaderTabId: getTabId(),
        track: currentTrackRef.current,
        queue: queueRef.current,
        isPlaying: isPlayingRef.current,
        currentTime: currentTimeRef.current,
        duration: durationRef.current,
        volume: volumeRef.current,
        muted: mutedRef.current,
        repeat: repeatRef.current,
        shuffle: shuffleRef.current,
        playbackRate: playbackRateRef.current,
        lyrics: lyricsRef.current,
        lyricsSource: lyricsSourceRef.current,
      });
    } catch {}
  }, [getTabId]);

  const initAudioGraph = useCallback(() => {
    // On Capacitor Android WebView, keep <audio> on the native hardware media pipeline instead of
    // hijacking it through WebAudio createMediaElementSource() (which suspends/silences in background/Doze).
    // SpectrumVisualizer smoothly animates via computeSculptedWaveBar when analyserNode is null.
    if (isAndroidNative()) return;
    const audio = getSingletonAudio();
    if (!audio || sourceNodeRef.current) return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.82;
      const source = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      sourceNodeRef.current = source;
      setAnalyserState(analyser);
    } catch {
      // Fallback safely: audio element continues playing without analyser
    }
  }, []);

  const ensureAudioPrepared = useCallback((track: Track, targetTime?: number) => {
    const audio = getSingletonAudio();
    if (!audio) return;
    // Never overwrite audio.src on an actively playing or starting audio element
    if (!audio.paused || isPlayingRef.current || isRetryingPlayRef.current) {
      return;
    }

    const liveSrc = audio.getAttribute("src") || audio.src || "";
    const cachedBlobUrl = getCachedAudioBlobUrl(track.id);

    if (cachedBlobUrl) {
      if (audio.src !== cachedBlobUrl) {
        isSettingSourceRef.current = true;
        audio.src = cachedBlobUrl;
        isSettingSourceRef.current = false;
      }
    } else {
      const isDownloadedSync = getTrackDownloadSnapshot(track.id).status === "downloaded";
      if (!isDownloadedSync) {
        // Set resolved URL synchronously when online so immediate togglePlay() never calls play() on empty src
        const isDeviceOffline = checkIsOffline();
        if (!isDeviceOffline) {
          const targetUrl = resolveMediaUrl(track.audioUrl);
          if (
            targetUrl &&
            (!liveSrc || (!liveSrc.includes(targetUrl) && liveSrc !== targetUrl && !liveSrc.startsWith("blob:")))
          ) {
            isSettingSourceRef.current = true;
            audio.src = targetUrl;
            isSettingSourceRef.current = false;
          }
        }
      }

      const upgradeToOfflineBlob = (blobUrl: string | null) => {
        if (!blobUrl) return;
        // Abort if user switched tracks or playback already started while IndexedDB resolved
        if (currentTrackRef.current?.id !== track.id) return;
        if (!audio.paused || isPlayingRef.current || isRetryingPlayRef.current) return;
        if (audio.src === blobUrl) return;

        const savedTime = audio.currentTime;
        isSettingSourceRef.current = true;
        audio.src = blobUrl;
        isSettingSourceRef.current = false;
        if (savedTime > 0) {
          try {
            audio.currentTime = savedTime;
          } catch {}
        }
      };

      if (isDownloadedSync) {
        void getDownloadedTrackBlobUrl(track.id).then(upgradeToOfflineBlob);
      } else {
        void isTrackDownloaded(track.id).then((stored) => {
          if (currentTrackRef.current?.id !== track.id) return;
          if (!audio.paused || isPlayingRef.current || isRetryingPlayRef.current) return;
          if (stored) {
            void getDownloadedTrackBlobUrl(track.id).then(upgradeToOfflineBlob);
          }
        });
      }
    }

    audio.playbackRate = playbackRateRef.current;
    audio.volume = mutedRef.current ? 0 : volumeRef.current;
    const t = typeof targetTime === "number" ? targetTime : currentTimeRef.current;
    if (t > 0) {
      if (audio.readyState >= 1) {
        try {
          audio.currentTime = t;
        } catch {}
      } else {
        const expectedTrackId = track.id;
        const onLoaded = () => {
          audio.removeEventListener("loadedmetadata", onLoaded);
          if (currentTrackRef.current?.id !== expectedTrackId) return;
          try {
            audio.currentTime = t;
          } catch {}
        };
        audio.addEventListener("loadedmetadata", onLoaded);
      }
    }
  }, []);

  const { user } = useAuth();
  const {
    deviceId,
    activeDeviceId,
    setActiveDeviceId,
    isThisDeviceActive,
    isSyncEnabled,
    syncState,
    claimThisDevice,
    broadcastLocalState,
    sendRemoteCommand,
    registerCommandHandler,
    devices,
  } = useDeviceSync();

  const isThisDeviceActiveRef = useRef<boolean>(isThisDeviceActive);
  const activeDeviceIdRef = useRef<string | null>(activeDeviceId);
  const syncStateRef = useRef<typeof syncState>(syncState);
  const isSyncEnabledRef = useRef<boolean>(isSyncEnabled);
  const localSessionStartedRef = useRef<boolean>(false);
  const devicesRef = useRef<DeviceInfo[]>(devices);

  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

  useEffect(() => {
    isThisDeviceActiveRef.current = isThisDeviceActive;
    if (!isThisDeviceActive && activeDeviceId && activeDeviceId !== deviceId) {
      localSessionStartedRef.current = false;
    }
  }, [isThisDeviceActive, activeDeviceId, deviceId]);

  useEffect(() => {
    activeDeviceIdRef.current = activeDeviceId;
  }, [activeDeviceId]);

  useEffect(() => {
    syncStateRef.current = syncState;
  }, [syncState]);

  useEffect(() => {
    isSyncEnabledRef.current = isSyncEnabled;
  }, [isSyncEnabled]);

  const shouldActAsRemoteController = useCallback(() => {
    if (!isSyncEnabledRef.current) return false;
    if (isThisDeviceActiveRef.current) return false;
    const audio = getSingletonAudio();
    if (audio && !audio.paused) return false;
    const activeId = activeDeviceIdRef.current;
    if (!activeId || activeId === deviceId) return false;
    if (syncStateRef.current === null) return false;
    return devicesRef.current.some(
      (d) => d.id === activeId && (d.isActive || d.id !== deviceId),
    );
  }, [deviceId]);

  const shouldActAsRemoteControllerRef = useRef(shouldActAsRemoteController);
  useEffect(() => {
    shouldActAsRemoteControllerRef.current = shouldActAsRemoteController;
  }, [shouldActAsRemoteController]);

  const sendRemoteCommandRef = useRef(sendRemoteCommand);
  useEffect(() => {
    sendRemoteCommandRef.current = sendRemoteCommand;
  }, [sendRemoteCommand]);

  const lastBroadcastTimeRef = useRef<number>(0);

  const broadcastCurrentState = useCallback(() => {
    if (!isThisDeviceActiveRef.current || !currentTrackRef.current) return;
    void broadcastLocalState({
      trackId: currentTrackRef.current.id,
      isPlaying: isPlayingRef.current,
      currentTime: currentTimeRef.current,
      duration: durationRef.current,
      volume: volumeRef.current,
      repeat: repeatRef.current,
      shuffle: shuffleRef.current,
    });
  }, [broadcastLocalState]);

  const loadLyricsForTrack = useCallback(
    async (
      trackId: string,
      forceFetch = false,
      customQuery?: { queryTitle?: string; queryArtist?: string },
    ): Promise<LyricsRefreshResult> => {
      setLyricsLoading(true);
      try {
        // 1. Check offline storage first
        if (!forceFetch && !customQuery?.queryTitle && !customQuery?.queryArtist) {
          try {
            const offlineRecord = await getDownloadedTrack(trackId);
            if (offlineRecord?.lyrics?.lines && offlineRecord.lyrics.lines.length > 0) {
              const lns = offlineRecord.lyrics.lines;
              const src = offlineRecord.lyrics.source || "offline";
              setLyrics(lns);
              lyricsRef.current = lns;
              setLyricsSource(src);
              lyricsSourceRef.current = src;
              setLyricsOffsetMs(offlineRecord.lyrics.lyricsOffsetMs ?? 0);
              broadcastLeaderState();
              return { found: true, source: src };
            }
          } catch {}

          if (checkIsOffline()) {
            return { found: false, source: "none" };
          }
        }

        if (forceFetch || customQuery?.queryTitle || customQuery?.queryArtist || trackId.startsWith("ext-")) {
          const res = await api.autoFetchLyrics(trackId, {
            forceRefresh: true,
            queryTitle: customQuery?.queryTitle || currentTrackRef.current?.title,
            queryArtist: customQuery?.queryArtist || currentTrackRef.current?.artistName,
            durationSec: currentTrackRef.current?.durationSec,
          });
          if (res.found && Array.isArray(res.lines) && res.lines.length > 0) {
            setLyrics(res.lines);
            lyricsRef.current = res.lines;
            setLyricsSource(res.source ?? "lrclib");
            lyricsSourceRef.current = res.source ?? "lrclib";
            setLyricsOffsetMs(0);
            broadcastLeaderState();
            void updateDownloadedLyrics(trackId, {
              lines: res.lines,
              source: res.source ?? "lrclib",
              lyricsOffsetMs: 0,
            }).catch(() => {});
            return { found: true, source: res.source ?? "lrclib" };
          }
          return { found: false, source: "none" };
        }
        const res = await api.getLyrics(trackId);
        const lns = res.lines ?? [];
        const src = res.source ?? "none";
        setLyrics(lns);
        lyricsRef.current = lns;
        setLyricsSource(src);
        lyricsSourceRef.current = src;
        setLyricsOffsetMs(res.lyricsOffsetMs ?? 0);
        broadcastLeaderState();
        if (lns.length > 0) {
          void updateDownloadedLyrics(trackId, {
            lines: lns,
            source: src,
            lyricsOffsetMs: res.lyricsOffsetMs ?? 0,
          }).catch(() => {});
        }
        return { found: lns.length > 0, source: src };
      } catch {
        if (!forceFetch && !customQuery?.queryTitle && !customQuery?.queryArtist) {
          setLyrics([]);
          lyricsRef.current = [];
          setLyricsSource("none");
          lyricsSourceRef.current = "none";
          setLyricsOffsetMs(0);
          broadcastLeaderState();
        }
        return { found: false, source: "none" };
      } finally {
        setLyricsLoading(false);
      }
    },
    [broadcastLeaderState],
  );

  const effectiveCurrentTrack = useMemo(
    () =>
      !user && currentTrack
        ? { ...currentTrack, likedByMe: false, repostedByMe: false }
        : currentTrack,
    [currentTrack, user],
  );

  const effectiveQueue = useMemo(
    () =>
      !user
        ? queue.map((t) => ({ ...t, likedByMe: false, repostedByMe: false }))
        : queue,
    [queue, user],
  );

  const notifyServerConnectivityIssue = useCallback(() => {
    reportNetworkFailure();
    const browserOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
    setServerConnectivityStatus(browserOnline ? "vpn_or_server_down" : "offline");
    setOfflineNotice(
      browserOnline
        ? lang === "fa"
          ? "ارتباط با سرور ناپایدار است - اتصال اینترنت یا فیلترشکن را بررسی کنید (تلاش خودکار برای اتصال مجدد...)"
          : "Server connection unstable - check internet or VPN (auto-reconnecting...)"
        : lang === "fa"
          ? "اتصال اینترنت قطع شده است - به محض برقراری اتصال، پخش خودکار ادامه می‌یابد"
          : "Internet disconnected - playback will auto-resume when back online",
    );
    void triggerImmediateNetworkProbe();
  }, [lang]);

  const attemptPlayWithRetry = useCallback(
    async (
      audio: HTMLAudioElement,
      track: Track,
      isDownloaded: boolean,
      baseAudioSource?: string,
      targetStartSec?: number,
    ): Promise<boolean> => {
      const reqId = ++playRequestIdRef.current;
      userPausedIntentRef.current = false;
      isRetryingPlayRef.current = true;
      setIsPlaying(true);
      isPlayingRef.current = true;

      const desiredPos =
        typeof targetStartSec === "number" && targetStartSec > 0
          ? targetStartSec
          : audio.currentTime > 0
            ? audio.currentTime
            : currentTimeRef.current;
      preservePlaybackIntent(track.id, desiredPos, true);

      const isExternalTrack =
        track.id.startsWith("ext-") ||
        track.source === "youtube" ||
        track.source === "soundcloud" ||
        track.source === "spotify" ||
        Boolean(track.audioUrl?.includes("/api/stream/external"));

      const retryDelays = isExternalTrack ? [0, 1800, 3500] : [0, 450, 1200];
      for (let attempt = 0; attempt < retryDelays.length; attempt++) {
        if (playRequestIdRef.current !== reqId || userPausedIntentRef.current) {
          isRetryingPlayRef.current = false;
          isSettingSourceRef.current = false;
          return false;
        }

        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
          if (playRequestIdRef.current !== reqId || userPausedIntentRef.current) {
            isRetryingPlayRef.current = false;
            isSettingSourceRef.current = false;
            return false;
          }

          // Re-establish fresh HTTP socket on retry for online streams (bypasses dead VPN sockets)
          const rawSource = baseAudioSource || resolveMediaUrl(track.audioUrl);
          if (rawSource && !rawSource.startsWith("blob:") && !rawSource.startsWith("data:")) {
            const cleanedSource = rawSource.replace(/([?&])_rt=\d+/g, "$1").replace(/[?&]$/, "").replace(/\?&/, "?");
            const sep = cleanedSource.includes("?") ? "&" : "?";
            const bustedUrl = `${cleanedSource}${sep}_rt=${Date.now()}`;
            const resumeAt = audio.currentTime > 0 ? audio.currentTime : desiredPos;
            isSettingSourceRef.current = true;
            audio.src = bustedUrl;
            try {
              audio.load();
            } catch {}
            if (resumeAt > 0) {
              const onMeta = () => {
                try {
                  audio.currentTime = resumeAt;
                } catch {}
                audio.removeEventListener("loadedmetadata", onMeta);
              };
              audio.addEventListener("loadedmetadata", onMeta);
            }
          }
        }

        try {
          await audio.play();
          if (playRequestIdRef.current !== reqId || userPausedIntentRef.current) {
            try {
              audio.pause();
            } catch {}
            isSettingSourceRef.current = false;
            isRetryingPlayRef.current = false;
            return false;
          }
          isSettingSourceRef.current = false;
          isRetryingPlayRef.current = false;
          reportNetworkSuccess();
          setOfflineNotice(null);
          setIsPlaying(true);
          isPlayingRef.current = true;
          broadcastLeaderState();
          void broadcastLocalState({
            trackId: track.id,
            isPlaying: true,
            currentTime: audio.currentTime || desiredPos || 0,
            duration: audio.duration || durationRef.current || track.durationSec || 0,
            volume: volumeRef.current,
            repeat: repeatRef.current,
            shuffle: shuffleRef.current,
          });
          return true;
        } catch (err: unknown) {
          if (playRequestIdRef.current !== reqId || userPausedIntentRef.current) {
            return false;
          }
          const errName = (err as { name?: string })?.name || "";
          // Autoplay restriction cannot be fixed by retrying without user gesture
          if (errName === "NotAllowedError") {
            isSettingSourceRef.current = false;
            isRetryingPlayRef.current = false;
            setIsPlaying(false);
            isPlayingRef.current = false;
            broadcastLeaderState();
            return false;
          }
          // For AbortError / network hiccup / VPN jitter, continue to next retry attempt
        }
      }

      if (playRequestIdRef.current === reqId) {
        isSettingSourceRef.current = false;
        isRetryingPlayRef.current = false;
        setIsPlaying(false);
        isPlayingRef.current = false;
        broadcastLeaderState();
        if (!isDownloaded) {
          notifyServerConnectivityIssue();
        }
      }
      return false;
    },
    [broadcastLeaderState, broadcastLocalState, notifyServerConnectivityIssue],
  );

  const playTrack = useCallback(
    async (track: Track, newQueue?: Track[], startTime?: number, autoPlay?: boolean) => {
      const normalizedTrack = normalizeTrack(track);
      const normalizedQueue = Array.isArray(newQueue) && newQueue.length > 0 ? newQueue.map(normalizeTrack) : undefined;
      const startSec = typeof startTime === "number" && startTime > 0 ? startTime : 0;
      const isUiToggleCall = startTime === undefined && autoPlay === undefined;
      const resolvedAutoPlay = autoPlay ?? true;

      // Fast path: if user taps Pause on the currently playing track card / detail hero button,
      // pause immediately without requiring online checks or re-buffering.
      if (isUiToggleCall && currentTrackRef.current?.id === normalizedTrack.id) {
        const currentAudio = getSingletonAudio();
        const isCurrentlyActive = Boolean(
          (currentAudio && !currentAudio.paused) || isPlayingRef.current || isRetryingPlayRef.current,
        );
        if (isCurrentlyActive) {
          if (shouldActAsRemoteController()) {
            remotePlayStateLockUntilRef.current = Date.now() + 2500;
            setIsPlaying(false);
            isPlayingRef.current = false;
            void sendRemoteCommand("PAUSE");
            void updateAndroidPlaybackState({
              isPlaying: false,
              position: currentTimeRef.current,
              duration: durationRef.current,
              playbackRate: 1,
            });
            return;
          }
          userPausedIntentRef.current = true;
          playRequestIdRef.current += 1;
          isSettingSourceRef.current = false;
          isRetryingPlayRef.current = false;
          clearPreservedPlaybackIntent();
          if (currentAudio && !currentAudio.paused) {
            currentAudio.pause();
          }
          setIsPlaying(false);
          isPlayingRef.current = false;
          broadcastLeaderState();
          broadcastCurrentState();
          return;
        }
      }

      let isDownloaded = getTrackDownloadSnapshot(normalizedTrack.id).status === "downloaded";
      if (!isDownloaded) {
        isDownloaded = await isTrackDownloaded(normalizedTrack.id);
      }

      // Check strictly if device is genuinely offline via navigator.onLine without prematurely blocking online streams
      if (typeof navigator !== "undefined" && navigator.onLine === false && !isDownloaded) {
        preservePlaybackIntent(normalizedTrack.id, startSec, resolvedAutoPlay);
        setOfflineNotice(
          t
            ? t("offlinePlaybackNotice")
            : "این قطعه دانلود نشده است. برای پخش آفلاین، ابتدا باید در حالت آنلاین دانلود شود",
        );
        setIsPlaying(false);
        isPlayingRef.current = false;
        broadcastLeaderState();
        return;
      }

      setCurrentlyPlayingTrackId(normalizedTrack.id);
      setOfflineNotice(null);

      // Playing a track from mobile/local UI ALWAYS takes sovereignty immediately
      localSessionStartedRef.current = true;
      isThisDeviceActiveRef.current = true;
      activeDeviceIdRef.current = deviceId;
      setActiveDeviceId(deviceId);
      isLeaderRef.current = true;

      void claimThisDevice({
        track: normalizedTrack,
        trackId: normalizedTrack.id,
        isPlaying: resolvedAutoPlay,
        currentTime: startSec,
        duration: normalizedTrack.durationSec || 0,
        volume: volumeRef.current,
        repeat: repeatRef.current,
        shuffle: shuffleRef.current,
      });

      if (normalizedQueue && normalizedQueue.length > 0) {
        queueRef.current = normalizedQueue;
        setQueue(normalizedQueue);
      } else {
        setQueue((prev) => {
          const nextQ = prev.some((t) => t.id === normalizedTrack.id) ? prev : [normalizedTrack, ...prev];
          queueRef.current = nextQ;
          return nextQ;
        });
      }

      const audio = getSingletonAudio();
      if (!audio) return;

      // Resolve audio source URL and offline cover if downloaded
      let audioSource = resolveMediaUrl(normalizedTrack.audioUrl);
      let trackToPlay = normalizedTrack;

      const isExternal =
        trackToPlay.id.startsWith("ext-") ||
        trackToPlay.source === "youtube" ||
        trackToPlay.source === "soundcloud" ||
        trackToPlay.source === "spotify";

      if (isExternal && !isDownloaded) {
        const canonical = extractCanonicalExternalUrl(trackToPlay.pageUrl || trackToPlay.audioUrl, trackToPlay.id);
        const resolvedAudio = trackToPlay.audioUrl && !trackToPlay.audioUrl.includes("fallback-preview.mp3")
          ? trackToPlay.audioUrl
          : `/api/stream/external?url=${encodeURIComponent(canonical)}&id=${encodeURIComponent(trackToPlay.id)}`;

        trackToPlay = {
          ...trackToPlay,
          pageUrl: canonical || trackToPlay.pageUrl,
          audioUrl: resolvedAudio,
        };
        audioSource = resolveMediaUrl(resolvedAudio);
        externalTracksCache.set(trackToPlay.id, trackToPlay);
      }

      if (isDownloaded) {
        try {
          const [blobUrl, coverBlobUrl] = await Promise.all([
            getDownloadedTrackBlobUrl(track.id),
            getDownloadedCoverBlobUrl(track.id),
          ]);
          if (blobUrl) {
            audioSource = blobUrl;
          }
          if (coverBlobUrl) {
            trackToPlay = { ...track, coverUrl: coverBlobUrl };
          }
        } catch {}

        const isDeviceOffline = typeof navigator !== "undefined" && navigator.onLine === false;
        if (isDeviceOffline && !audioSource.startsWith("blob:")) {
          setOfflineNotice(
            t
              ? t("downloadFailed")
              : "خطا در بارگذاری فایل صوتی ذخیره‌شده برای پخش آفلاین",
          );
          setIsPlaying(false);
          isPlayingRef.current = false;
          broadcastLeaderState();
          return;
        }
      }

      if (currentTrackRef.current?.id === track.id) {
        if (audio.src !== audioSource) {
          const prevTime = audio.currentTime;
          isSettingSourceRef.current = true;
          audio.src = audioSource;
          if (startSec > 0) {
            try { audio.currentTime = startSec; } catch {}
          } else if (prevTime > 0) {
            try { audio.currentTime = prevTime; } catch {}
          }
        }
        if (trackToPlay.coverUrl !== currentTrackRef.current.coverUrl) {
          currentTrackRef.current = trackToPlay;
          setCurrentTrack(trackToPlay);
        }
        if (lyricsRef.current.length === 0) {
          void loadLyricsForTrack(track.id, false);
        }
        if (audio.paused && resolvedAutoPlay) {
          initAudioGraph();
          if (audioCtxRef.current?.state === "suspended") {
            void audioCtxRef.current.resume();
          }
          await attemptPlayWithRetry(audio, trackToPlay, isDownloaded, audioSource, startSec);
        } else if (!audio.paused && !resolvedAutoPlay) {
          userPausedIntentRef.current = true;
          playRequestIdRef.current += 1;
          clearPreservedPlaybackIntent();
          isSettingSourceRef.current = false;
          isRetryingPlayRef.current = false;
          audio.pause();
          setIsPlaying(false);
          isPlayingRef.current = false;
          broadcastLeaderState();
          broadcastCurrentState();
        } else if (!audio.paused && resolvedAutoPlay && typeof startTime === "number" && startTime >= 0) {
          try {
            audio.currentTime = startSec;
            currentTimeRef.current = startSec;
            setCurrentTime(startSec);
          } catch {}
        }
        return;
      }

      // Track is changing! Immediately reset lyrics to avoid showing previous song lyrics
      setLyrics([]);
      lyricsRef.current = [];
      setLyricsSource("none");
      lyricsSourceRef.current = "none";

      recordedPlayForIdRef.current = null;
      refreshAttemptsRef.current[track.id] = 0;
      currentTrackRef.current = trackToPlay;
      currentTimeRef.current = startSec;
      durationRef.current = track.durationSec || 0;
      setCurrentTrack(trackToPlay);
      setCurrentTime(startSec);
      setDuration(track.durationSec || 0);

      if (audio.src !== audioSource) {
        isSettingSourceRef.current = true;
        audio.src = audioSource;
        try {
          audio.load();
        } catch {}
      }
      setCurrentlyPlayingTrackId(trackToPlay.id);
      recordPlaybackSessionStep(audio);
      audio.playbackRate = playbackRateRef.current;
      audio.volume = mutedRef.current ? 0 : volumeRef.current;
      if (startSec > 0) {
        if (audio.readyState >= 1) {
          try { audio.currentTime = startSec; } catch {}
        } else {
          const onLoaded = () => {
            try { audio.currentTime = startSec; } catch {}
            audio.removeEventListener("loadedmetadata", onLoaded);
          };
          audio.addEventListener("loadedmetadata", onLoaded);
        }
      }

      initAudioGraph();
      if (audioCtxRef.current?.state === "suspended") {
        void audioCtxRef.current.resume();
      }

      if (!resolvedAutoPlay) {
        userPausedIntentRef.current = true;
        playRequestIdRef.current += 1;
        clearPreservedPlaybackIntent();
        isSettingSourceRef.current = false;
        isRetryingPlayRef.current = false;
        setIsPlaying(false);
        isPlayingRef.current = false;
        broadcastLeaderState();
        broadcastCurrentState();
        void loadLyricsForTrack(track.id, false);
        return;
      }

      await attemptPlayWithRetry(audio, trackToPlay, isDownloaded, audioSource, startSec);
      void loadLyricsForTrack(track.id, false);
    },
    [attemptPlayWithRetry, broadcastCurrentState, broadcastLeaderState, claimThisDevice, deviceId, initAudioGraph, loadLyricsForTrack, sendRemoteCommand, setActiveDeviceId, shouldActAsRemoteController, t],
  );

  const next = useCallback(
    (fromEnded = false) => {
      if (shouldActAsRemoteController()) {
        void sendRemoteCommand("NEXT");
        return;
      }

      if (!isLeaderRef.current && leaderTabIdRef.current && channelRef.current) {
        channelRef.current.postMessage({
          type: "COMMAND_NEXT",
          fromTabId: getTabId(),
          fromEnded,
        });
        return;
      }

      const curr = currentTrackRef.current;
      const q = queueRef.current;
      if (!curr || q.length === 0) return;
      const audio = getSingletonAudio();
      if (fromEnded && repeat === "one" && audio) {
        audio.currentTime = 0;
        void audio.play();
        broadcastLeaderState();
        return;
      }
      const idx = q.findIndex((t) => t.id === curr.id);
      let nextIdx = idx + 1;

      // When offline, seek next downloaded track in queue to avoid stopping or throwing network errors
      if (checkIsOffline()) {
        const nextDownloaded = q.find((t, i) => i > idx && getTrackDownloadSnapshot(t.id).status === "downloaded");
        if (nextDownloaded) {
          playTrack(nextDownloaded, undefined, 0, true);
          return;
        }
        if (repeat === "all" || (!fromEnded && q.some((t) => getTrackDownloadSnapshot(t.id).status === "downloaded"))) {
          const wrapDownloaded = q.find((t) => getTrackDownloadSnapshot(t.id).status === "downloaded");
          if (wrapDownloaded && wrapDownloaded.id !== curr.id) {
            playTrack(wrapDownloaded, undefined, 0, true);
            return;
          }
        }
        // Graceful stop when offline and no further downloaded tracks exist in queue
        setIsPlaying(false);
        isPlayingRef.current = false;
        broadcastLeaderState();
        return;
      }

      if (shuffle && q.length > 1) {
        do {
          nextIdx = Math.floor(Math.random() * q.length);
        } while (nextIdx === idx);
      } else if (nextIdx >= q.length) {
        if (repeat === "all" || !fromEnded) nextIdx = 0;
        else {
          setIsPlaying(false);
          isPlayingRef.current = false;
          broadcastLeaderState();
          return;
        }
      }
      const target = q[nextIdx];
      if (target) playTrack(target, undefined, 0, true);
    },
    [broadcastLeaderState, getTabId, playTrack, repeat, sendRemoteCommand, shouldActAsRemoteController, shuffle],
  );

  const prev = useCallback(() => {
    if (shouldActAsRemoteController()) {
      void sendRemoteCommand("PREV");
      return;
    }

    if (!isLeaderRef.current && leaderTabIdRef.current && channelRef.current) {
      channelRef.current.postMessage({
        type: "COMMAND_PREV",
        fromTabId: getTabId(),
      });
      return;
    }

    const audio = getSingletonAudio();
    const curr = currentTrackRef.current;
    const q = queueRef.current;
    if (!curr || q.length === 0) return;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      currentTimeRef.current = 0;
      setCurrentTime(0);
      broadcastLeaderState();
      return;
    }
    const idx = q.findIndex((t) => t.id === curr.id);

    // When offline, seek previous downloaded track in queue
    if (checkIsOffline()) {
      const prevDownloaded = [...q].reverse().find((t, i) => {
        const origIdx = q.length - 1 - i;
        return origIdx < idx && getTrackDownloadSnapshot(t.id).status === "downloaded";
      });
      if (prevDownloaded) {
        playTrack(prevDownloaded, undefined, 0, true);
        return;
      }
      const wrapDownloaded = [...q].reverse().find((t) => getTrackDownloadSnapshot(t.id).status === "downloaded");
      if (wrapDownloaded && wrapDownloaded.id !== curr.id) {
        playTrack(wrapDownloaded, undefined, 0, true);
        return;
      }
      if (audio) {
        audio.currentTime = 0;
        currentTimeRef.current = 0;
        setCurrentTime(0);
        broadcastLeaderState();
      }
      return;
    }

    const prevIdx = idx <= 0 ? q.length - 1 : idx - 1;
    const target = q[prevIdx];
    if (target) playTrack(target, undefined, 0, true);
  }, [broadcastLeaderState, getTabId, playTrack, sendRemoteCommand, shouldActAsRemoteController]);

  const togglePlay = useCallback(async () => {
    if (shouldActAsRemoteController()) {
      const nextPlaying = !isPlayingRef.current;
      remotePlayStateLockUntilRef.current = Date.now() + 2500;
      setIsPlaying(nextPlaying);
      isPlayingRef.current = nextPlaying;
      void sendRemoteCommand(nextPlaying ? "PLAY" : "PAUSE");
      void updateAndroidPlaybackState({
        isPlaying: nextPlaying,
        position: currentTimeRef.current,
        duration: durationRef.current,
        playbackRate: 1,
      });
      return;
    }

    if (!isLeaderRef.current && leaderTabIdRef.current && channelRef.current) {
      channelRef.current.postMessage({
        type: "COMMAND_TOGGLE_PLAY",
        fromTabId: getTabId(),
      });
      setIsPlaying((p) => !p);
      isPlayingRef.current = !isPlayingRef.current;
      return;
    }

    const audio = getSingletonAudio();
    if (!audio) return;
    const curr = currentTrackRef.current;
    if (!curr && queueRef.current.length > 0) {
      playTrack(queueRef.current[0]);
      return;
    }
    if (!curr) return;

    // Ensure audio element has source loaded (e.g. after page refresh)
    const isDeviceOffline = checkIsOffline();
    let isDownloadedSync = getTrackDownloadSnapshot(curr.id).status === "downloaded";
    if (!isDownloadedSync) {
      isDownloadedSync = await isTrackDownloaded(curr.id);
    }

    const shouldStartPlaying = audio.paused && !isPlayingRef.current && !isRetryingPlayRef.current;
    if (shouldStartPlaying) {
      if (isDeviceOffline && !isDownloadedSync) {
        const actuallyOnline = await triggerImmediateNetworkProbe();
        if (!actuallyOnline) {
          preservePlaybackIntent(curr.id, audio.currentTime || currentTimeRef.current, true);
          setOfflineNotice(
            t
              ? t("offlinePlaybackNotice")
              : "این قطعه دانلود نشده است. برای پخش آفلاین، ابتدا باید در حالت آنلاین دانلود شود",
          );
          return;
        }
      }

      if (isDownloadedSync) {
        setOfflineNotice(null);
        setCurrentlyPlayingTrackId(curr.id);
        let cachedBlob = getCachedAudioBlobUrl(curr.id);
        if (!cachedBlob) {
          cachedBlob = await getDownloadedTrackBlobUrl(curr.id);
        }
        if (cachedBlob && audio.src !== cachedBlob) {
          const curT = audio.currentTime;
          isSettingSourceRef.current = true;
          audio.src = cachedBlob;
          if (curT > 0) {
            try {
              audio.currentTime = curT;
            } catch {}
          }
        }
        let cachedCover = getCachedCoverBlobUrl(curr.id);
        if (!cachedCover) {
          cachedCover = await getDownloadedCoverBlobUrl(curr.id);
        }
        if (cachedCover && curr.coverUrl !== cachedCover) {
          const enriched = { ...curr, coverUrl: cachedCover };
          currentTrackRef.current = enriched;
          setCurrentTrack(enriched);
        }
      } else {
        setCurrentlyPlayingTrackId(curr.id);
        const targetUrl = resolveMediaUrl(curr.audioUrl);
        const liveSrc = audio.getAttribute("src") || audio.src || "";
        if (targetUrl && (!liveSrc || (!liveSrc.includes(targetUrl) && liveSrc !== targetUrl && !liveSrc.startsWith("blob:")))) {
          isSettingSourceRef.current = true;
          audio.src = targetUrl;
        }
      }

      ensureAudioPrepared(curr);
      if (lyricsRef.current.length === 0) {
        void loadLyricsForTrack(curr.id, false);
      }

      initAudioGraph();
      if (audioCtxRef.current?.state === "suspended") {
        void audioCtxRef.current.resume();
      }
      localSessionStartedRef.current = true;
      if (!isThisDeviceActiveRef.current || activeDeviceIdRef.current !== deviceId) {
        isThisDeviceActiveRef.current = true;
        void claimThisDevice({
          track: curr,
          trackId: curr.id,
          isPlaying: true,
          currentTime: audio.currentTime,
          duration: audio.duration || durationRef.current || curr.durationSec || 0,
          volume: volumeRef.current,
          repeat: repeatRef.current,
          shuffle: shuffleRef.current,
        });
      }
      await attemptPlayWithRetry(audio, curr, isDownloadedSync);
    } else {
      userPausedIntentRef.current = true;
      playRequestIdRef.current += 1;
      isSettingSourceRef.current = false;
      isRetryingPlayRef.current = false;
      clearPreservedPlaybackIntent();
      audio.pause();
      setIsPlaying(false);
      isPlayingRef.current = false;
      broadcastLeaderState();
      broadcastCurrentState();
    }
  }, [attemptPlayWithRetry, broadcastCurrentState, broadcastLeaderState, claimThisDevice, deviceId, ensureAudioPrepared, getTabId, initAudioGraph, loadLyricsForTrack, playTrack, sendRemoteCommand, shouldActAsRemoteController, t]);

  const seek = useCallback(
    (seconds: number) => {
      if (shouldActAsRemoteController()) {
        void sendRemoteCommand("SEEK", { seconds });
        currentTimeRef.current = seconds;
        setCurrentTime(seconds);
        return;
      }

      if (!isLeaderRef.current && leaderTabIdRef.current && channelRef.current) {
        channelRef.current.postMessage({
          type: "COMMAND_SEEK",
          fromTabId: getTabId(),
          seconds,
        });
        currentTimeRef.current = seconds;
        setCurrentTime(seconds);
        return;
      }

      const audio = getSingletonAudio();
      if (!audio || !Number.isFinite(seconds)) return;
      const curr = currentTrackRef.current;
      if (curr) {
        ensureAudioPrepared(curr, seconds);
      }
      const clamped = Math.max(0, Math.min(audio.duration || durationRef.current || 0, seconds));
      audio.currentTime = clamped;
      currentTimeRef.current = clamped;
      setCurrentTime(clamped);
      void updateAndroidPlaybackState({
        isPlaying: isPlayingRef.current,
        position: clamped,
        duration: audio.duration || durationRef.current || 0,
        playbackRate: audio.playbackRate || 1,
      });
      broadcastCurrentState();
      if (isLeaderRef.current && channelRef.current) {
        channelRef.current.postMessage({
          type: "TIME_SYNC",
          leaderTabId: getTabId(),
          currentTime: clamped,
          duration: audio.duration || durationRef.current,
          isPlaying: isPlayingRef.current,
        });
      }
    },
    [broadcastCurrentState, ensureAudioPrepared, getTabId, sendRemoteCommand, shouldActAsRemoteController],
  );

  const setVolume = useCallback(
    (vol: number) => {
      const clamped = Math.max(0, Math.min(1, vol));
      setVolumeState(clamped);
      volumeRef.current = clamped;
      setMuted(clamped === 0);
      mutedRef.current = clamped === 0;

      if (shouldActAsRemoteController()) {
        void sendRemoteCommand("SET_VOLUME", { volume: clamped });
        return;
      }

      if (!isLeaderRef.current && leaderTabIdRef.current && channelRef.current) {
        channelRef.current.postMessage({
          type: "COMMAND_SET_VOLUME",
          fromTabId: getTabId(),
          volume: clamped,
        });
        return;
      }

      const audio = getSingletonAudio();
      if (audio) {
        audio.volume = clamped;
      }
      broadcastLeaderState();
      broadcastCurrentState();
    },
    [broadcastCurrentState, broadcastLeaderState, getTabId, sendRemoteCommand, shouldActAsRemoteController],
  );

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    setMuted(nextMuted);
    mutedRef.current = nextMuted;

    if (shouldActAsRemoteController()) {
      void sendRemoteCommand("SET_VOLUME", { volume: nextMuted ? 0 : volumeRef.current || 0.8 });
      return;
    }

    if (!isLeaderRef.current && leaderTabIdRef.current && channelRef.current) {
      channelRef.current.postMessage({
        type: "COMMAND_TOGGLE_MUTE",
        fromTabId: getTabId(),
      });
      return;
    }

    const audio = getSingletonAudio();
    if (audio) {
      audio.volume = nextMuted ? 0 : volumeRef.current;
    }
    broadcastLeaderState();
  }, [broadcastLeaderState, getTabId, sendRemoteCommand, shouldActAsRemoteController]);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => {
      const nextS = !s;
      shuffleRef.current = nextS;
      if (!isThisDeviceActive) {
        void sendRemoteCommand("SET_SHUFFLE", { shuffle: nextS });
        return nextS;
      }
      if (!isLeaderRef.current && leaderTabIdRef.current && channelRef.current) {
        channelRef.current.postMessage({
          type: "COMMAND_TOGGLE_SHUFFLE",
          fromTabId: getTabId(),
        });
      } else {
        broadcastLeaderState();
      }
      return nextS;
    });
  }, [broadcastLeaderState, getTabId, isThisDeviceActive, sendRemoteCommand]);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => {
      const nextR = r === "off" ? "all" : r === "all" ? "one" : "off";
      repeatRef.current = nextR;
      if (!isThisDeviceActive) {
        void sendRemoteCommand("SET_REPEAT", { repeat: nextR });
        return nextR;
      }
      if (!isLeaderRef.current && leaderTabIdRef.current && channelRef.current) {
        channelRef.current.postMessage({
          type: "COMMAND_CYCLE_REPEAT",
          fromTabId: getTabId(),
        });
      } else {
        broadcastLeaderState();
      }
      return nextR;
    });
  }, [broadcastLeaderState, getTabId, isThisDeviceActive, sendRemoteCommand]);

  const setPlaybackRate = useCallback(
    (rate: number) => {
      setPlaybackRateState(rate);
      playbackRateRef.current = rate;

      if (!isLeaderRef.current && leaderTabIdRef.current && channelRef.current) {
        channelRef.current.postMessage({
          type: "COMMAND_SET_RATE",
          fromTabId: getTabId(),
          rate,
        });
        return;
      }

      const audio = getSingletonAudio();
      if (audio) audio.playbackRate = rate;
      broadcastLeaderState();
    },
    [broadcastLeaderState, getTabId],
  );

  const getCurrentTime = useCallback(() => currentTimeRef.current, []);

  const refreshLyrics = useCallback(
    async (
      forceFetch = false,
      customQuery?: { queryTitle?: string; queryArtist?: string },
    ): Promise<LyricsRefreshResult> => {
      const curr = currentTrackRef.current;
      if (!curr) return { found: false, source: "none" };
      return loadLyricsForTrack(curr.id, forceFetch, customQuery);
    },
    [loadLyricsForTrack],
  );

  const setLyricsLines = useCallback(
    (lines: LyricLine[], source: string) => {
      lyricsRef.current = lines;
      lyricsSourceRef.current = source;
      setLyrics(lines);
      setLyricsSource(source);
      broadcastLeaderState();
    },
    [broadcastLeaderState],
  );

  const updateTrackInQueue = useCallback(
    (updated: Track) => {
      setCurrentTrack((prevTrack) => {
        const next = prevTrack?.id === updated.id ? updated : prevTrack;
        currentTrackRef.current = next;
        return next;
      });
      setQueue((prevQueue) => {
        const nextQ = prevQueue.map((t) => (t.id === updated.id ? updated : t));
        queueRef.current = nextQ;
        return nextQ;
      });
      broadcastLeaderState();
    },
    [broadcastLeaderState],
  );

  const adjustLyricsOffset = useCallback((deltaMs: number) => {
    setLyricsOffsetMs((prev) => prev + deltaMs);
    setLyrics((prevLines) => {
      const updated = prevLines.map((l) => ({
        ...l,
        timeMs: Math.max(0, l.timeMs + deltaMs),
      }));
      lyricsRef.current = updated;
      return updated;
    });
  }, []);

  const saveLyricsOffset = useCallback(
    async (targetOffsetMs?: number): Promise<boolean> => {
      const curr = currentTrackRef.current;
      if (!curr) return false;
      const finalOffset = targetOffsetMs ?? lyricsOffsetMs;
      try {
        const res = await api.updateLyricsOffset(curr.id, finalOffset);
        setLyricsOffsetMs(res.lyricsOffsetMs);
        setLyrics(res.lines);
        lyricsRef.current = res.lines;
        broadcastLeaderState();
        void updateDownloadedLyrics(curr.id, {
          lines: res.lines,
          source: lyricsSourceRef.current || "synced",
          lyricsOffsetMs: res.lyricsOffsetMs,
        }).catch(() => {});
        return true;
      } catch {
        return false;
      }
    },
    [broadcastLeaderState, lyricsOffsetMs],
  );

  const applyLyricsSource = useCallback(
    async (source: string, lrcContent: string): Promise<boolean> => {
      const curr = currentTrackRef.current;
      if (!curr) return false;
      try {
        const res = await api.applyLyricsSource(curr.id, source, lrcContent);
        setLyrics(res.lines);
        lyricsRef.current = res.lines;
        setLyricsSource(res.source);
        lyricsSourceRef.current = res.source;
        setLyricsOffsetMs(0);
        broadcastLeaderState();
        void updateDownloadedLyrics(curr.id, {
          lines: res.lines,
          source: res.source,
          lyricsOffsetMs: 0,
        }).catch(() => {});
        return true;
      } catch {
        return false;
      }
    },
    [broadcastLeaderState],
  );

  const handlersRef = useRef({
    playTrack,
    togglePlay,
    seek,
    next,
    prev,
    setVolume,
    toggleMute,
    toggleShuffle,
    cycleRepeat,
    setPlaybackRate,
  });

  useEffect(() => {
    handlersRef.current = {
      playTrack,
      togglePlay,
      seek,
      next,
      prev,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      setPlaybackRate,
    };
  });

  // Immediate state restoration on mount (so refreshed page has track, dock, and audio prepared immediately)
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem("soundify_player_state");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.track && !currentTrackRef.current) {
            currentTrackRef.current = parsed.track;
            setCurrentTrack(parsed.track);
            durationRef.current = parsed.track.durationSec || 0;
            setDuration(parsed.track.durationSec || 0);

            if (typeof parsed.currentTime === "number" && parsed.currentTime > 0) {
              currentTimeRef.current = parsed.currentTime;
              setCurrentTime(parsed.currentTime);
            }

            ensureAudioPrepared(parsed.track, parsed.currentTime);
            void loadLyricsForTrack(parsed.track.id, false);
            void getDownloadedCoverBlobUrl(parsed.track.id).then((coverBlobUrl) => {
              if (coverBlobUrl && currentTrackRef.current?.id === parsed.track.id) {
                const enrichedTrack = { ...parsed.track, coverUrl: coverBlobUrl };
                currentTrackRef.current = enrichedTrack;
                setCurrentTrack(enrichedTrack);
              }
            });
          }
          if (Array.isArray(parsed.queue) && queueRef.current.length === 0) {
            queueRef.current = parsed.queue;
            setQueue(parsed.queue);
          }
          if (typeof parsed.volume === "number") {
            volumeRef.current = parsed.volume;
            setVolumeState(parsed.volume);
          }
          if (parsed.repeat) {
            repeatRef.current = parsed.repeat;
            setRepeat(parsed.repeat);
          }
          if (typeof parsed.shuffle === "boolean") {
            shuffleRef.current = parsed.shuffle;
            setShuffle(parsed.shuffle);
          }
        }
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
  }, [ensureAudioPrepared, loadLyricsForTrack]);

  // Listen for account reset on logout / token wipe to prevent leftover playback state
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleAccountReset = () => {
      try {
        localStorage.removeItem("soundify_player_state");
      } catch {}
      localSessionStartedRef.current = false;
      const audio = getSingletonAudio();
      if (audio && !audio.paused) {
        audio.pause();
      }
      setIsPlaying(false);
      isPlayingRef.current = false;
    };

    window.addEventListener("soundify:account-reset", handleAccountReset);
    return () => {
      window.removeEventListener("soundify:account-reset", handleAccountReset);
    };
  }, []);

  // Spotify Connect Multi-Device Command Listener
  useEffect(() => {
    const unregister = registerCommandHandler((command, rawPayload) => {
      // 1. In a multi-tab browser session, follower tabs must yield command actuation to the Leader tab
      if (!isLeaderRef.current) {
        return;
      }

      const payloadObj = isRecord(rawPayload) ? rawPayload : {};
      const parsedCmd = parseRemoteCommand(command, payloadObj);
      if (!parsedCmd) {
        return;
      }

      const audio = getSingletonAudio();

      if (parsedCmd.type === "TRANSFER") {
        if (parsedCmd.targetDeviceId === deviceId) {
          localSessionStartedRef.current = true;
          const targetTrack = parsedCmd.state?.track || parsedCmd.track || currentTrackRef.current;
          const targetTrackId = parsedCmd.state?.trackId || parsedCmd.state?.track?.id || parsedCmd.trackId;
          const resumeTime = typeof parsedCmd.state?.currentTime === "number" ? parsedCmd.state.currentTime : 0;
          const shouldPlay = parsedCmd.state?.isPlaying ?? true;
          if (targetTrack) {
            playTrack(targetTrack, undefined, resumeTime, shouldPlay);
          } else if (targetTrackId) {
            const inQueue = queueRef.current.find((t) => t.id === targetTrackId);
            if (inQueue) {
              playTrack(inQueue, undefined, resumeTime, shouldPlay);
            } else {
              void api.getTrack(targetTrackId).then((res) => {
                if (res?.track) playTrack(res.track, undefined, resumeTime, shouldPlay);
              }).catch(() => {});
            }
          }
        } else {
          localSessionStartedRef.current = false;
          userPausedIntentRef.current = true;
          playRequestIdRef.current += 1;
          isSettingSourceRef.current = false;
          isRetryingPlayRef.current = false;
          clearPreservedPlaybackIntent();
          if (audio && !audio.paused) {
            audio.pause();
          }
          if (audioCtxRef.current?.state === "running") {
            void audioCtxRef.current.suspend().catch(() => {});
          }
          setIsPlaying(false);
          isPlayingRef.current = false;
        }
        return;
      }

      // 2. For all other actuation commands: if this device is NOT the active player (and was not targeted),
      // ignore the command locally so inactive remote controllers do not re-broadcast in an infinite ping-pong loop.
      const targetDeviceId = typeof payloadObj.targetDeviceId === "string" ? payloadObj.targetDeviceId : undefined;
      if (!isThisDeviceActiveRef.current && targetDeviceId !== deviceId) {
        return;
      }

      switch (parsedCmd.type) {
        case "PAUSE":
          userPausedIntentRef.current = true;
          playRequestIdRef.current += 1;
          isSettingSourceRef.current = false;
          isRetryingPlayRef.current = false;
          clearPreservedPlaybackIntent();
          if (audio && !audio.paused) {
            audio.pause();
          }
          setIsPlaying(false);
          isPlayingRef.current = false;
          break;
        case "PLAY":
          userPausedIntentRef.current = false;
          if (audio && audio.paused) {
            audio.play().catch(() => {});
            setIsPlaying(true);
            isPlayingRef.current = true;
          }
          break;
        case "TOGGLE_PLAY":
          togglePlay();
          break;
        case "SEEK":
          seek(parsedCmd.seconds);
          break;
        case "NEXT":
          next(Boolean(parsedCmd.auto));
          break;
        case "PREV":
          prev();
          break;
        case "SET_VOLUME":
          setVolume(parsedCmd.volume);
          break;
        case "SET_REPEAT":
          setRepeat(parsedCmd.repeat as RepeatMode);
          repeatRef.current = parsedCmd.repeat as RepeatMode;
          break;
        case "SET_SHUFFLE":
          setShuffle(parsedCmd.shuffle);
          shuffleRef.current = parsedCmd.shuffle;
          break;
        case "PLAY_TRACK":
          if (parsedCmd.track) {
            playTrack(parsedCmd.track, parsedCmd.queue, 0, true);
          } else if (parsedCmd.trackId) {
            if (currentTrackRef.current?.id === parsedCmd.trackId) {
              if (audio && audio.paused) {
                audio.play().catch(() => {});
                setIsPlaying(true);
                isPlayingRef.current = true;
              }
            } else {
              const inQueue = queueRef.current.find((t) => t.id === parsedCmd.trackId);
              if (inQueue) {
                playTrack(inQueue, undefined, 0, true);
              } else {
                void api.getTrack(parsedCmd.trackId).then((res) => {
                  if (res?.track) playTrack(res.track, undefined, 0, true);
                }).catch(() => {});
              }
            }
          }
          break;
        default:
          assertNever(parsedCmd);
      }
    });

    return unregister;
  }, [registerCommandHandler, deviceId, playTrack, togglePlay, seek, next, prev, setVolume]);

  // Sync state from remote active device into local UI with timestamp-based drift compensation
  useEffect(() => {
    if (!isSyncEnabled || isThisDeviceActive || !syncState?.track) return;
    const audio = getSingletonAudio();
    if (audio && !audio.paused) return;
    if (syncState.activeDeviceId && activeDeviceId && syncState.activeDeviceId !== activeDeviceId) {
      return;
    }
    if (currentTrackRef.current?.id !== syncState.track.id) {
      const normalizedTrack = normalizeTrack(syncState.track);
      currentTrackRef.current = normalizedTrack;
      setCurrentTrack(normalizedTrack);
      setDuration(syncState.duration || normalizedTrack.durationSec || 0);
      durationRef.current = syncState.duration || normalizedTrack.durationSec || 0;
      void loadLyricsForTrack(normalizedTrack.id, false);

      // Immediately propagate updated remote metadata to native Android Notification shade & lockscreen
      const resolvedCover = resolveMediaUrl(normalizedTrack.coverUrl);
      let artworkSrc = "";
      try {
        artworkSrc = resolvedCover ? new URL(resolvedCover, window.location.origin).toString() : "";
      } catch {
        artworkSrc = resolvedCover || "";
      }
      void updateAndroidMediaMetadata({
        title: normalizedTrack.title,
        artist: normalizedTrack.artistName,
        album: normalizedTrack.album,
        coverUrl: artworkSrc,
        duration: syncState.duration || normalizedTrack.durationSec || 0,
        trackId: normalizedTrack.id,
      });
      void updateAndroidPlaybackState({
        isPlaying: syncState.isPlaying,
        position: syncState.currentTime,
        duration: syncState.duration || normalizedTrack.durationSec || 0,
        playbackRate: 1,
      });
    }
    if (isPlayingRef.current !== syncState.isPlaying && Date.now() >= remotePlayStateLockUntilRef.current) {
      isPlayingRef.current = syncState.isPlaying;
      setIsPlaying(syncState.isPlaying);
      void updateAndroidPlaybackState({
        isPlaying: syncState.isPlaying,
        position: syncState.currentTime,
        duration: durationRef.current || syncState.duration || 0,
        playbackRate: 1,
      });
    }

    // Timestamp-based drift compensation: compute elapsed seconds since server timestamp
    const elapsedSec = syncState.isPlaying && syncState.updatedAt
      ? Math.max(0, (Date.now() - syncState.updatedAt) / 1000)
      : 0;
    const maxDur = durationRef.current || syncState.duration || Infinity;
    const compensatedTime = Math.min(maxDur, syncState.currentTime + elapsedSec);

    if (Math.abs(currentTimeRef.current - compensatedTime) > 1.2) {
      currentTimeRef.current = compensatedTime;
      setCurrentTime(compensatedTime);
    }
    if (syncState.repeat && repeatRef.current !== syncState.repeat) {
      repeatRef.current = syncState.repeat;
      setRepeat(syncState.repeat);
    }
    if (typeof syncState.shuffle === "boolean" && shuffleRef.current !== syncState.shuffle) {
      shuffleRef.current = syncState.shuffle;
      setShuffle(syncState.shuffle);
    }
    if (typeof syncState.volume === "number" && Math.abs(volumeRef.current - syncState.volume) > 0.05) {
      volumeRef.current = syncState.volume;
      setVolumeState(syncState.volume);
    }
  }, [activeDeviceId, isThisDeviceActive, isSyncEnabled, syncState, loadLyricsForTrack]);

  // Smooth local ticker when listening to remote playback (battery-aware: pauses UI updates when hidden)
  useEffect(() => {
    if (isThisDeviceActive || localSessionStartedRef.current || !isPlaying) return;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setCurrentTime((prev) => {
        const nextTime = prev + 0.25;
        const maxDur = durationRef.current || 0;
        const clamped = maxDur > 0 ? Math.min(maxDur, nextTime) : nextTime;
        currentTimeRef.current = clamped;
        return clamped;
      });
    }, 250);
    return () => clearInterval(interval);
  }, [isThisDeviceActive, isPlaying]);

  // Cross-tab coordination via BroadcastChannel
  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
    const myTabId = getTabId();
    const channel = new BroadcastChannel("soundify-audio-sync");
    channelRef.current = channel;

    // Send query to see if there is an existing leader
    channel.postMessage({ type: "QUERY_LEADER", fromTabId: myTabId });

    // Election timer: if no leader responds in 220ms, this tab claims leadership and restores state
    const electionTimeout = setTimeout(() => {
      if (!leaderTabIdRef.current) {
        isLeaderRef.current = true;
        leaderTabIdRef.current = myTabId;
        const curr = currentTrackRef.current;
        if (curr) {
          ensureAudioPrepared(curr);
        }
      }
    }, 220);

    const onMessage = (event: MessageEvent<SyncMessage>) => {
      const msg = event.data;
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "QUERY_LEADER") {
        if (isLeaderRef.current) {
          channel.postMessage({
            type: "LEADER_ANNOUNCE",
            leaderTabId: myTabId,
            track: currentTrackRef.current,
            queue: queueRef.current,
            isPlaying: isPlayingRef.current,
            currentTime: currentTimeRef.current,
            duration: durationRef.current,
            volume: volumeRef.current,
            muted: mutedRef.current,
            repeat: repeatRef.current,
            shuffle: shuffleRef.current,
            playbackRate: playbackRateRef.current,
            lyrics: lyricsRef.current,
            lyricsSource: lyricsSourceRef.current,
          });
        }
        return;
      }

      if (msg.type === "LEADER_ANNOUNCE" || msg.type === "LEADER_STATE_CHANGE") {
        if (msg.leaderTabId !== myTabId) {
          clearTimeout(electionTimeout);
          isLeaderRef.current = false;
          leaderTabIdRef.current = msg.leaderTabId;

          currentTrackRef.current = msg.track;
          setCurrentTrack(msg.track);

          queueRef.current = msg.queue;
          setQueue(msg.queue);

          isPlayingRef.current = msg.isPlaying;
          setIsPlaying(msg.isPlaying);

          currentTimeRef.current = msg.currentTime;
          setCurrentTime(msg.currentTime);

          durationRef.current = msg.duration;
          setDuration(msg.duration);

          volumeRef.current = msg.volume;
          setVolumeState(msg.volume);

          mutedRef.current = msg.muted;
          setMuted(msg.muted);

          repeatRef.current = msg.repeat;
          setRepeat(msg.repeat);

          shuffleRef.current = msg.shuffle;
          setShuffle(msg.shuffle);

          playbackRateRef.current = msg.playbackRate;
          setPlaybackRateState(msg.playbackRate);

          if (msg.lyrics) {
            lyricsRef.current = msg.lyrics;
            setLyrics(msg.lyrics);
            lyricsSourceRef.current = msg.lyricsSource;
            setLyricsSource(msg.lyricsSource);
          }

          // Ensure secondary tab does not output physical sound
          const audio = getSingletonAudio();
          if (audio && !audio.paused) {
            audio.pause();
          }
        }
        return;
      }

      if (msg.type === "TIME_SYNC") {
        if (!isLeaderRef.current && msg.leaderTabId === leaderTabIdRef.current) {
          currentTimeRef.current = msg.currentTime;
          setCurrentTime(msg.currentTime);
          if (msg.duration > 0 && msg.duration !== durationRef.current) {
            durationRef.current = msg.duration;
            setDuration(msg.duration);
          }
          if (isPlayingRef.current !== msg.isPlaying) {
            isPlayingRef.current = msg.isPlaying;
            setIsPlaying(msg.isPlaying);
          }
        }
        return;
      }

      if (isLeaderRef.current) {
        if (msg.type === "COMMAND_PLAY_TRACK") {
          handlersRef.current.playTrack(msg.track, msg.newQueue);
          return;
        }
        if (msg.type === "COMMAND_TOGGLE_PLAY") {
          handlersRef.current.togglePlay();
          return;
        }
        if (msg.type === "COMMAND_SEEK") {
          handlersRef.current.seek(msg.seconds);
          return;
        }
        if (msg.type === "COMMAND_NEXT") {
          handlersRef.current.next(msg.fromEnded);
          return;
        }
        if (msg.type === "COMMAND_PREV") {
          handlersRef.current.prev();
          return;
        }
        if (msg.type === "COMMAND_SET_VOLUME") {
          handlersRef.current.setVolume(msg.volume);
          return;
        }
        if (msg.type === "COMMAND_TOGGLE_MUTE") {
          handlersRef.current.toggleMute();
          return;
        }
        if (msg.type === "COMMAND_TOGGLE_SHUFFLE") {
          handlersRef.current.toggleShuffle();
          return;
        }
        if (msg.type === "COMMAND_CYCLE_REPEAT") {
          handlersRef.current.cycleRepeat();
          return;
        }
        if (msg.type === "COMMAND_SET_RATE") {
          handlersRef.current.setPlaybackRate(msg.rate);
          return;
        }
      }

      if (msg.type === "LEADER_LEAVING") {
        if (!isLeaderRef.current && msg.leaderTabId === leaderTabIdRef.current) {
          // Stagger claim among secondary tabs based on deterministic tab priority
          let hash = 0;
          for (let i = 0; i < myTabId.length; i++) {
            hash = (hash * 31 + myTabId.charCodeAt(i)) & 0xffffffff;
          }
          const delay = Math.abs(hash % 70);

          setTimeout(() => {
            // If another tab already claimed leadership during the delay, defer
            if (leaderTabIdRef.current && leaderTabIdRef.current !== msg.leaderTabId && leaderTabIdRef.current !== myTabId) {
              return;
            }
            isLeaderRef.current = true;
            leaderTabIdRef.current = myTabId;
            channel.postMessage({ type: "CLAIM_LEADERSHIP", newLeaderTabId: myTabId });
            const audio = getSingletonAudio();
            if (audio && msg.track) {
              audio.src = resolveMediaUrl(msg.track.audioUrl);
              audio.currentTime = msg.currentTime;
              audio.volume = mutedRef.current ? 0 : volumeRef.current;
              audio.playbackRate = playbackRateRef.current;
              if (msg.isPlaying) {
                audio.play().catch(() => {
                  setIsPlaying(false);
                  isPlayingRef.current = false;
                });
              }
            }
          }, delay);
        }
        return;
      }

      if (msg.type === "CLAIM_LEADERSHIP") {
        if (msg.newLeaderTabId !== myTabId) {
          isLeaderRef.current = false;
          leaderTabIdRef.current = msg.newLeaderTabId;
          const audio = getSingletonAudio();
          if (audio && !audio.paused) {
            audio.pause();
          }
        }
        return;
      }
    };

    channel.addEventListener("message", onMessage);

    const onBeforeUnload = () => {
      if (isLeaderRef.current) {
        channel.postMessage({
          type: "LEADER_LEAVING",
          leaderTabId: myTabId,
          track: currentTrackRef.current,
          queue: queueRef.current,
          currentTime: currentTimeRef.current,
          isPlaying: isPlayingRef.current,
        });
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      clearTimeout(electionTimeout);
      window.removeEventListener("beforeunload", onBeforeUnload);
      channel.removeEventListener("message", onMessage);
      channel.close();
      channelRef.current = null;
    };
  }, [ensureAudioPrepared, getTabId]);

  // Setup persistent singleton <audio> element events
  useEffect(() => {
    const audio = getSingletonAudio();
    if (!audio) return;
    if (document.body && !document.body.contains(audio)) {
      document.body.appendChild(audio);
    }

    const onPlay = () => {
      if (audioCtxRef.current?.state === "suspended") {
        void audioCtxRef.current.resume().catch(() => {});
      }
      localSessionStartedRef.current = true;
      if ((!isThisDeviceActiveRef.current || activeDeviceIdRef.current !== deviceId) && currentTrackRef.current) {
        isThisDeviceActiveRef.current = true;
        void claimThisDevice({
          track: currentTrackRef.current,
          trackId: currentTrackRef.current.id,
          isPlaying: true,
          currentTime: audio.currentTime,
          duration: audio.duration || durationRef.current || currentTrackRef.current.durationSec || 0,
          volume: volumeRef.current,
          repeat: repeatRef.current,
          shuffle: shuffleRef.current,
        });
      }
      setIsPlaying(true);
      isPlayingRef.current = true;
      broadcastLeaderState();
      broadcastCurrentState();
      void updateAndroidPlaybackState({
        isPlaying: true,
        position: audio.currentTime,
        duration: audio.duration || durationRef.current || 0,
        playbackRate: audio.playbackRate || 1,
      });
    };
    const onPlaying = () => {
      isSettingSourceRef.current = false;
      isRetryingPlayRef.current = false;
      if (stallProbeTimerRef.current) {
        clearTimeout(stallProbeTimerRef.current);
        stallProbeTimerRef.current = null;
      }
      reportNetworkSuccess();
      setOfflineNotice(null);
      if (!isPlayingRef.current) {
        setIsPlaying(true);
        isPlayingRef.current = true;
      }
    };
    const onStalledOrWaiting = () => {
      // Keep UI in playing/buffering state during VPN/mobile network stalls instead of auto-pausing
      const curr = currentTrackRef.current;
      if (curr && !userPausedIntentRef.current && isPlayingRef.current) {
        preservePlaybackIntent(curr.id, audio.currentTime || currentTimeRef.current, true);
        if (!stallProbeTimerRef.current) {
          stallProbeTimerRef.current = setTimeout(() => {
            stallProbeTimerRef.current = null;
            if (!userPausedIntentRef.current && isPlayingRef.current && audio.readyState < 3) {
              void triggerImmediateNetworkProbe();
            }
          }, 3500);
        }
      }
    };
    const onPause = () => {
      // Ignore synthetic pause events fired by the browser during audio.src swaps or active retries
      if (isSettingSourceRef.current || isRetryingPlayRef.current) {
        return;
      }
      // Battery optimization: suspend WebAudio DSP thread immediately when paused
      if (audioCtxRef.current?.state === "running") {
        void audioCtxRef.current.suspend().catch(() => {});
      }
      setIsPlaying(false);
      isPlayingRef.current = false;
      const playbackPos = audio.currentTime;
      currentTimeRef.current = playbackPos;
      setCurrentTime(playbackPos);
      savePlayerState(playbackPos);
      broadcastLeaderState();
      broadcastCurrentState();
      void updateAndroidPlaybackState({
        isPlaying: false,
        position: playbackPos,
        duration: audio.duration || durationRef.current || 0,
        playbackRate: audio.playbackRate || 1,
      });
    };
    let lastTimeUpdate = 0;
    const onTimeUpdate = () => {
      const playbackPos = audio.currentTime;
      currentTimeRef.current = playbackPos;
      const now = performance.now();

      // Battery optimization: skip React UI re-renders 4x/sec while app is in background / screen locked
      if (typeof document === "undefined" || !document.hidden) {
        // Throttle React state updates to at most once every 250ms
        if (now - lastTimeUpdate >= 250) {
          lastTimeUpdate = now;
          setCurrentTime(playbackPos);
        }
      }

      // Throttle localStorage updates to at most once every 5 seconds
      if (Math.abs(playbackPos - lastSavedStateTimeRef.current) >= 5) {
        lastSavedStateTimeRef.current = playbackPos;
        savePlayerState(playbackPos);
      }

      // Periodic Spotify Connect state broadcast (every 4 seconds while active to reduce battery wakeups)
      if (isThisDeviceActiveRef.current && isPlayingRef.current && currentTrackRef.current) {
        if (now - lastBroadcastTimeRef.current >= 4000) {
          lastBroadcastTimeRef.current = now;
          broadcastCurrentState();
        }
      }

      if (isLeaderRef.current && channelRef.current) {
        if (now - lastTimeSyncSentRef.current > 250) {
          lastTimeSyncSentRef.current = now;
          channelRef.current.postMessage({
            type: "TIME_SYNC",
            leaderTabId: getTabId(),
            currentTime: playbackPos,
            duration: audio.duration || durationRef.current,
            isPlaying: !audio.paused,
          });
        }
      }

      const curr = currentTrackRef.current;
      if (curr && playbackPos >= 3 && recordedPlayForIdRef.current !== curr.id) {
        recordedPlayForIdRef.current = curr.id;
        void api
          .recordPlay(curr.id)
          .then((res) => {
            setCurrentTrack((prevTrack) =>
              prevTrack?.id === curr.id ? { ...prevTrack, playsCount: res.playsCount } : prevTrack,
            );
          })
          .catch(() => {});
      }

      // Proactive pre-buffering of the upcoming track in the queue once current track is playing comfortably (>12s)
      if (curr && playbackPos >= 12 && isPlayingRef.current) {
        const q = queueRef.current;
        if (q.length > 1) {
          const curIdx = q.findIndex((item) => item.id === curr.id);
          if (curIdx >= 0 && curIdx < q.length - 1) {
            void prebufferTrack(q[curIdx + 1]);
          } else if (repeatRef.current === "all" && q.length > 0) {
            void prebufferTrack(q[0]);
          }
        }
      }
    };
    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        durationRef.current = audio.duration;
        setDuration(audio.duration);
        broadcastLeaderState();
      }
    };

    const onError = async () => {
      if (isRetryingPlayRef.current) {
        // Retry engine is actively handling transient network/VPN hiccups
        return;
      }
      const curr = currentTrackRef.current;
      if (!curr) {
        setIsPlaying(false);
        isPlayingRef.current = false;
        broadcastLeaderState();
        return;
      }
      if (!userPausedIntentRef.current) {
        preservePlaybackIntent(curr.id, audio.currentTime || currentTimeRef.current, true);
      }

      // Proactive offline fallback: If this track is downloaded locally, switch audio.src immediately
      let isDownloaded = getTrackDownloadSnapshot(curr.id).status === "downloaded";
      if (!isDownloaded) {
        isDownloaded = await isTrackDownloaded(curr.id);
      }

      if (isDownloaded) {
        try {
          const blobUrl = await getDownloadedTrackBlobUrl(curr.id);
          if (blobUrl && audio.src !== blobUrl) {
            const resumePos = currentTimeRef.current || 0;
            audio.src = blobUrl;
            if (resumePos > 0) {
              const onMeta = () => {
                try {
                  audio.currentTime = resumePos;
                } catch {}
                audio.removeEventListener("loadedmetadata", onMeta);
              };
              audio.addEventListener("loadedmetadata", onMeta);
            }
            await audio.play();
            setIsPlaying(true);
            isPlayingRef.current = true;
            broadcastLeaderState();
            broadcastCurrentState();
            return;
          }
        } catch {
          // If fallback fails, proceed to standard offline handling
        }
      }

      if (checkIsOffline()) {
        const isVpnOrServerIssue = typeof navigator !== "undefined" && navigator.onLine && getServerConnectivityStatus() !== "online";
        if (isVpnOrServerIssue) {
          setServerConnectivityStatus("vpn_or_server_down");
          setOfflineNotice(
            lang === "fa"
              ? "عدم برقراری ارتباط با سرور - اتصال اینترنت یا وضعیت فیلترشکن خود را بررسی کنید"
              : "Cannot connect to server - check internet connection or VPN status",
          );
        } else if (!isDownloaded) {
          setOfflineNotice(
            t
              ? t("offlinePlaybackNotice")
              : "برای پخش این قطعه در حالت آفلاین باید قبلاً آن را دانلود کرده باشید",
          );
        }
        setIsPlaying(false);
        isPlayingRef.current = false;
        broadcastLeaderState();
        return;
      }

      const isExternal =
        curr.id.startsWith("ext-") ||
        curr.source === "youtube" ||
        curr.source === "soundcloud" ||
        curr.source === "spotify" ||
        (typeof curr.audioUrl === "string" &&
          (curr.audioUrl.includes("/api/stream/external") ||
            curr.audioUrl.includes("/api/external/stream") ||
            curr.audioUrl.includes("googlevideo.com") ||
            curr.audioUrl.includes("youtube.com")));

      if (isExternal) {
        const attempts = refreshAttemptsRef.current[curr.id] || 0;
        if (attempts < 2) {
          refreshAttemptsRef.current[curr.id] = attempts + 1;
          const resumeTime = currentTimeRef.current;
          const canonical = extractCanonicalExternalUrl(curr.pageUrl || curr.audioUrl, curr.id);

          api
            .refreshStreamUrl(curr.id, canonical)
            .then(async (res) => {
              if (res.ok && (res.audioUrl || res.streamUrl)) {
                const refreshedTrack: Track = {
                  ...curr,
                  audioUrl: res.audioUrl
                    ? `${res.audioUrl}${res.audioUrl.includes("?") ? "&" : "?"}_t=${Date.now()}`
                    : res.streamUrl,
                  pageUrl: res.canonicalUrl || curr.pageUrl || canonical,
                };
                currentTrackRef.current = refreshedTrack;
                setCurrentTrack(refreshedTrack);
                updateTrackInQueue(refreshedTrack);
                externalTracksCache.set(refreshedTrack.id, refreshedTrack);

                const finalSource = resolveMediaUrl(refreshedTrack.audioUrl);
                isSettingSourceRef.current = true;
                audio.src = finalSource;
                try {
                  audio.load();
                } catch {}

                if (resumeTime > 0) {
                  const onMeta = () => {
                    try {
                      audio.currentTime = resumeTime;
                    } catch {}
                    audio.removeEventListener("loadedmetadata", onMeta);
                  };
                  audio.addEventListener("loadedmetadata", onMeta);
                }

                try {
                  await audio.play();
                  isSettingSourceRef.current = false;
                  setIsPlaying(true);
                  isPlayingRef.current = true;
                  broadcastLeaderState();
                  broadcastCurrentState();
                  setOfflineNotice(null);
                  return;
                } catch {
                  // Fallback: direct streamUrl if proxy fails and direct is different
                  if (res.streamUrl && res.audioUrl && finalSource !== res.streamUrl) {
                    try {
                      isSettingSourceRef.current = true;
                      audio.src = res.streamUrl;
                      try { audio.load(); } catch {}
                      await audio.play();
                      isSettingSourceRef.current = false;
                      setIsPlaying(true);
                      isPlayingRef.current = true;
                      broadcastLeaderState();
                      broadcastCurrentState();
                      setOfflineNotice(null);
                      return;
                    } catch {}
                  }
                  isSettingSourceRef.current = false;
                  setIsPlaying(false);
                  isPlayingRef.current = false;
                  broadcastLeaderState();
                }
              } else {
                setIsPlaying(false);
                isPlayingRef.current = false;
                broadcastLeaderState();
              }
            })
            .catch(() => {
              setIsPlaying(false);
              isPlayingRef.current = false;
              broadcastLeaderState();
            });
          return;
        }
      }

      setIsPlaying(false);
      isPlayingRef.current = false;
      broadcastLeaderState();
      notifyServerConnectivityIssue();
      setOfflineNotice(
        lang === "fa"
          ? "خطا در بارگذاری استریم صوتی آنلاین (یوتیوب / ساندکلود / اسپاتیفای) - لطفاً مجدداً تلاش نمایید"
          : "Error loading online audio stream (YouTube / SoundCloud / Spotify) - please retry",
      );
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onStalledOrWaiting);
    audio.addEventListener("stalled", onStalledOrWaiting);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("error", onError);

    return () => {
      // NOTE: Do not call audio.pause() here so soft client-side navigation
      // never stops playback!
      if (stallProbeTimerRef.current) {
        clearTimeout(stallProbeTimerRef.current);
        stallProbeTimerRef.current = null;
      }
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("waiting", onStalledOrWaiting);
      audio.removeEventListener("stalled", onStalledOrWaiting);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("error", onError);
    };
  }, [broadcastCurrentState, broadcastLeaderState, claimThisDevice, deviceId, getTabId, lang, notifyServerConnectivityIssue, savePlayerState, t, updateTrackInQueue]);

  // Intelligent Network Resilience subscription:
  // Keeps offline UI synced and automatically resumes interrupted playback when VPN/network returns.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const unsubscribe = subscribeNetworkResilience((event) => {
      setIsOffline(!event.isOnline);
      if (!event.isOnline) return;

      setOfflineNotice(null);
      if (!event.recovered) return;

      const intent = getPreservedPlaybackIntent();
      const audio = getSingletonAudio();
      const curr = currentTrackRef.current;
      if (
        !intent ||
        !intent.intendedPlaying ||
        userPausedIntentRef.current ||
        !audio ||
        !curr ||
        curr.id !== intent.trackId ||
        !audio.paused ||
        isRetryingPlayRef.current
      ) {
        return;
      }

      const isDownloaded = getTrackDownloadSnapshot(curr.id).status === "downloaded";
      const targetUrl = resolveMediaUrl(curr.audioUrl);
      if (targetUrl && !targetUrl.startsWith("blob:")) {
        const cleanedTarget = targetUrl.replace(/([?&])_rt=\d+/g, "$1").replace(/[?&]$/, "").replace(/\?&/, "?");
        const sep = cleanedTarget.includes("?") ? "&" : "?";
        const freshUrl = `${cleanedTarget}${sep}_rt=${Date.now()}`;
        isSettingSourceRef.current = true;
        audio.src = freshUrl;
        try {
          audio.load();
        } catch {}
        if (intent.currentTime > 0) {
          const onMeta = () => {
            try {
              audio.currentTime = intent.currentTime;
            } catch {}
            audio.removeEventListener("loadedmetadata", onMeta);
          };
          audio.addEventListener("loadedmetadata", onMeta);
        }
      }
      void attemptPlayWithRetry(audio, curr, isDownloaded, targetUrl, intent.currentTime);
    });
    return unsubscribe;
  }, [attemptPlayWithRetry]);

  // Track ended handler bound to latest `next`
  useEffect(() => {
    const audio = getSingletonAudio();
    if (!audio) return;
    const onEnded = () => next(true);
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [next]);

  // Native Android Media Service & Lockscreen Controls & Web MediaSession
  const mediaActionsRef = useRef({
    togglePlay,
    next,
    prev,
    seek,
    broadcastLeaderState,
    broadcastCurrentState,
  });
  useEffect(() => {
    mediaActionsRef.current = {
      togglePlay,
      next,
      prev,
      seek,
      broadcastLeaderState,
      broadcastCurrentState,
    };
  });

  useEffect(() => {
    const cleanup = initAndroidMediaSession({
      onPlay: () => {
        if (shouldActAsRemoteControllerRef.current()) {
          remotePlayStateLockUntilRef.current = Date.now() + 2500;
          setIsPlaying(true);
          isPlayingRef.current = true;
          void sendRemoteCommandRef.current("PLAY");
          void updateAndroidPlaybackState({
            isPlaying: true,
            position: currentTimeRef.current,
            duration: durationRef.current,
          });
          return;
        }
        const audio = getSingletonAudio();
        // Never call togglePlay() if playback is already active or retrying/buffering,
        // otherwise togglePlay() would enter its pause branch and kill playback.
        if (audio && audio.paused && !isPlayingRef.current && !isRetryingPlayRef.current) {
          void (handlersRef.current?.togglePlay?.() ?? mediaActionsRef.current.togglePlay());
        }
      },
      onPause: () => {
        if (shouldActAsRemoteControllerRef.current()) {
          remotePlayStateLockUntilRef.current = Date.now() + 2500;
          setIsPlaying(false);
          isPlayingRef.current = false;
          void sendRemoteCommandRef.current("PAUSE");
          void updateAndroidPlaybackState({
            isPlaying: false,
            position: currentTimeRef.current,
            duration: durationRef.current,
          });
          return;
        }
        const audio = getSingletonAudio();
        userPausedIntentRef.current = true;
        playRequestIdRef.current += 1;
        isSettingSourceRef.current = false;
        isRetryingPlayRef.current = false;
        clearPreservedPlaybackIntent();
        if (audio && !audio.paused) {
          audio.pause();
        }
        setIsPlaying(false);
        isPlayingRef.current = false;
        mediaActionsRef.current.broadcastLeaderState();
        mediaActionsRef.current.broadcastCurrentState();
      },
      onTogglePlay: () => {
        if (shouldActAsRemoteControllerRef.current()) {
          const nextState = !isPlayingRef.current;
          remotePlayStateLockUntilRef.current = Date.now() + 2500;
          setIsPlaying(nextState);
          isPlayingRef.current = nextState;
          void sendRemoteCommandRef.current(nextState ? "PLAY" : "PAUSE");
          void updateAndroidPlaybackState({
            isPlaying: nextState,
            position: currentTimeRef.current,
            duration: durationRef.current,
          });
          return;
        }
        void (handlersRef.current?.togglePlay?.() ?? mediaActionsRef.current.togglePlay());
      },
      onNext: () => {
        if (shouldActAsRemoteControllerRef.current()) {
          void sendRemoteCommandRef.current("NEXT");
          return;
        }
        if (handlersRef.current?.next) {
          handlersRef.current.next(false);
        } else {
          mediaActionsRef.current.next(false);
        }
      },
      onPrev: () => {
        if (shouldActAsRemoteControllerRef.current()) {
          void sendRemoteCommandRef.current("PREV");
          return;
        }
        if (handlersRef.current?.prev) {
          handlersRef.current.prev();
        } else {
          mediaActionsRef.current.prev();
        }
      },
      onSeek: (seconds) => {
        if (shouldActAsRemoteControllerRef.current()) {
          currentTimeRef.current = seconds;
          setCurrentTime(seconds);
          void sendRemoteCommandRef.current("SEEK", { seconds });
          return;
        }
        if (handlersRef.current?.seek) {
          handlersRef.current.seek(seconds);
        } else {
          mediaActionsRef.current.seek(seconds);
        }
      },
      onStop: () => {
        const audio = getSingletonAudio();
        userPausedIntentRef.current = true;
        playRequestIdRef.current += 1;
        isSettingSourceRef.current = false;
        isRetryingPlayRef.current = false;
        clearPreservedPlaybackIntent();
        if (audio && !audio.paused) {
          audio.pause();
        }
        setIsPlaying(false);
        isPlayingRef.current = false;
        mediaActionsRef.current.broadcastLeaderState();
        mediaActionsRef.current.broadcastCurrentState();
      },
      onBecomingNoisy: () => {
        const audio = getSingletonAudio();
        userPausedIntentRef.current = true;
        playRequestIdRef.current += 1;
        isSettingSourceRef.current = false;
        isRetryingPlayRef.current = false;
        clearPreservedPlaybackIntent();
        if (audio && !audio.paused) {
          audio.pause();
        }
        setIsPlaying(false);
        isPlayingRef.current = false;
        mediaActionsRef.current.broadcastLeaderState();
        mediaActionsRef.current.broadcastCurrentState();
      },
      onVolumeDuck: (duck) => {
        const audio = getSingletonAudio();
        if (audio) {
          if (duck) {
            audio.volume = Math.max(0, volumeRef.current * 0.25);
          } else {
            audio.volume = mutedRef.current ? 0 : volumeRef.current;
          }
        }
      },
    });

    return () => {
      cleanup();
    };
  }, []);

  // Synchronize Metadata whenever currentTrack changes
  useEffect(() => {
    if (!currentTrack) return;
    const resolvedCover = resolveMediaUrl(currentTrack.coverUrl);
    let artworkSrc = "";
    try {
      artworkSrc = resolvedCover ? new URL(resolvedCover, window.location.origin).toString() : "";
    } catch {
      artworkSrc = resolvedCover || "";
    }

    void updateAndroidMediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artistName,
      album: currentTrack.album,
      coverUrl: artworkSrc,
      duration: currentTrack.durationSec || duration,
      trackId: currentTrack.id,
    });
  }, [currentTrack, duration]);

  // Synchronize Playback State whenever isPlaying, duration, or playbackRate changes
  useEffect(() => {
    const audio = getSingletonAudio();
    const pos = audio ? audio.currentTime : currentTimeRef.current;
    void updateAndroidPlaybackState({
      isPlaying,
      position: pos,
      duration,
      playbackRate,
    });
  }, [isPlaying, duration, playbackRate]);

  const activeLyricIndex = useMemo(
    () => findActiveLyricIndex(lyrics, currentTime * 1000 - lyricsOffsetMs),
    [lyrics, currentTime, lyricsOffsetMs],
  );

  const playerValue = useMemo<PlayerContextValue>(
    () => ({
      currentTrack: effectiveCurrentTrack,
      queue: effectiveQueue,
      isPlaying,
      duration,
      volume,
      muted,
      shuffle,
      repeat,
      playbackRate,
      expanded,
      queueOpen,
      visualizerEnabled,
      lyrics,
      lyricsSource,
      lyricsLoading,
      analyserNode: analyserState,
      getCurrentTime,
      playTrack,
      togglePlay,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      setPlaybackRate,
      setExpanded,
      setQueueOpen,
      setVisualizerEnabled,
      refreshLyrics,
      setLyricsLines,
      updateTrackInQueue,
      lyricsOffsetMs,
      adjustLyricsOffset,
      saveLyricsOffset,
      applyLyricsSource,
      offlineNotice,
      dismissOfflineNotice,
      isOffline,
      isCurrentTrackOffline: Boolean(
        downloadVersion >= 0 &&
          effectiveCurrentTrack &&
          (getTrackDownloadSnapshot(effectiveCurrentTrack.id).status === "downloaded" ||
            getCachedAudioBlobUrl(effectiveCurrentTrack.id) !== null),
      ),
    }),
    [
      effectiveCurrentTrack,
      effectiveQueue,
      isPlaying,
      duration,
      volume,
      muted,
      shuffle,
      repeat,
      playbackRate,
      expanded,
      queueOpen,
      visualizerEnabled,
      lyrics,
      lyricsSource,
      lyricsLoading,
      lyricsOffsetMs,
      analyserState,
      getCurrentTime,
      playTrack,
      togglePlay,
      next,
      prev,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      setPlaybackRate,
      refreshLyrics,
      setLyricsLines,
      updateTrackInQueue,
      adjustLyricsOffset,
      saveLyricsOffset,
      applyLyricsSource,
      offlineNotice,
      dismissOfflineNotice,
      isOffline,
      downloadVersion,
    ],
  );

  const progressValue = useMemo<PlayerProgressContextValue>(
    () => ({
      currentTime,
      duration,
      activeLyricIndex,
    }),
    [currentTime, duration, activeLyricIndex],
  );

  return (
    <PlayerContext.Provider value={playerValue}>
      <PlayerProgressContext.Provider value={progressValue}>
        {children}
        {offlineNotice && (
          <aside
            role="alert"
            aria-live="assertive"
            style={{
              top: "calc(env(safe-area-inset-top, 0px) + 64px)",
            }}
            className="fixed inset-x-3.5 sm:inset-x-auto sm:start-1/2 sm:-translate-x-1/2 max-w-md w-[calc(100%-28px)] sm:w-auto z-[9999] pointer-events-auto transition-all duration-300 ease-out animate-in fade-in slide-in-from-top-4"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-[22px] bg-black/85 dark:bg-[#12141c]/95 text-white font-medium text-xs sm:text-[13px] shadow-[0_16px_40px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-3xl border border-white/[0.18] ring-1 ring-white/5">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <WarningCircleIcon size={20} weight="fill" className="shrink-0 text-amber-400" aria-hidden="true" />
                <span className="leading-snug text-start font-medium">{offlineNotice}</span>
              </div>
              <button
                type="button"
                onClick={dismissOfflineNotice}
                className="h-7 w-7 min-h-[28px] min-w-[28px] rounded-full bg-white/10 hover:bg-white/20 active:scale-90 flex items-center justify-center transition-all cursor-pointer text-white/70 hover:text-white shrink-0"
                aria-label="بستن"
              >
                <XIcon size={14} weight="bold" aria-hidden="true" />
              </button>
            </div>
          </aside>
        )}
      </PlayerProgressContext.Provider>
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside PlayerProvider");
  return ctx;
}

export function usePlayerProgress() {
  const ctx = useContext(PlayerProgressContext);
  if (!ctx) throw new Error("usePlayerProgress must be used inside PlayerProvider");
  return ctx;
}
