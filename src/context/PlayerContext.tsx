"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  extractCanonicalExternalUrl,
  extractYouTubeIdClient,
  externalTracksCache,
  getApiToken,
  getApiTokenAsync,
  isExternalTrack,
  normalizeTrack,
  resolveMediaUrl,
  resolveSpotifyTrackStream,
  synthesizeExternalTrack,
} from "@/lib/api";
import { isAndroidNative, isAppInForeground, subscribeToAppState } from "@/lib/androidBridge";
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
import { extractCleanTitleAndArtist } from "@/lib/lyricsCleaner";
import { isMatchingExternalFallback } from "@/lib/externalFallbackMatcher";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { useDeviceSync } from "@/context/DeviceSyncContext";
import {
  getCachedAudioBlobUrl,
  getCachedCoverBlobUrl,
  getDownloadedCoverBlobUrl,
  getDownloadedTrack,
  getDownloadedTrackBlobUrl,
  getPersistedOfflineLyrics,
  isTrackDownloaded,
  savePersistedOfflineLyrics,
  setCurrentlyPlayingTrackId,
  updateDownloadedLyrics,
} from "@/lib/offlineAudioStorage";
import {
  computeTrackDownloadFingerprint,
  resolveDownloadedTrackId,
  resolveDownloadedTrackIdAsync,
  resolveLocalDeviceAudioUri,
  resolveLocalDeviceCoverUri,
  subscribeToDownloads,
} from "@/lib/downloadManager";
import { getLocalDeviceCoverDataUrl } from "@/lib/mediaExport";
import { prebufferTrack, recordPlaybackSessionStep } from "@/lib/audioBufferManager";
import {
  initAndroidMediaSession,
  updateAndroidMediaMetadata,
  updateAndroidPlaybackState,
  blobUrlToJpegDataUrl,
} from "@/lib/androidMediaSession";
import { recordListeningEvent } from "@/lib/listeningPersonalization";
import {
  isNativeAudioAvailable,
  nativeAudioCancelCrossfade,
  nativeAudioFadeOutAndStop,
  nativeAudioPause,
  nativeAudioPlay,
  nativeAudioPlayStream,
  nativeAudioPrepareNextStream,
  nativeAudioReplay,
  nativeAudioSeek,
  nativeAudioSetPlaybackRate,
  nativeAudioSetRepeatMode,
  nativeAudioSetVolume,
  nativeAudioStartCrossfade,
  nativeAudioStop,
  subscribeNativeAudioState,
} from "@/lib/nativeAudioBridge";
import {
  analyzeDownloadedBlobAutoMix,
  analyzeDownloadedPairAutoMixPlan,
  computeAutoMixPlan,
  computeTempoLockRatios,
  djCrossfadeGains,
  getAutoMixEnabled,
  type AutoMixPlan,
  type StudioAutoMixPlan,
} from "@/lib/smartAutoMix";
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
  isBuffering: boolean;
  isCrossfading: boolean;
  crossfadeFromTrack: Track | null;
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

function stripFastStartParam(url: string): string {
  if (!url || !url.includes("fastStart=")) return url;
  return url
    .replace(/([?&])fastStart=[^&]*&?/gi, "$1")
    .replace(/[?&]$/, "")
    .replace(/\?&/, "?");
}

function checkIsOffline(): boolean {
  if (typeof window === "undefined") return false;
  // If top bar/backend connectivity is marked online or browser says online, we are NOT offline!
  if (getServerConnectivityStatus() === "online") return false;
  if (typeof navigator !== "undefined" && navigator.onLine) return false;
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
      existing.preload = "auto";
      if (!isAndroidNative()) {
        existing.crossOrigin = "anonymous";
      }
      existing.style.display = "none";
      if (document.body) {
        document.body.appendChild(existing);
      }
    } else {
      existing.preload = "auto";
    }
    singletonAudio = existing;
  }
  return singletonAudio;
}

function getSecondaryCrossfadeAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  let el = document.getElementById("soundify-crossfade-audio") as HTMLAudioElement | null;
  if (!el) {
    el = document.createElement("audio");
    el.id = "soundify-crossfade-audio";
    el.preload = "auto";
    if (!isAndroidNative()) {
      el.crossOrigin = "anonymous";
    }
    el.style.display = "none";
    if (document.body) {
      document.body.appendChild(el);
    }
  }
  return el;
}

function swapSingletonAudioDeck(newPrimary: HTMLAudioElement): HTMLAudioElement | null {
  const prev = singletonAudio;
  singletonAudio = newPrimary;
  return prev;
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
  const noticeTypeRef = useRef<"network" | "stream" | null>(null);
  const [downloadVersion, setDownloadVersion] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const isBufferingRef = useRef(false);
  const [isCrossfading, setIsCrossfading] = useState(false);
  const [crossfadeFromTrack, setCrossfadeFromTrack] = useState<Track | null>(null);
  const [audioDeckVersion, setAudioDeckVersion] = useState(0);

  const autoMixTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoMixRafRef = useRef<number | null>(null);
  const autoMixPreparedKeyRef = useRef<string | null>(null);
  const autoMixPreparingKeyRef = useRef<string | null>(null);
  const autoMixTargetTrackRef = useRef<Track | null>(null);
  const autoMixPlanRef = useRef<AutoMixPlan | null>(null);
  const studioAutoMixPlanRef = useRef<StudioAutoMixPlan | null>(null);
  const autoMixPlanDurRef = useRef<number>(0);
  const autoMixModeRef = useRef<"native" | "web" | "native-to-web" | "web-to-native" | null>(null);
  const autoMixStartedRef = useRef<boolean>(false);
  const autoMixOutgoingAnalyzedKeyRef = useRef<string | null>(null);
  const crossfadePositionGuardUntilRef = useRef<number>(0);
  const crossfadePositionFloorRef = useRef<number>(0);
  const finalizeWebAutoMixRef = useRef<(() => void) | null>(null);
  const webAutoMixGraphCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return subscribeToDownloads(() => {
      setDownloadVersion((v) => v + 1);
    });
  }, []);

  const { t, lang } = useI18n();

  const dismissOfflineNotice = useCallback(() => {
    noticeTypeRef.current = null;
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
  const lyricsRequestSeqRef = useRef(0);
  const lyricsTrackIdRef = useRef<string | null>(null);
  const remotePlayStateLockUntilRef = useRef(0);
  const stallProbeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferingDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAdvancingPlaybackPosRef = useRef(0);
  const originalCoverUrlsRef = useRef<Record<string, string>>({});

  const lastSavedStateTimeRef = useRef<number>(0);
  const refreshAttemptsRef = useRef<Record<string, number>>({});
  const streamFallbackAttemptsRef = useRef<Record<string, boolean>>({});
  const nativeErrorRetryCountRef = useRef<Record<string, number>>({});
  const triedFallbackUrlsRef = useRef<Record<string, Set<string>>>({});
  const fallbackCandidatesRef = useRef<
    Record<
      string,
      Array<{
        source: "soundcloud" | "youtube";
        audioUrl: string;
        pageUrl?: string;
        coverUrl?: string;
      }>
    >
  >({});
  const nativeAudioActiveRef = useRef<boolean>(false);

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
    const matchedDlId = resolveDownloadedTrackId(track);
    const cachedBlobUrl = getCachedAudioBlobUrl(matchedDlId || track.id);

    if (cachedBlobUrl) {
      if (audio.src !== cachedBlobUrl) {
        isSettingSourceRef.current = true;
        audio.src = cachedBlobUrl;
        isSettingSourceRef.current = false;
      }
    } else {
      const isDownloadedSync = Boolean(matchedDlId);
      if (!isDownloadedSync) {
        // Set resolved URL synchronously so immediate togglePlay() never calls play() on empty src
        const targetUrl = resolveMediaUrl(track.audioUrl);
        if (
          targetUrl &&
          (!liveSrc || (!liveSrc.includes(targetUrl) && liveSrc !== targetUrl && !liveSrc.startsWith("blob:")))
        ) {
          isSettingSourceRef.current = true;
          audio.src = targetUrl;
          isSettingSourceRef.current = false;
        }

        // Proactively resolve Spotify tracks to YouTube streams in background for instant playback start
        if (track.source === "spotify" && (!track.pageUrl || !track.pageUrl.includes("youtube"))) {
          void resolveSpotifyTrackStream(track).then((resolved) => {
            if (resolved && currentTrackRef.current?.id === track.id) {
              currentTrackRef.current = resolved;
              setCurrentTrack(resolved);
              setQueue((prevQ) => {
                const nextQ = prevQ.map((t) => (t.id === resolved.id ? resolved : t));
                queueRef.current = nextQ;
                return nextQ;
              });
              if (audio && (audio.paused || !audio.src || audio.src.includes("spotify"))) {
                const resolvedTarget = resolveMediaUrl(resolved.audioUrl);
                if (resolvedTarget && audio.src !== resolvedTarget) {
                  isSettingSourceRef.current = true;
                  audio.src = resolvedTarget;
                  isSettingSourceRef.current = false;
                }
              }
            }
          });
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
        void getDownloadedTrackBlobUrl(matchedDlId || track.id).then(upgradeToOfflineBlob);
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
    if (nativeAudioActiveRef.current && isPlayingRef.current) return false;
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

  const resetLyricsForTrackSwitch = useCallback(() => {
    lyricsRequestSeqRef.current += 1;
    lyricsTrackIdRef.current = null;
    lyricsRef.current = [];
    setLyrics([]);
    lyricsSourceRef.current = "none";
    setLyricsSource("none");
    setLyricsOffsetMs(0);
    setLyricsLoading(false);
  }, []);

  const loadLyricsForTrack = useCallback(
    async (
      trackId: string,
      forceFetch = false,
      customQuery?: { queryTitle?: string; queryArtist?: string },
    ): Promise<LyricsRefreshResult> => {
      const reqSeq = ++lyricsRequestSeqRef.current;
      const isStaleRequest = () =>
        reqSeq !== lyricsRequestSeqRef.current || currentTrackRef.current?.id !== trackId;
      const offlineStorageId =
        resolveDownloadedTrackId(currentTrackRef.current) || trackId;
      const trackFingerprint = computeTrackDownloadFingerprint(currentTrackRef.current);

      setLyricsLoading(true);
      try {
        // 1. Check offline storage & permanent persisted lyrics first (IndexedDB -> localStorage/native)
        if (!forceFetch && !customQuery?.queryTitle && !customQuery?.queryArtist) {
          try {
            const offlineRecord =
              (await getDownloadedTrack(offlineStorageId)) ||
              (offlineStorageId !== trackId ? await getDownloadedTrack(trackId) : null);
            if (isStaleRequest()) return { found: false, source: "none" };
            if (offlineRecord?.lyrics?.lines && offlineRecord.lyrics.lines.length > 0) {
              const lns = offlineRecord.lyrics.lines;
              const src = offlineRecord.lyrics.source || "offline";
              lyricsTrackIdRef.current = trackId;
              setLyrics(lns);
              lyricsRef.current = lns;
              setLyricsSource(src);
              lyricsSourceRef.current = src;
              setLyricsOffsetMs(offlineRecord.lyrics.lyricsOffsetMs ?? 0);
              broadcastLeaderState();
              return { found: true, source: src };
            }
          } catch {}

          try {
            const persistedLyrics =
              (await getPersistedOfflineLyrics({
                trackId: offlineStorageId,
                fingerprint: trackFingerprint,
              })) ||
              (offlineStorageId !== trackId
                ? await getPersistedOfflineLyrics({ trackId, fingerprint: trackFingerprint })
                : null);
            if (isStaleRequest()) return { found: false, source: "none" };
            if (persistedLyrics?.lines && persistedLyrics.lines.length > 0) {
              const lns = persistedLyrics.lines;
              const src = persistedLyrics.source || "offline";
              lyricsTrackIdRef.current = trackId;
              setLyrics(lns);
              lyricsRef.current = lns;
              setLyricsSource(src);
              lyricsSourceRef.current = src;
              setLyricsOffsetMs(persistedLyrics.lyricsOffsetMs ?? 0);
              broadcastLeaderState();
              return { found: true, source: src };
            }
          } catch {}

          if (checkIsOffline()) {
            return { found: false, source: "none" };
          }
        }

        if (forceFetch || customQuery?.queryTitle || customQuery?.queryArtist || trackId.startsWith("ext-")) {
          const rawQTitle = customQuery?.queryTitle || currentTrackRef.current?.title || "";
          const rawQArtist = customQuery?.queryArtist || currentTrackRef.current?.artistName || "";
          const { title: cleanQTitle, artist: cleanQArtist } = extractCleanTitleAndArtist(rawQTitle, rawQArtist);

          const res = await api.autoFetchLyrics(trackId, {
            forceRefresh: true,
            queryTitle: cleanQTitle || rawQTitle,
            queryArtist: cleanQArtist || rawQArtist,
            durationSec: currentTrackRef.current?.durationSec,
          });
          if (isStaleRequest()) return { found: false, source: "none" };
          if (res.found && Array.isArray(res.lines) && res.lines.length > 0) {
            lyricsTrackIdRef.current = trackId;
            setLyrics(res.lines);
            lyricsRef.current = res.lines;
            setLyricsSource(res.source ?? "lrclib");
            lyricsSourceRef.current = res.source ?? "lrclib";
            setLyricsOffsetMs(0);
            broadcastLeaderState();
            const lyricsPayload = {
              lines: res.lines,
              source: res.source ?? "lrclib",
              lyricsOffsetMs: 0,
            };
            void updateDownloadedLyrics(offlineStorageId, lyricsPayload).catch(() => {});
            void savePersistedOfflineLyrics(
              { trackId: offlineStorageId, fingerprint: trackFingerprint },
              lyricsPayload,
            ).catch(() => {});
            if (offlineStorageId !== trackId) {
              void savePersistedOfflineLyrics(
                { trackId, fingerprint: trackFingerprint },
                lyricsPayload,
              ).catch(() => {});
            }
            return { found: true, source: res.source ?? "lrclib" };
          }
          return { found: false, source: "none" };
        }
        const res = await api.getLyrics(trackId);
        if (isStaleRequest()) return { found: false, source: "none" };
        let lns = res.lines ?? [];
        let src = res.source ?? "none";

        // Cascading discovery: If catalog track has no lyrics in DB, automatically cascade to autoFetchLyrics with title & artist
        if (lns.length === 0 && !checkIsOffline()) {
          const rawQTitle = currentTrackRef.current?.title || "";
          const rawQArtist = currentTrackRef.current?.artistName || "";
          const { title: cleanQTitle, artist: cleanQArtist } = extractCleanTitleAndArtist(rawQTitle, rawQArtist);
          if (cleanQTitle) {
            try {
              const autoRes = await api.autoFetchLyrics(trackId, {
                queryTitle: cleanQTitle,
                queryArtist: cleanQArtist,
                durationSec: currentTrackRef.current?.durationSec,
              });
              if (isStaleRequest()) return { found: false, source: "none" };
              if (autoRes.found && Array.isArray(autoRes.lines) && autoRes.lines.length > 0) {
                lns = autoRes.lines;
                src = autoRes.source ?? "lrclib";
              }
            } catch {}
          }
        }

        if (isStaleRequest()) return { found: false, source: "none" };
        lyricsTrackIdRef.current = trackId;
        setLyrics(lns);
        lyricsRef.current = lns;
        setLyricsSource(src);
        lyricsSourceRef.current = src;
        setLyricsOffsetMs(res.lyricsOffsetMs ?? 0);
        broadcastLeaderState();
        if (lns.length > 0) {
          const lyricsPayload = {
            lines: lns,
            source: src,
            lyricsOffsetMs: res.lyricsOffsetMs ?? 0,
          };
          void updateDownloadedLyrics(offlineStorageId, lyricsPayload).catch(() => {});
          void savePersistedOfflineLyrics(
            { trackId: offlineStorageId, fingerprint: trackFingerprint },
            lyricsPayload,
          ).catch(() => {});
          if (offlineStorageId !== trackId) {
            void savePersistedOfflineLyrics(
              { trackId, fingerprint: trackFingerprint },
              lyricsPayload,
            ).catch(() => {});
          }
        }
        return { found: lns.length > 0, source: src };
      } catch {
        if (!isStaleRequest() && !forceFetch && !customQuery?.queryTitle && !customQuery?.queryArtist) {
          setLyrics([]);
          lyricsRef.current = [];
          setLyricsSource("none");
          lyricsSourceRef.current = "none";
          setLyricsOffsetMs(0);
          broadcastLeaderState();
        }
        return { found: false, source: "none" };
      } finally {
        if (reqSeq === lyricsRequestSeqRef.current) {
          setLyricsLoading(false);
        }
      }
    },
    [broadcastLeaderState],
  );

  const cancelAutoMix = useCallback(() => {
    if (autoMixRafRef.current !== null && typeof window !== "undefined") {
      cancelAnimationFrame(autoMixRafRef.current);
      autoMixRafRef.current = null;
    }
    if (autoMixTimerRef.current) {
      clearInterval(autoMixTimerRef.current);
      autoMixTimerRef.current = null;
    }
    if (webAutoMixGraphCleanupRef.current) {
      try {
        webAutoMixGraphCleanupRef.current();
      } catch {}
      webAutoMixGraphCleanupRef.current = null;
    }
    autoMixPreparedKeyRef.current = null;
    autoMixPreparingKeyRef.current = null;
    autoMixTargetTrackRef.current = null;
    autoMixPlanRef.current = null;
    studioAutoMixPlanRef.current = null;
    autoMixPlanDurRef.current = 0;
    autoMixModeRef.current = null;
    autoMixStartedRef.current = false;
    autoMixOutgoingAnalyzedKeyRef.current = null;
    finalizeWebAutoMixRef.current = null;
    setIsCrossfading(false);
    setCrossfadeFromTrack(null);

    if (isNativeAudioAvailable()) {
      void nativeAudioCancelCrossfade();
    }
    const deckA = getSingletonAudio();
    if (deckA) {
      deckA.volume = mutedRef.current ? 0 : volumeRef.current;
      deckA.playbackRate = playbackRateRef.current || 1;
      try {
        (deckA as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
      } catch {}
    }
    const deckB =
      typeof document !== "undefined"
        ? (document.getElementById("soundify-crossfade-audio") as HTMLAudioElement | null)
        : null;
    if (deckB) {
      try {
        deckB.pause();
        deckB.removeAttribute("src");
        deckB.load();
      } catch {}
    }
  }, []);

  const cancelAutoMixRef = useRef(cancelAutoMix);
  useEffect(() => {
    cancelAutoMixRef.current = cancelAutoMix;
  }, [cancelAutoMix]);

  const checkAutoMixProgressRef = useRef<(posSec: number, durSec: number) => void>(() => {});

  useEffect(() => {
    checkAutoMixProgressRef.current = (posSec: number, durSec: number) => {
      if (!isLeaderRef.current || !isPlayingRef.current || repeatRef.current === "one") {
        return;
      }
      if (!getAutoMixEnabled()) {
        if (autoMixPreparedKeyRef.current && !autoMixStartedRef.current) {
          cancelAutoMix();
        }
        return;
      }
      const curr = currentTrackRef.current;
      const q = queueRef.current;
      const hasKnownDur = Number.isFinite(durSec) && durSec > 0;
      if (!curr || q.length < 2 || autoMixStartedRef.current) {
        return;
      }
      if (hasKnownDur && durSec < 24) {
        return;
      }
      if (!hasKnownDur && posSec < 12) {
        return;
      }
      const effectiveDur = hasKnownDur ? durSec : 180;

      let nextTrack = autoMixTargetTrackRef.current;
      let plan = autoMixPlanRef.current;
      const curPairMatches =
        nextTrack &&
        autoMixPreparedKeyRef.current?.startsWith(`${curr.id}::`) &&
        q.some((t) => t.id === nextTrack!.id);

      if (!curPairMatches || !nextTrack || !plan) {
        const curIdx = q.findIndex((t) => t.id === curr.id);
        if (curIdx < 0) return;
        let nextIdx = curIdx + 1;
        if (shuffleRef.current && q.length > 1) {
          nextIdx = (curIdx + 1 + ((curr.id.charCodeAt(0) + q.length) % (q.length - 1))) % q.length;
        } else if (nextIdx >= q.length) {
          if (repeatRef.current === "all") nextIdx = 0;
          else return;
        }
        if (checkIsOffline()) {
          const nextDl = q.find((t, i) => i > curIdx && Boolean(resolveDownloadedTrackId(t)));
          nextTrack =
            nextDl ||
            (repeatRef.current === "all"
              ? q.find((t) => t.id !== curr.id && Boolean(resolveDownloadedTrackId(t))) || null
              : null);
        } else {
          nextTrack = q[nextIdx] ?? null;
        }
        if (!nextTrack || nextTrack.id === curr.id) return;
        autoMixTargetTrackRef.current = nextTrack;
        plan = computeAutoMixPlan(curr, nextTrack, effectiveDur);
        autoMixPlanRef.current = plan;
        autoMixPlanDurRef.current = hasKnownDur ? durSec : 0;
      } else if (hasKnownDur && Math.abs(durSec - autoMixPlanDurRef.current) > 1.5) {
        plan = computeAutoMixPlan(curr, nextTrack, durSec);
        autoMixPlanRef.current = plan;
        autoMixPlanDurRef.current = durSec;
      }

      const pairKey = `${curr.id}::${nextTrack.id}`;
      // For offline/downloaded WebView tracks, analyze real decoded PCM energy to refine mixOutSec & crossfadeSec
      if (!nativeAudioActiveRef.current && autoMixOutgoingAnalyzedKeyRef.current !== pairKey) {
        const offlineOutId = resolveDownloadedTrackId(curr);
        if (offlineOutId) {
          autoMixOutgoingAnalyzedKeyRef.current = pairKey;
          void (async () => {
            try {
              const rec = await getDownloadedTrack(offlineOutId);
              if (!rec?.audioBlob) return;
              const analysis = await analyzeDownloadedBlobAutoMix(offlineOutId, rec.audioBlob);
              if (!analysis || currentTrackRef.current?.id !== curr.id || autoMixStartedRef.current) return;
              if (autoMixPlanRef.current && autoMixTargetTrackRef.current?.id === nextTrack.id) {
                autoMixPlanRef.current = {
                  ...autoMixPlanRef.current,
                  mixOutSec: analysis.mixOutSec,
                  crossfadeSec: analysis.crossfadeSec,
                };
              }
            } catch {}
          })();
        }
      }

      const prebufferTriggerSec = hasKnownDur ? Math.max(6, plan.mixOutSec - 45) : 12;

      if (
        posSec >= prebufferTriggerSec &&
        autoMixPreparedKeyRef.current !== pairKey &&
        autoMixPreparingKeyRef.current !== pairKey
      ) {
        autoMixPreparingKeyRef.current = pairKey;
        const targetNext = nextTrack;
        const targetPlan = plan;

        void (async () => {
          try {
            let resolvedNext = normalizeTrack(targetNext);
            const matchedNextDlId = await resolveDownloadedTrackIdAsync(resolvedNext);
            const isNextDownloaded = Boolean(matchedNextDlId);
            const offlineNextStorageId = matchedNextDlId || resolvedNext.id;

            if (currentTrackRef.current?.id !== curr.id || autoMixStartedRef.current) {
              return;
            }

            const prepareNativeIncoming = async (mode: "native" | "web-to-native"): Promise<boolean> => {
              const localDeviceInUri = resolveLocalDeviceAudioUri(resolvedNext);
              if (
                !localDeviceInUri &&
                resolvedNext.source === "spotify" &&
                (!resolvedNext.audioUrl || resolvedNext.audioUrl.includes("open.spotify.com"))
              ) {
                try {
                  resolvedNext = await resolveSpotifyTrackStream(resolvedNext);
                } catch {}
              }
              if (currentTrackRef.current?.id !== curr.id || autoMixStartedRef.current) return false;
              const streamUrl = localDeviceInUri || stripFastStartParam(resolveMediaUrl(resolvedNext.audioUrl));
              if (
                !streamUrl ||
                (!streamUrl.startsWith("http://") &&
                  !streamUrl.startsWith("https://") &&
                  !streamUrl.startsWith("content://") &&
                  !streamUrl.startsWith("file://"))
              ) {
                autoMixPreparingKeyRef.current = null;
                return false;
              }
              let artworkUrl = "";
              if (isNextDownloaded || localDeviceInUri) {
                const cachedCover =
                  getCachedCoverBlobUrl(offlineNextStorageId) ||
                  (await getDownloadedCoverBlobUrl(offlineNextStorageId).catch(() => null));
                if (cachedCover) {
                  artworkUrl = (await blobUrlToJpegDataUrl(cachedCover, 256)) || "";
                } else {
                  artworkUrl =
                    (await getLocalDeviceCoverDataUrl({
                      trackId: offlineNextStorageId,
                      audioUri: localDeviceInUri || undefined,
                    })) || "";
                }
              }
              if (!artworkUrl) {
                const resolvedCover =
                  resolvedNext.coverUrl && !resolvedNext.coverUrl.startsWith("blob:")
                    ? resolveMediaUrl(resolvedNext.coverUrl)
                    : originalCoverUrlsRef.current[resolvedNext.id]
                      ? resolveMediaUrl(originalCoverUrlsRef.current[resolvedNext.id])
                      : "";
                artworkUrl = resolvedCover;
                try {
                  if (resolvedCover) {
                    artworkUrl = new URL(resolvedCover, window.location.origin).toString();
                  }
                } catch {}
              }
              autoMixTargetTrackRef.current = resolvedNext;
              autoMixModeRef.current = mode;
              autoMixPreparedKeyRef.current = pairKey;
              await nativeAudioPrepareNextStream({
                url: streamUrl,
                authToken: getApiToken() || "",
                startSec: targetPlan.mixInSec,
                playbackRate: playbackRateRef.current || 1,
                trackId: resolvedNext.id,
                title: resolvedNext.title,
                artist: resolvedNext.artistName,
                album: resolvedNext.album,
                coverUrl: artworkUrl,
                duration: resolvedNext.durationSec || 0,
              });
              return true;
            };

            const nextLocalDeviceUri = resolveLocalDeviceAudioUri(resolvedNext);
            // 1. Native -> Native (both online HTTP streams OR local content:// / file:// offline files on ExoPlayer)
            if (nativeAudioActiveRef.current && (!isNextDownloaded || Boolean(nextLocalDeviceUri))) {
              await prepareNativeIncoming("native");
              return;
            }

            // 2. Web -> Native (outgoing Web/blob fading out, incoming online or local device file on ExoPlayer)
            if (!nativeAudioActiveRef.current && (!isNextDownloaded || Boolean(nextLocalDeviceUri)) && isNativeAudioAvailable()) {
              const ok = await prepareNativeIncoming("web-to-native");
              if (ok) return;
            }

            // 3. Native -> Web (downloaded incoming track) OR 4. Web -> Web
            let nextSrc = "";
            let resolvedMixInSec = targetPlan.mixInSec;
            if (isNextDownloaded) {
              const offlineOutId = resolveDownloadedTrackId(curr);
              const offlineRecIn = await getDownloadedTrack(offlineNextStorageId).catch(() => null);
              if (offlineOutId && offlineRecIn?.audioBlob) {
                const offlineRecOut = await getDownloadedTrack(offlineOutId).catch(() => null);
                if (offlineRecOut?.audioBlob) {
                  const stage5Plan = await analyzeDownloadedPairAutoMixPlan(
                    curr.id,
                    offlineRecOut.audioBlob,
                    offlineNextStorageId,
                    offlineRecIn.audioBlob,
                  ).catch(() => null);
                  if (stage5Plan && currentTrackRef.current?.id === curr.id && !autoMixStartedRef.current) {
                    const approxSr = 44100;
                    studioAutoMixPlanRef.current = { ...stage5Plan, trackBId: resolvedNext.id };
                    resolvedMixInSec = stage5Plan.startOffsetSampleOnTrackB / approxSr;
                    if (autoMixPlanRef.current && autoMixTargetTrackRef.current?.id === targetNext.id) {
                      autoMixPlanRef.current = {
                        ...autoMixPlanRef.current,
                        mixInSec: resolvedMixInSec,
                        mixOutSec: stage5Plan.startSampleOnTrackA / approxSr,
                        crossfadeSec: stage5Plan.durationSamples / approxSr,
                      };
                    }
                  }
                }
              }
              if (offlineRecIn?.audioBlob && !studioAutoMixPlanRef.current) {
                const pcmIn = await analyzeDownloadedBlobAutoMix(offlineNextStorageId, offlineRecIn.audioBlob);
                if (pcmIn && pcmIn.mixInSec >= 0) {
                  resolvedMixInSec = pcmIn.mixInSec;
                  if (autoMixPlanRef.current && autoMixTargetTrackRef.current?.id === targetNext.id) {
                    autoMixPlanRef.current = { ...autoMixPlanRef.current, mixInSec: pcmIn.mixInSec };
                  }
                }
              }
              const cachedBlob =
                getCachedAudioBlobUrl(offlineNextStorageId) || (await getDownloadedTrackBlobUrl(offlineNextStorageId));
              if (cachedBlob) nextSrc = cachedBlob;
              const cachedCover =
                getCachedCoverBlobUrl(offlineNextStorageId) || (await getDownloadedCoverBlobUrl(offlineNextStorageId));
              if (cachedCover) {
                resolvedNext = { ...resolvedNext, coverUrl: cachedCover };
              }
            } else {
              if (
                resolvedNext.source === "spotify" &&
                (!resolvedNext.audioUrl || resolvedNext.audioUrl.includes("open.spotify.com"))
              ) {
                try {
                  resolvedNext = await resolveSpotifyTrackStream(resolvedNext);
                } catch {}
              }
              nextSrc = resolveMediaUrl(resolvedNext.audioUrl);
            }

            if (currentTrackRef.current?.id !== curr.id || !nextSrc || autoMixStartedRef.current) {
              autoMixPreparingKeyRef.current = null;
              return;
            }

            const deckB = getSecondaryCrossfadeAudio();
            if (!deckB) return;
            deckB.pause();
            deckB.volume = 0;
            deckB.playbackRate = playbackRateRef.current || 1;
            deckB.src = nextSrc;
            if (resolvedMixInSec > 0) {
              const seekDeckB = () => {
                try {
                  deckB.currentTime = resolvedMixInSec;
                } catch {}
                deckB.removeEventListener("loadedmetadata", seekDeckB);
              };
              deckB.addEventListener("loadedmetadata", seekDeckB);
            }
            try {
              deckB.load();
            } catch {}

            autoMixTargetTrackRef.current = resolvedNext;
            autoMixModeRef.current = nativeAudioActiveRef.current ? "native-to-web" : "web";
            autoMixPreparedKeyRef.current = pairKey;
          } catch {
            autoMixPreparingKeyRef.current = null;
          }
        })();
        return;
      }

      if (hasKnownDur && posSec >= plan.mixOutSec && autoMixPreparedKeyRef.current === pairKey) {
        const targetNext = autoMixTargetTrackRef.current || nextTrack;
        const targetVol = mutedRef.current ? 0 : volumeRef.current;

        const buildNativeArtworkUrl = (track: Track): string => {
          const resolvedCover =
            track.coverUrl && !track.coverUrl.startsWith("blob:")
              ? resolveMediaUrl(track.coverUrl)
              : originalCoverUrlsRef.current[track.id]
                ? resolveMediaUrl(originalCoverUrlsRef.current[track.id])
                : "";
          try {
            if (resolvedCover) {
              return new URL(resolvedCover, window.location.origin).toString();
            }
          } catch {}
          return resolvedCover;
        };

        if (autoMixModeRef.current === "native" && nativeAudioActiveRef.current) {
          autoMixStartedRef.current = true;
          // UI isCrossfading & track handoff wait for "crossfadeStarted" from ExoPlayer once nextDeckPlayer is READY
          void nativeAudioStartCrossfade({
            crossfadeMs: Math.round(plan.crossfadeSec * 1000),
            volume: targetVol,
            title: targetNext.title,
            artist: targetNext.artistName,
            album: targetNext.album,
            coverUrl: buildNativeArtworkUrl(targetNext),
            duration: targetNext.durationSec || 0,
            trackId: targetNext.id,
          });
          return;
        }

        if (autoMixModeRef.current === "web-to-native" && !nativeAudioActiveRef.current) {
          const deckA = getSingletonAudio();
          if (!deckA) return;
          autoMixStartedRef.current = true;
          nativeAudioActiveRef.current = true;

          const startMs = performance.now();
          const actualRemainingMs =
            Number.isFinite(deckA.duration) && deckA.duration > 0
              ? Math.max(1200, (deckA.duration - deckA.currentTime - 0.15) * 1000)
              : plan.crossfadeSec * 1000;
          const fadeMs = Math.max(1200, Math.min(plan.crossfadeSec * 1000, actualRemainingMs));

          let stoppedOut = false;
          const finishWebOutgoing = () => {
            if (stoppedOut) return;
            stoppedOut = true;
            if (autoMixRafRef.current !== null && typeof window !== "undefined") {
              cancelAnimationFrame(autoMixRafRef.current);
              autoMixRafRef.current = null;
            }
            if (autoMixTimerRef.current) {
              clearInterval(autoMixTimerRef.current);
              autoMixTimerRef.current = null;
            }
            finalizeWebAutoMixRef.current = null;
            isSettingSourceRef.current = true;
            try {
              deckA.pause();
              deckA.removeAttribute("src");
              deckA.load();
            } catch {} finally {
              isSettingSourceRef.current = false;
            }
          };
          finalizeWebAutoMixRef.current = finishWebOutgoing;

          const stepWebOut = () => {
            if (stoppedOut) return false;
            if (userPausedIntentRef.current) {
              finishWebOutgoing();
              return false;
            }
            const p = Math.max(0, Math.min(1, (performance.now() - startMs) / fadeMs));
            const baseVol = mutedRef.current ? 0 : volumeRef.current;
            const { outGain } = djCrossfadeGains(p);
            try {
              deckA.volume = Math.max(0, outGain * baseVol);
            } catch {}
            if (p >= 1 || deckA.ended || deckA.paused) {
              finishWebOutgoing();
              return false;
            }
            return true;
          };

          if (typeof window !== "undefined" && typeof requestAnimationFrame === "function") {
            const rafTick = () => {
              if (!stepWebOut()) {
                autoMixRafRef.current = null;
                return;
              }
              autoMixRafRef.current = requestAnimationFrame(rafTick);
            };
            autoMixRafRef.current = requestAnimationFrame(rafTick);
          }
          if (autoMixTimerRef.current) clearInterval(autoMixTimerRef.current);
          autoMixTimerRef.current = setInterval(() => {
            void stepWebOut();
          }, 30);

          void nativeAudioStartCrossfade({
            crossfadeMs: Math.round(fadeMs),
            volume: targetVol,
            title: targetNext.title,
            artist: targetNext.artistName,
            album: targetNext.album,
            coverUrl: buildNativeArtworkUrl(targetNext),
            duration: targetNext.durationSec || 0,
            trackId: targetNext.id,
          });
          return;
        }

        if (autoMixModeRef.current === "native-to-web" && nativeAudioActiveRef.current) {
          const deckA = getSingletonAudio();
          const deckB =
            typeof document !== "undefined"
              ? (document.getElementById("soundify-crossfade-audio") as HTMLAudioElement | null)
              : null;
          if (!deckA || !deckB || !deckB.src || deckB.readyState < 2) {
            return;
          }

          const outgoingTrack = currentTrackRef.current;
          autoMixStartedRef.current = true;
          nativeAudioActiveRef.current = false;
          setIsCrossfading(true);
          setCrossfadeFromTrack(outgoingTrack && outgoingTrack.id !== targetNext.id ? outgoingTrack : null);
          deckB.volume = 0;
          deckB.playbackRate = playbackRateRef.current || 1;
          void deckB.play().catch(() => {
            cancelAutoMix();
          });

          const fadeMs = Math.max(1200, Math.round(plan.crossfadeSec * 1000));
          void nativeAudioFadeOutAndStop(fadeMs);

          // Promote downloaded Web Deck B to active singletonAudio & switch Player UI immediately
          isSettingSourceRef.current = true;
          try {
            deckA.id = "soundify-crossfade-audio";
            deckB.id = "soundify-global-audio";
            swapSingletonAudioDeck(deckB);
          } catch {} finally {
            isSettingSourceRef.current = false;
          }

          const promoted = autoMixTargetTrackRef.current || targetNext;
          resetLyricsForTrackSwitch();
          recordedPlayForIdRef.current = null;
          currentTrackRef.current = promoted;
          setCurrentTrack(promoted);

          const posB = Number.isFinite(deckB.currentTime) ? deckB.currentTime : 0;
          const durB =
            Number.isFinite(deckB.duration) && deckB.duration > 0
              ? deckB.duration
              : promoted.durationSec || 0;
          currentTimeRef.current = posB;
          setCurrentTime(posB);
          durationRef.current = durB;
          setDuration(durB);
          setCurrentlyPlayingTrackId(promoted.id);
          setIsPlaying(true);
          isPlayingRef.current = true;
          setIsBuffering(false);
          isBufferingRef.current = false;
          void updateAndroidPlaybackState({
            isPlaying: true,
            position: posB,
            duration: durB,
            playbackRate: deckB.playbackRate || playbackRateRef.current || 1,
          });
          setAudioDeckVersion((v) => v + 1);
          void loadLyricsForTrack(promoted.id, false);
          savePlayerState(posB);
          broadcastLeaderState();
          broadcastCurrentState();

          const startMs = performance.now();
          let finished = false;
          const finishNativeToWeb = () => {
            if (finished) return;
            finished = true;
            if (autoMixRafRef.current !== null && typeof window !== "undefined") {
              cancelAnimationFrame(autoMixRafRef.current);
              autoMixRafRef.current = null;
            }
            if (autoMixTimerRef.current) {
              clearInterval(autoMixTimerRef.current);
              autoMixTimerRef.current = null;
            }
            finalizeWebAutoMixRef.current = null;
            const baseVol = mutedRef.current ? 0 : volumeRef.current;
            try {
              deckB.volume = baseVol;
            } catch {}
            autoMixStartedRef.current = false;
            autoMixPreparedKeyRef.current = null;
            autoMixPreparingKeyRef.current = null;
            autoMixTargetTrackRef.current = null;
            autoMixPlanRef.current = null;
            autoMixPlanDurRef.current = 0;
            autoMixModeRef.current = null;
            setIsCrossfading(false);
            setCrossfadeFromTrack(null);
          };
          finalizeWebAutoMixRef.current = finishNativeToWeb;

          const stepIn = () => {
            if (finished) return false;
            if (userPausedIntentRef.current) {
              cancelAutoMix();
              return false;
            }
            const p = Math.max(0, Math.min(1, (performance.now() - startMs) / fadeMs));
            const baseVol = mutedRef.current ? 0 : volumeRef.current;
            const { inGain } = djCrossfadeGains(p);
            try {
              deckB.volume = Math.max(0, inGain * baseVol);
            } catch {}
            if (p >= 1) {
              finishNativeToWeb();
              return false;
            }
            return true;
          };

          if (typeof window !== "undefined" && typeof requestAnimationFrame === "function") {
            const rafTick = () => {
              if (!stepIn()) {
                autoMixRafRef.current = null;
                return;
              }
              autoMixRafRef.current = requestAnimationFrame(rafTick);
            };
            autoMixRafRef.current = requestAnimationFrame(rafTick);
          }
          if (autoMixTimerRef.current) clearInterval(autoMixTimerRef.current);
          autoMixTimerRef.current = setInterval(() => {
            void stepIn();
          }, 30);
          return;
        }

        if (autoMixModeRef.current === "web" && !nativeAudioActiveRef.current) {
          const deckA = getSingletonAudio();
          const deckB =
            typeof document !== "undefined"
              ? (document.getElementById("soundify-crossfade-audio") as HTMLAudioElement | null)
              : null;
          if (!deckA || !deckB || !deckB.src || deckB.readyState < 2) {
            return;
          }

          const outgoingTrack = currentTrackRef.current;
          autoMixStartedRef.current = true;
          setIsCrossfading(true);
          setCrossfadeFromTrack(outgoingTrack && outgoingTrack.id !== targetNext.id ? outgoingTrack : null);
          deckB.volume = 0;
          deckB.playbackRate = playbackRateRef.current || 1;
          void deckB.play().catch(() => {
            cancelAutoMix();
          });

          // Upfront Deck Switch: promote Deck B & switch Player UI immediately while Deck A melts out smoothly
          isSettingSourceRef.current = true;
          try {
            deckA.id = "soundify-crossfade-audio";
            deckB.id = "soundify-global-audio";
            swapSingletonAudioDeck(deckB);
          } catch {} finally {
            isSettingSourceRef.current = false;
          }

          const promoted = autoMixTargetTrackRef.current || targetNext;
          resetLyricsForTrackSwitch();
          recordedPlayForIdRef.current = null;
          currentTrackRef.current = promoted;
          setCurrentTrack(promoted);

          const posB = Number.isFinite(deckB.currentTime) ? deckB.currentTime : 0;
          const durB =
            Number.isFinite(deckB.duration) && deckB.duration > 0
              ? deckB.duration
              : promoted.durationSec || 0;
          currentTimeRef.current = posB;
          setCurrentTime(posB);
          durationRef.current = durB;
          setDuration(durB);
          setCurrentlyPlayingTrackId(promoted.id);
          setIsPlaying(true);
          isPlayingRef.current = true;
          setIsBuffering(false);
          isBufferingRef.current = false;
          void updateAndroidPlaybackState({
            isPlaying: true,
            position: posB,
            duration: durB,
            playbackRate: deckB.playbackRate || playbackRateRef.current || 1,
          });
          setAudioDeckVersion((v) => v + 1);
          void loadLyricsForTrack(promoted.id, false);
          savePlayerState(posB);
          broadcastLeaderState();
          broadcastCurrentState();

          const startMs = performance.now();
          const actualRemainingMs =
            Number.isFinite(deckA.duration) && deckA.duration > 0
              ? Math.max(1200, (deckA.duration - deckA.currentTime - 0.15) * 1000)
              : plan.crossfadeSec * 1000;
          const fadeMs = Math.max(1200, Math.min(plan.crossfadeSec * 1000, actualRemainingMs));
          const activeStudioPlan =
            studioAutoMixPlanRef.current?.trackAId === outgoingTrack?.id &&
            studioAutoMixPlanRef.current?.trackBId === promoted.id
              ? studioAutoMixPlanRef.current
              : null;
          const userBaseRate = playbackRateRef.current || 1;
          try {
            (deckA as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
            (deckB as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
          } catch {}
          if (activeStudioPlan?.mode === "BEAT_SYNC_PHRASE") {
            deckB.playbackRate = Math.max(0.85, Math.min(1.18, activeStudioPlan.initialTempoRatioB * userBaseRate));
          }

          // WebAudio sample-accurate 3-Band EQ + Equal-Power + Sub-Bass Swap + -0.5dBFS Limiter (when WebAudio graph is attached on desktop)
          let webAudioDspScheduled = false;
          const webCtx = audioCtxRef.current;
          if (!isAndroidNative() && webCtx && sourceNodeRef.current) {
            try {
              const fadeSec = fadeMs / 1000;
              const nowT = webCtx.currentTime;
              const srcA = sourceNodeRef.current;
              const analyserOut = analyserRef.current;

              // Disconnect direct path briefly while routing through 3-band Stage 4 DSP chain
              const deckAGain = webCtx.createGain();
              const deckALow = webCtx.createBiquadFilter();
              deckALow.type = "lowshelf";
              deckALow.frequency.setValueAtTime(140, nowT);
              const deckAMidDip = webCtx.createBiquadFilter();
              deckAMidDip.type = "peaking";
              deckAMidDip.frequency.setValueAtTime(1500, nowT);
              deckAMidDip.Q.setValueAtTime(0.9, nowT);

              const limiter = webCtx.createDynamicsCompressor();
              limiter.threshold.setValueAtTime(-0.5, nowT);
              limiter.knee.setValueAtTime(3, nowT);
              limiter.ratio.setValueAtTime(20, nowT);
              limiter.attack.setValueAtTime(0.002, nowT);
              limiter.release.setValueAtTime(0.05, nowT);

              const curveSteps = 64;
              const curveA = new Float32Array(curveSteps);
              const lowCurveA = new Float32Array(curveSteps);
              const midCurveA = new Float32Array(curveSteps);
              const baseVol = mutedRef.current ? 0 : volumeRef.current;
              const swapProgress = activeStudioPlan?.bassSwapProgress ?? 0.5;
              const swapCenterTime = nowT + fadeSec * swapProgress;

              for (let i = 0; i < curveSteps; i++) {
                const p = i / (curveSteps - 1);
                curveA[i] = Math.cos(p * Math.PI * 0.5) * baseVol;
                const midDipT = Math.max(0, Math.min(1, (p - 0.5) / 0.5));
                midCurveA[i] = -3.0 * midDipT;
                const s = p <= swapProgress - 0.04 ? 0 : p >= swapProgress + 0.04 ? 1 : ((p - (swapProgress - 0.04)) / 0.08);
                const smoothS = s * s * (3 - 2 * s);
                lowCurveA[i] = -24.0 * smoothS;
              }
              deckAGain.gain.setValueCurveAtTime(curveA, nowT, fadeSec);
              deckALow.gain.setValueCurveAtTime(lowCurveA, nowT, fadeSec);
              deckAMidDip.gain.setValueCurveAtTime(midCurveA, nowT, fadeSec);

              srcA.disconnect();
              srcA.connect(deckALow);
              deckALow.connect(deckAMidDip);
              deckAMidDip.connect(deckAGain);
              deckAGain.connect(limiter);
              limiter.connect(webCtx.destination);
              deckA.volume = 1;

              webAutoMixGraphCleanupRef.current = () => {
                try {
                  srcA.disconnect();
                  deckALow.disconnect();
                  deckAMidDip.disconnect();
                  deckAGain.disconnect();
                  limiter.disconnect();
                  if (analyserOut) {
                    srcA.connect(analyserOut);
                  }
                } catch {}
              };
              webAudioDspScheduled = Boolean(swapCenterTime);
            } catch {
              webAudioDspScheduled = false;
            }
          }

          let finished = false;
          const finishWebCrossfade = () => {
            if (finished) return;
            finished = true;

            if (autoMixRafRef.current !== null && typeof window !== "undefined") {
              cancelAnimationFrame(autoMixRafRef.current);
              autoMixRafRef.current = null;
            }
            if (autoMixTimerRef.current) {
              clearInterval(autoMixTimerRef.current);
              autoMixTimerRef.current = null;
            }
            if (webAutoMixGraphCleanupRef.current) {
              try {
                webAutoMixGraphCleanupRef.current();
              } catch {}
              webAutoMixGraphCleanupRef.current = null;
            }
            finalizeWebAutoMixRef.current = null;

            const baseVol = mutedRef.current ? 0 : volumeRef.current;
            isSettingSourceRef.current = true;
            try {
              deckB.volume = baseVol;
              deckB.playbackRate = userBaseRate;
              if (deckB.paused && !userPausedIntentRef.current) {
                void deckB.play().catch(() => {});
              }
              deckA.playbackRate = userBaseRate;
              deckA.pause();
              deckA.removeAttribute("src");
              deckA.load();
            } catch {} finally {
              isSettingSourceRef.current = false;
            }

            autoMixStartedRef.current = false;
            autoMixPreparedKeyRef.current = null;
            autoMixPreparingKeyRef.current = null;
            autoMixTargetTrackRef.current = null;
            autoMixPlanRef.current = null;
            studioAutoMixPlanRef.current = null;
            autoMixPlanDurRef.current = 0;
            autoMixModeRef.current = null;
            setIsCrossfading(false);
            setCrossfadeFromTrack(null);
          };

          finalizeWebAutoMixRef.current = finishWebCrossfade;

          const stepWebBlend = () => {
            if (finished) return false;
            if (userPausedIntentRef.current) {
              cancelAutoMix();
              return false;
            }
            if (deckB.error) {
              cancelAutoMix();
              return false;
            }
            const p = Math.max(0, Math.min(1, (performance.now() - startMs) / fadeMs));
            const baseVol = mutedRef.current ? 0 : volumeRef.current;
            const { outGain, inGain } = djCrossfadeGains(p);
            try {
              if (!webAudioDspScheduled) {
                deckA.volume = Math.max(0, outGain * baseVol);
              }
              const compLinear = activeStudioPlan
                ? Math.pow(10, Math.max(-6, Math.min(6, activeStudioPlan.gainCompensationDbB)) / 20)
                : 1;
              deckB.volume = Math.max(0, Math.min(1, inGain * baseVol * compLinear));
              if (activeStudioPlan?.mode === "BEAT_SYNC_PHRASE") {
                const { rateA, rateB } = computeTempoLockRatios(activeStudioPlan, p);
                deckA.playbackRate = Math.max(0.85, Math.min(1.18, rateA * userBaseRate));
                deckB.playbackRate = Math.max(0.85, Math.min(1.18, rateB * userBaseRate));
              }
            } catch {}

            if (p >= 1 || deckA.ended || deckA.paused) {
              finishWebCrossfade();
              return false;
            }
            return true;
          };

          if (typeof window !== "undefined" && typeof requestAnimationFrame === "function") {
            const rafTick = () => {
              if (!stepWebBlend()) {
                autoMixRafRef.current = null;
                return;
              }
              autoMixRafRef.current = requestAnimationFrame(rafTick);
            };
            autoMixRafRef.current = requestAnimationFrame(rafTick);
          }

          if (autoMixTimerRef.current) {
            clearInterval(autoMixTimerRef.current);
          }
          // 30ms interval guarantees smooth background blending even when screen is off and rAF pauses
          autoMixTimerRef.current = setInterval(() => {
            void stepWebBlend();
          }, 30);
        }
      }
    };
  }, [broadcastCurrentState, broadcastLeaderState, cancelAutoMix, loadLyricsForTrack, resetLyricsForTrackSwitch, savePlayerState]);

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
    noticeTypeRef.current = "network";
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

  const startNativeStreamForTrack = useCallback(
    async (targetTrack: Track, streamSource: string, startSec = 0) => {
      const audio = getSingletonAudio();
      if (audio) {
        isSettingSourceRef.current = true;
        try {
          if (!audio.paused) audio.pause();
          if (audio.src || audio.getAttribute("src")) {
            audio.removeAttribute("src");
            audio.load();
          }
        } catch {}
        isSettingSourceRef.current = false;
      }
      if (audioCtxRef.current?.state === "running") {
        void audioCtxRef.current.suspend().catch(() => {});
      }
      nativeAudioActiveRef.current = true;
      const sanitizedStreamSource = stripFastStartParam(streamSource);

      const resolvedCover =
        targetTrack.coverUrl && !targetTrack.coverUrl.startsWith("blob:")
          ? resolveMediaUrl(targetTrack.coverUrl)
          : originalCoverUrlsRef.current[targetTrack.id]
            ? resolveMediaUrl(originalCoverUrlsRef.current[targetTrack.id])
            : "";
      let artworkUrl = resolvedCover;
      try {
        if (resolvedCover) {
          artworkUrl = new URL(resolvedCover, window.location.origin).toString();
        }
      } catch {}

      await nativeAudioSetRepeatMode(repeatRef.current);
      await nativeAudioPlayStream({
        url: sanitizedStreamSource,
        authToken: getApiToken() || "",
        startSec: startSec > 0 ? startSec : 0,
        playbackRate: playbackRateRef.current || 1,
        volume: mutedRef.current ? 0 : volumeRef.current,
        title: targetTrack.title,
        artist: targetTrack.artistName,
        album: targetTrack.album,
        coverUrl: artworkUrl,
        duration: targetTrack.durationSec || durationRef.current || 0,
        trackId: targetTrack.id,
      });
    },
    [],
  );

  const attemptPlayWithRetry = useCallback(
    async (
      audio: HTMLAudioElement,
      track: Track,
      isDownloaded: boolean,
      baseAudioSource?: string,
      targetStartSec?: number,
      forceWebAudio = false,
    ): Promise<boolean> => {
      const reqId = ++playRequestIdRef.current;
      userPausedIntentRef.current = false;
      isRetryingPlayRef.current = true;
      setIsPlaying(true);
      isPlayingRef.current = true;
      setIsBuffering(true);
      isBufferingRef.current = true;

      const desiredPos =
        typeof targetStartSec === "number" && targetStartSec > 0
          ? targetStartSec
          : nativeAudioActiveRef.current
            ? currentTimeRef.current
            : audio.currentTime > 0
              ? audio.currentTime
              : currentTimeRef.current;
      preservePlaybackIntent(track.id, desiredPos, true);

      // Fast path on Android: route remote HTTP streams directly through Media3 ExoPlayer
      // instead of WebView's HTML5 <audio> element for rapid startup and rock-solid buffering.
      const candidateStreamUrl = baseAudioSource || resolveMediaUrl(track.audioUrl);
      const isLocalNativeFile =
        Boolean(candidateStreamUrl) &&
        (candidateStreamUrl.startsWith("content://") || candidateStreamUrl.startsWith("file://"));
      if (
        !forceWebAudio &&
        isNativeAudioAvailable() &&
        (!isDownloaded || isLocalNativeFile) &&
        candidateStreamUrl &&
        (candidateStreamUrl.startsWith("http://") ||
          candidateStreamUrl.startsWith("https://") ||
          isLocalNativeFile)
      ) {
        try {
          isRetryingPlayRef.current = false;
          isSettingSourceRef.current = false;
          await startNativeStreamForTrack(track, candidateStreamUrl, desiredPos);
          return true;
        } catch {
          nativeAudioActiveRef.current = false;
          // Fall through cleanly to HTML5 <audio> if native bridge rejected
        }
      } else if (nativeAudioActiveRef.current) {
        nativeAudioActiveRef.current = false;
        void nativeAudioStop();
      }

      const isExternalTrackItem = isExternalTrack(track);

      const retryDelays = isExternalTrackItem ? [0, 500, 1200] : [0, 400, 1000];
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

          // If the audio element is already playing or ready to play, do NOT disrupt it!
          if (!audio.paused && audio.readyState >= 3) {
            isRetryingPlayRef.current = false;
            isSettingSourceRef.current = false;
            return true;
          }

          const isActivelyBuffering =
            typeof HTMLMediaElement !== "undefined" &&
            audio.networkState === HTMLMediaElement.NETWORK_LOADING;

          // Re-establish fresh HTTP socket on retry for online streams ONLY if media encountered an error or stalled without active downloading
          const rawSource = baseAudioSource || resolveMediaUrl(track.audioUrl);
          if (
            rawSource &&
            !rawSource.startsWith("blob:") &&
            !rawSource.startsWith("data:") &&
            audio.readyState < 2 &&
            (!isActivelyBuffering || Boolean(audio.error))
          ) {
            const cleanedSource = rawSource.replace(/([?&])_rt=\d+/g, "$1").replace(/[?&]$/, "").replace(/\?&/, "?");
            const resumeAt = audio.currentTime > 0 ? audio.currentTime : desiredPos;
            isSettingSourceRef.current = true;
            // Only add cache-buster if actual media error occurred
            const retrySrc = audio.error ? `${cleanedSource}${cleanedSource.includes("?") ? "&" : "?"}_rt=${Date.now()}` : cleanedSource;
            audio.src = retrySrc;
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
            setIsBuffering(false);
            isBufferingRef.current = false;
            return false;
          }
          isSettingSourceRef.current = false;
          isRetryingPlayRef.current = false;
          setIsBuffering(false);
          isBufferingRef.current = false;
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

      // If initial stream playback failed on an online external track, trigger immediate cascade fallback to SoundCloud or clean YouTube mirror
      if (
        isExternalTrackItem &&
        !isDownloaded &&
        !streamFallbackAttemptsRef.current[track.id] &&
        playRequestIdRef.current === reqId &&
        !userPausedIntentRef.current
      ) {
        streamFallbackAttemptsRef.current[track.id] = true;
        const { title: cleanT, artist: cleanA } = extractCleanTitleAndArtist(track.title, track.artistName);
        const fallbackQ = `${cleanA ? `${cleanA} ` : ""}${cleanT}`.trim();
        if (fallbackQ) {
          const candidates: Array<{
            source: "soundcloud" | "youtube";
            audioUrl: string;
            pageUrl?: string;
            coverUrl?: string;
          }> = [];

          // Collect SoundCloud + alternative YouTube candidates concurrently for fast playback failover
          const [scSettled, ytSettled] = await Promise.allSettled([
            track.source !== "soundcloud"
              ? api.searchExternal(fallbackQ, "soundcloud", 3)
              : Promise.resolve({ results: [] as Track[] }),
            api.searchExternal(`${fallbackQ} audio`, "youtube", 3),
          ]);

          if (scSettled.status === "fulfilled" && scSettled.value.results && scSettled.value.results.length > 0) {
            for (const r of scSettled.value.results) {
              if (
                r.audioUrl &&
                isMatchingExternalFallback(
                  track.title,
                  track.artistName,
                  r.title,
                  r.artistName,
                  track.durationSec,
                  r.durationSec,
                )
              ) {
                candidates.push({
                  source: "soundcloud",
                  audioUrl: r.audioUrl,
                  pageUrl: r.pageUrl || track.pageUrl,
                  coverUrl: r.coverUrl || track.coverUrl,
                });
              }
            }
          }

          const currentYtId = extractYouTubeIdClient(track.pageUrl || track.audioUrl || track.id);
          if (ytSettled.status === "fulfilled" && ytSettled.value.results && ytSettled.value.results.length > 0) {
            for (const r of ytSettled.value.results) {
              const rId = extractYouTubeIdClient(r.pageUrl || r.audioUrl || r.id);
              if (
                r.audioUrl &&
                (!rId || rId !== currentYtId) &&
                r.id !== track.id &&
                isMatchingExternalFallback(
                  track.title,
                  track.artistName,
                  r.title,
                  r.artistName,
                  track.durationSec,
                  r.durationSec,
                )
              ) {
                candidates.push({
                  source: "youtube",
                  audioUrl: r.audioUrl,
                  pageUrl: r.pageUrl || track.pageUrl,
                  coverUrl: r.coverUrl || track.coverUrl,
                });
              }
            }
          }

          // 3. Fallback for soundcloud tracks: try alternative soundcloud or standard youtube query
          if (track.source === "soundcloud") {
            try {
              const ytSearch = await api.searchExternal(fallbackQ, "youtube", 3);
              if (ytSearch.results && ytSearch.results.length > 0) {
                for (const r of ytSearch.results) {
                  if (
                    r.audioUrl &&
                    isMatchingExternalFallback(
                      track.title,
                      track.artistName,
                      r.title,
                      r.artistName,
                      track.durationSec,
                      r.durationSec,
                    )
                  ) {
                    candidates.push({
                      source: "youtube",
                      audioUrl: r.audioUrl,
                      pageUrl: r.pageUrl || track.pageUrl,
                      coverUrl: r.coverUrl || track.coverUrl,
                    });
                  }
                }
              }
            } catch {}
          }

          // Try each candidate sequentially until audio playback succeeds
          for (const candidate of candidates) {
            if (playRequestIdRef.current !== reqId || userPausedIntentRef.current) {
              return false;
            }
            try {
              const fallbackTrack: Track = {
                ...track,
                source: candidate.source,
                audioUrl: candidate.audioUrl,
                pageUrl: candidate.pageUrl || track.pageUrl,
                coverUrl: candidate.coverUrl || track.coverUrl,
              };
              currentTrackRef.current = fallbackTrack;
              setCurrentTrack(fallbackTrack);
              setQueue((prevQueue) => {
                const nextQ = prevQueue.map((t) => (t.id === track.id ? fallbackTrack : t));
                queueRef.current = nextQ;
                return nextQ;
              });
              externalTracksCache.set(track.id, fallbackTrack);
              const fbSource = resolveMediaUrl(fallbackTrack.audioUrl);
              isSettingSourceRef.current = true;
              audio.src = fbSource;
              if (desiredPos > 0) {
                const onMeta = () => {
                  try {
                    audio.currentTime = desiredPos;
                  } catch {}
                  audio.removeEventListener("loadedmetadata", onMeta);
                };
                audio.addEventListener("loadedmetadata", onMeta);
              }
              await audio.play();
              isSettingSourceRef.current = false;
              isRetryingPlayRef.current = false;
              setIsPlaying(true);
              isPlayingRef.current = true;
              broadcastLeaderState();
              noticeTypeRef.current = null;
              setOfflineNotice(null);
              return true;
            } catch {
              // Try next candidate
            }
          }
        }
      }

      if (playRequestIdRef.current === reqId) {
        isSettingSourceRef.current = false;
        isRetryingPlayRef.current = false;
        setIsBuffering(false);
        isBufferingRef.current = false;
        setIsPlaying(false);
        isPlayingRef.current = false;
        broadcastLeaderState();
        if (isExternalTrackItem) {
          noticeTypeRef.current = "stream";
          setOfflineNotice(
            lang === "fa"
              ? "این قطعه در حال حاضر قابل پخش نیست"
              : "This track is currently unavailable for playback",
          );
        } else if (!isDownloaded) {
          notifyServerConnectivityIssue();
        }
      }
      return false;
    },
    [broadcastLeaderState, broadcastLocalState, lang, notifyServerConnectivityIssue, startNativeStreamForTrack],
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
      // NOTE: Only toggle pause if the audio is actively playing with audible progress!
      // Tapping a track while it is connecting/buffering must NEVER cancel the in-flight request!
      if (isUiToggleCall && currentTrackRef.current?.id === normalizedTrack.id) {
        const currentAudio = getSingletonAudio();
        const isCurrentlyPlayingAudible = Boolean(
          isPlayingRef.current &&
            (nativeAudioActiveRef.current
              ? currentTimeRef.current > 0 || !isBufferingRef.current
              : currentAudio && !currentAudio.paused && currentAudio.currentTime > 0),
        );
        if (isCurrentlyPlayingAudible) {
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
          cancelAutoMixRef.current();
          playRequestIdRef.current += 1;
          isSettingSourceRef.current = false;
          isRetryingPlayRef.current = false;
          clearPreservedPlaybackIntent();
          if (nativeAudioActiveRef.current) {
            void nativeAudioPause();
          }
          if (currentAudio && !currentAudio.paused) {
            currentAudio.pause();
          }
          setIsPlaying(false);
          isPlayingRef.current = false;
          setIsBuffering(false);
          isBufferingRef.current = false;
          broadcastLeaderState();
          broadcastCurrentState();
          return;
        }
      }

      if (currentTrackRef.current?.id !== normalizedTrack.id) {
        cancelAutoMixRef.current();
        nativeErrorRetryCountRef.current[normalizedTrack.id] = 0;
        streamFallbackAttemptsRef.current[normalizedTrack.id] = false;
        refreshAttemptsRef.current[normalizedTrack.id] = 0;
        delete triedFallbackUrlsRef.current[normalizedTrack.id];
        delete fallbackCandidatesRef.current[normalizedTrack.id];
      }

      const matchedDownloadedId = await resolveDownloadedTrackIdAsync(normalizedTrack);
      const localDeviceUri = resolveLocalDeviceAudioUri(normalizedTrack);
      const isDownloaded = Boolean(matchedDownloadedId || localDeviceUri);
      const offlineStorageId = matchedDownloadedId || normalizedTrack.id;

      setCurrentlyPlayingTrackId(offlineStorageId);
      setOfflineNotice(null);
      if (resolvedAutoPlay) {
        setIsBuffering(true);
        isBufferingRef.current = true;
      }

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
        const hasTrack = normalizedQueue.some((t) => t.id === normalizedTrack.id);
        const finalQueue = hasTrack ? normalizedQueue : [normalizedTrack, ...normalizedQueue];
        queueRef.current = finalQueue;
        setQueue(finalQueue);
      } else {
        const prev = queueRef.current;
        const nextQ = prev.some((t) => t.id === normalizedTrack.id) ? prev : [normalizedTrack, ...prev];
        queueRef.current = nextQ;
        setQueue(nextQ);
      }

      const audio = getSingletonAudio();
      if (!audio) return;

      // Guarantee auth token is hydrated in memory before resolveMediaUrl attaches ?token= to external stream URLs
      try {
        await getApiTokenAsync();
      } catch {}

      // Resolve audio source URL and offline cover if downloaded
      let audioSource = resolveMediaUrl(normalizedTrack.audioUrl);
      let trackToPlay = normalizedTrack;

      const isExternal = isExternalTrack(trackToPlay);

      if (isExternal && !isDownloaded) {
        const needsSpotifyResolution =
          trackToPlay.source === "spotify" &&
          (!trackToPlay.audioUrl ||
            trackToPlay.audioUrl.includes("open.spotify.com") ||
            trackToPlay.audioUrl.includes("fallback-preview.mp3"));
        if (needsSpotifyResolution) {
          try {
            trackToPlay = await resolveSpotifyTrackStream(trackToPlay);
          } catch {}
        }
        const canonical = extractCanonicalExternalUrl(trackToPlay.pageUrl || trackToPlay.audioUrl, trackToPlay.id);
        const { title: cleanTitle, artist: cleanArtist } = extractCleanTitleAndArtist(trackToPlay.title, trackToPlay.artistName);
        const trackTitleParam = cleanTitle || trackToPlay.title || "";
        const trackArtistParam = cleanArtist || trackToPlay.artistName || "";

        const isNativePlayer = isNativeAudioAvailable();
        const rawResolved = trackToPlay.audioUrl && !trackToPlay.audioUrl.includes("fallback-preview.mp3")
          ? trackToPlay.audioUrl
          : `/api/stream/external?url=${encodeURIComponent(canonical || trackToPlay.id)}&id=${encodeURIComponent(trackToPlay.id)}&title=${encodeURIComponent(trackTitleParam)}&artist=${encodeURIComponent(trackArtistParam)}${isNativePlayer ? "" : "&fastStart=true"}`;
        let resolvedAudio = rawResolved;
        if (resolvedAudio.includes("/api/stream/external")) {
          if (isNativePlayer) {
            resolvedAudio = stripFastStartParam(resolvedAudio);
          } else if (!resolvedAudio.includes("fastStart=")) {
            resolvedAudio = `${resolvedAudio}${resolvedAudio.includes("?") ? "&" : "?"}fastStart=true`;
          }
          if (!resolvedAudio.includes("title=") && trackTitleParam) {
            resolvedAudio = `${resolvedAudio}&title=${encodeURIComponent(trackTitleParam)}`;
          }
          if (!resolvedAudio.includes("artist=") && trackArtistParam) {
            resolvedAudio = `${resolvedAudio}&artist=${encodeURIComponent(trackArtistParam)}`;
          }
        }

        trackToPlay = {
          ...trackToPlay,
          pageUrl: canonical || trackToPlay.pageUrl,
          audioUrl: resolvedAudio,
        };
        audioSource = resolveMediaUrl(resolvedAudio);
        externalTracksCache.set(trackToPlay.id, trackToPlay);
        setQueue((prevQueue) => {
          const nextQ = prevQueue.map((t) => (t.id === trackToPlay.id ? trackToPlay : t));
          queueRef.current = nextQ;
          return nextQ;
        });
      }

      if (normalizedTrack.coverUrl && !normalizedTrack.coverUrl.startsWith("blob:")) {
        originalCoverUrlsRef.current[normalizedTrack.id] = normalizedTrack.coverUrl;
      }

      if (isDownloaded) {
        try {
          const [blobUrlRaw, coverBlobUrl] = await Promise.all([
            matchedDownloadedId ? getDownloadedTrackBlobUrl(offlineStorageId) : Promise.resolve(null),
            matchedDownloadedId ? getDownloadedCoverBlobUrl(offlineStorageId) : Promise.resolve(null),
          ]);
          let resolvedBlobUrl = blobUrlRaw;
          if (!resolvedBlobUrl && matchedDownloadedId) {
            const directRec = await getDownloadedTrack(offlineStorageId).catch(() => null);
            if (directRec?.audioBlob && directRec.audioBlob.size > 0 && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
              resolvedBlobUrl = URL.createObjectURL(directRec.audioBlob);
            }
          }
          if (localDeviceUri && isNativeAudioAvailable()) {
            audioSource = localDeviceUri;
          } else if (resolvedBlobUrl) {
            audioSource = resolvedBlobUrl;
          }
          if (coverBlobUrl) {
            trackToPlay = { ...trackToPlay, coverUrl: coverBlobUrl };
          } else {
            const localCoverUri = resolveLocalDeviceCoverUri(normalizedTrack);
            const fallbackCover =
              localCoverUri ||
              (await getLocalDeviceCoverDataUrl({
                trackId: offlineStorageId,
                audioUri: localDeviceUri || undefined,
              }));
            if (fallbackCover) {
              trackToPlay = { ...trackToPlay, coverUrl: fallbackCover };
            }
          }
        } catch {}

        const isDeviceOffline = typeof navigator !== "undefined" && navigator.onLine === false;
        const hasLocalAudio =
          audioSource.startsWith("blob:") ||
          audioSource.startsWith("content://") ||
          audioSource.startsWith("file://");
        if (isDeviceOffline && !hasLocalAudio) {
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

      const getResolvedSourceUrl = (src: string) => {
        try {
          return new URL(src, window.location.href).href;
        } catch {
          return src;
        }
      };

      const isLocalNativeStream =
        Boolean(audioSource) &&
        (audioSource.startsWith("content://") || audioSource.startsWith("file://"));
      const willUseNativeStream =
        isNativeAudioAvailable() &&
        Boolean(audioSource) &&
        ((!isDownloaded && (audioSource.startsWith("http://") || audioSource.startsWith("https://"))) ||
          isLocalNativeStream);

      if (currentTrackRef.current?.id === track.id) {
        if (!willUseNativeStream) {
          const absSrc = getResolvedSourceUrl(audioSource);
          if (audio.src !== absSrc && audio.src !== audioSource) {
            const prevTime = audio.currentTime;
            isSettingSourceRef.current = true;
            audio.src = audioSource;
            if (startSec > 0) {
              try { audio.currentTime = startSec; } catch {}
            } else if (prevTime > 0) {
              try { audio.currentTime = prevTime; } catch {}
            }
          }
        }
        if (trackToPlay.coverUrl !== currentTrackRef.current.coverUrl) {
          currentTrackRef.current = trackToPlay;
          setCurrentTrack(trackToPlay);
        }
        if (lyricsRef.current.length === 0) {
          void loadLyricsForTrack(track.id, false);
        }
        if (resolvedAutoPlay) {
          if (!willUseNativeStream && !nativeAudioActiveRef.current) {
            initAudioGraph();
            if (audioCtxRef.current?.state === "suspended") {
              void audioCtxRef.current.resume();
            }
          }
          if (
            nativeAudioActiveRef.current &&
            (!isDownloaded || isLocalNativeStream) &&
            typeof startTime !== "number" &&
            !isPlayingRef.current &&
            !isBufferingRef.current
          ) {
            userPausedIntentRef.current = false;
            setIsPlaying(true);
            isPlayingRef.current = true;
            await nativeAudioPlay();
            return;
          }
          const needsAttempt = nativeAudioActiveRef.current
            ? !isPlayingRef.current || isBufferingRef.current
            : audio.paused || audio.readyState < 2 || isBufferingRef.current || Boolean(audio.error);
          if (needsAttempt) {
            await attemptPlayWithRetry(audio, trackToPlay, isDownloaded, audioSource, startSec);
          } else if (typeof startTime === "number" && startTime >= 0) {
            if (nativeAudioActiveRef.current) {
              void nativeAudioSeek(startSec);
            } else {
              try {
                audio.currentTime = startSec;
              } catch {}
            }
            currentTimeRef.current = startSec;
            setCurrentTime(startSec);
          }
        } else if (!audio.paused || nativeAudioActiveRef.current) {
          userPausedIntentRef.current = true;
          playRequestIdRef.current += 1;
          clearPreservedPlaybackIntent();
          isSettingSourceRef.current = false;
          isRetryingPlayRef.current = false;
          if (nativeAudioActiveRef.current) {
            void nativeAudioPause();
          }
          if (!audio.paused) {
            audio.pause();
          }
          setIsPlaying(false);
          isPlayingRef.current = false;
          setIsBuffering(false);
          isBufferingRef.current = false;
          broadcastLeaderState();
          broadcastCurrentState();
        }
        return;
      }

      // Track is changing! Immediately reset lyrics & request sequence to avoid showing previous song lyrics
      resetLyricsForTrackSwitch();

      recordedPlayForIdRef.current = null;
      refreshAttemptsRef.current[track.id] = 0;
      refreshAttemptsRef.current[trackToPlay.id] = 0;
      currentTrackRef.current = trackToPlay;
      currentTimeRef.current = startSec;
      lastAdvancingPlaybackPosRef.current = startSec;
      durationRef.current = track.durationSec || 0;
      setCurrentTrack(trackToPlay);
      setCurrentTime(startSec);
      setDuration(track.durationSec || 0);

      const targetAbsSrc = getResolvedSourceUrl(audioSource);
      if (!willUseNativeStream) {
        if (audio.src !== targetAbsSrc && audio.src !== audioSource) {
          isSettingSourceRef.current = true;
          audio.src = audioSource;
          try { audio.load(); } catch {}
        }
      } else if (!audio.paused) {
        isSettingSourceRef.current = true;
        try { audio.pause(); } catch {}
        isSettingSourceRef.current = false;
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

      if (!willUseNativeStream) {
        initAudioGraph();
        if (audioCtxRef.current?.state === "suspended") {
          void audioCtxRef.current.resume();
        }
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
    [attemptPlayWithRetry, broadcastCurrentState, broadcastLeaderState, claimThisDevice, deviceId, initAudioGraph, loadLyricsForTrack, resetLyricsForTrackSwitch, sendRemoteCommand, setActiveDeviceId, shouldActAsRemoteController, t],
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
      if (fromEnded && repeatRef.current === "one" && audio) {
        if (nativeAudioActiveRef.current) {
          currentTimeRef.current = 0;
          setCurrentTime(0);
          setIsPlaying(true);
          isPlayingRef.current = true;
          void nativeAudioReplay();
        } else {
          audio.currentTime = 0;
          void audio.play().catch(() => {
            try {
              audio.load();
              void audio.play();
            } catch {}
          });
        }
        broadcastLeaderState();
        return;
      }
      const idx = q.findIndex((t) => t.id === curr.id);
      let nextIdx = idx + 1;

      // When offline, seek next downloaded track in queue to avoid stopping or throwing network errors
      const activeRepeat = repeatRef.current;
      const activeShuffle = shuffleRef.current;
      if (checkIsOffline()) {
        const nextDownloaded = q.find((t, i) => i > idx && Boolean(resolveDownloadedTrackId(t)));
        if (nextDownloaded) {
          playTrack(nextDownloaded, undefined, 0, true);
          return;
        }
        if (activeRepeat === "all" || (!fromEnded && q.some((t) => Boolean(resolveDownloadedTrackId(t))))) {
          const wrapDownloaded = q.find((t) => Boolean(resolveDownloadedTrackId(t)));
          if (wrapDownloaded && wrapDownloaded.id !== curr.id) {
            playTrack(wrapDownloaded, undefined, 0, true);
            return;
          }
          if (wrapDownloaded && wrapDownloaded.id === curr.id && activeRepeat === "all") {
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

      if (activeShuffle && q.length > 1) {
        do {
          nextIdx = Math.floor(Math.random() * q.length);
        } while (nextIdx === idx);
      } else if (nextIdx >= q.length) {
        if (activeRepeat === "all" || !fromEnded) nextIdx = 0;
        else {
          setIsPlaying(false);
          isPlayingRef.current = false;
          broadcastLeaderState();
          return;
        }
      }
      const target = q[nextIdx];
      if (target) {
        if (target.id === curr.id && (activeRepeat === "all" || !fromEnded)) {
          if (nativeAudioActiveRef.current) {
            void nativeAudioSeek(0);
            void nativeAudioPlay();
          } else if (audio) {
            try {
              audio.currentTime = 0;
              void audio.play().catch(() => {});
            } catch {}
          }
          currentTimeRef.current = 0;
          setCurrentTime(0);
          setIsPlaying(true);
          isPlayingRef.current = true;
          broadcastLeaderState();
          return;
        }
        playTrack(target, undefined, 0, true);
      }
    },
    [broadcastLeaderState, getTabId, playTrack, sendRemoteCommand, shouldActAsRemoteController],
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
    const currPos = nativeAudioActiveRef.current ? currentTimeRef.current : (audio ? audio.currentTime : 0);
    if (currPos > 3) {
      if (nativeAudioActiveRef.current) {
        void nativeAudioSeek(0);
      } else if (audio) {
        audio.currentTime = 0;
      }
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
        return origIdx < idx && Boolean(resolveDownloadedTrackId(t));
      });
      if (prevDownloaded) {
        playTrack(prevDownloaded, undefined, 0, true);
        return;
      }
      const wrapDownloaded = [...q].reverse().find((t) => Boolean(resolveDownloadedTrackId(t)));
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
    let curr = currentTrackRef.current;
    if (!curr && queueRef.current.length > 0) {
      playTrack(queueRef.current[0]);
      return;
    }
    if (!curr) return;

    // Ensure audio element has source loaded (e.g. after page refresh)
    const matchedOfflineId = await resolveDownloadedTrackIdAsync(curr);
    const localDeviceUri = resolveLocalDeviceAudioUri(curr);
    const isDownloadedSync = Boolean(matchedOfflineId || localDeviceUri);
    const offlineId = matchedOfflineId || curr.id;

    const shouldStartPlaying =
      (nativeAudioActiveRef.current ? !isPlayingRef.current : audio.paused) &&
      !isPlayingRef.current &&
      !isRetryingPlayRef.current;
    if (shouldStartPlaying) {
      if (curr.source === "spotify" && !isDownloadedSync && (!curr.pageUrl || !curr.pageUrl.includes("youtube"))) {
        try {
          const resolved = await resolveSpotifyTrackStream(curr);
          if (resolved) {
            curr = resolved;
            currentTrackRef.current = resolved;
            setCurrentTrack(resolved);
            setQueue((prevQ) => {
              const nextQ = prevQ.map((t) => (t.id === resolved.id ? resolved : t));
              queueRef.current = nextQ;
              return nextQ;
            });
          }
        } catch {}
      }

      if (isDownloadedSync) {
        setOfflineNotice(null);
        setCurrentlyPlayingTrackId(offlineId);
        let cachedBlob = getCachedAudioBlobUrl(offlineId);
        if (!cachedBlob && matchedOfflineId) {
          cachedBlob = await getDownloadedTrackBlobUrl(offlineId);
        }
        if (localDeviceUri && isNativeAudioAvailable()) {
          // Local Music/Soundify or private offline file plays natively on ExoPlayer
        } else if (cachedBlob && audio.src !== cachedBlob) {
          const curT = audio.currentTime;
          isSettingSourceRef.current = true;
          audio.src = cachedBlob;
          if (curT > 0) {
            try {
              audio.currentTime = curT;
            } catch {}
          }
        }
        let cachedCover = getCachedCoverBlobUrl(offlineId);
        if (!cachedCover && matchedOfflineId) {
          cachedCover = await getDownloadedCoverBlobUrl(offlineId);
        }
        if (!cachedCover) {
          cachedCover =
            resolveLocalDeviceCoverUri(curr) ||
            (await getLocalDeviceCoverDataUrl({
              trackId: offlineId,
              audioUri: localDeviceUri || undefined,
            }));
        }
        if (cachedCover && curr.coverUrl !== cachedCover) {
          if (curr.coverUrl && !curr.coverUrl.startsWith("blob:")) {
            originalCoverUrlsRef.current[curr.id] = curr.coverUrl;
          }
          const enriched = { ...curr, coverUrl: cachedCover };
          currentTrackRef.current = enriched;
          setCurrentTrack(enriched);
        }
      } else if (nativeAudioActiveRef.current) {
        setCurrentlyPlayingTrackId(curr.id);
      } else {
        setCurrentlyPlayingTrackId(curr.id);
        const targetUrl = resolveMediaUrl(curr.audioUrl);
        const liveSrc = audio.getAttribute("src") || audio.src || "";
        if (targetUrl && (!liveSrc || (!liveSrc.includes(targetUrl) && liveSrc !== targetUrl && !liveSrc.startsWith("blob:")))) {
          isSettingSourceRef.current = true;
          audio.src = targetUrl;
        }
      }

      if (!nativeAudioActiveRef.current) {
        ensureAudioPrepared(curr);
      }
      if (lyricsRef.current.length === 0) {
        void loadLyricsForTrack(curr.id, false);
      }

      if (!(nativeAudioActiveRef.current && !isDownloadedSync)) {
        initAudioGraph();
        if (audioCtxRef.current?.state === "suspended") {
          void audioCtxRef.current.resume();
        }
      }
      localSessionStartedRef.current = true;
      if (!isThisDeviceActiveRef.current || activeDeviceIdRef.current !== deviceId) {
        isThisDeviceActiveRef.current = true;
        void claimThisDevice({
          track: curr,
          trackId: curr.id,
          isPlaying: true,
          currentTime: nativeAudioActiveRef.current ? currentTimeRef.current : audio.currentTime,
          duration: (nativeAudioActiveRef.current ? durationRef.current : audio.duration) || durationRef.current || curr.durationSec || 0,
          volume: volumeRef.current,
          repeat: repeatRef.current,
          shuffle: shuffleRef.current,
        });
      }
      if (nativeAudioActiveRef.current && (!isDownloadedSync || Boolean(localDeviceUri))) {
        userPausedIntentRef.current = false;
        setIsPlaying(true);
        isPlayingRef.current = true;
        await nativeAudioPlay();
      } else if (localDeviceUri) {
        await attemptPlayWithRetry(audio, curr, isDownloadedSync, localDeviceUri);
      } else {
        await attemptPlayWithRetry(audio, curr, isDownloadedSync);
      }
    } else {
      userPausedIntentRef.current = true;
      cancelAutoMixRef.current();
      playRequestIdRef.current += 1;
      isSettingSourceRef.current = false;
      isRetryingPlayRef.current = false;
      clearPreservedPlaybackIntent();
      if (nativeAudioActiveRef.current) {
        void nativeAudioPause();
      }
      audio.pause();
      setIsPlaying(false);
      isPlayingRef.current = false;
      setIsBuffering(false);
      isBufferingRef.current = false;
      broadcastLeaderState();
      broadcastCurrentState();
    }
  }, [attemptPlayWithRetry, broadcastCurrentState, broadcastLeaderState, claimThisDevice, deviceId, ensureAudioPrepared, getTabId, initAudioGraph, loadLyricsForTrack, playTrack, sendRemoteCommand, shouldActAsRemoteController]);

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
      if (autoMixStartedRef.current) {
        cancelAutoMixRef.current();
      }
      const curr = currentTrackRef.current;
      if (curr && !nativeAudioActiveRef.current) {
        ensureAudioPrepared(curr, seconds);
      }
      const effectiveDur = (nativeAudioActiveRef.current ? durationRef.current : audio.duration) || durationRef.current || seconds;
      const clamped = Math.max(0, Math.min(effectiveDur, seconds));
      if (nativeAudioActiveRef.current) {
        void nativeAudioSeek(clamped);
      } else {
        audio.currentTime = clamped;
      }
      currentTimeRef.current = clamped;
      setCurrentTime(clamped);
      if (!nativeAudioActiveRef.current) {
        void updateAndroidPlaybackState({
          isPlaying: isPlayingRef.current,
          position: clamped,
          duration: effectiveDur,
          playbackRate: audio.playbackRate || playbackRateRef.current || 1,
        });
      }
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
      if (nativeAudioActiveRef.current) {
        void nativeAudioSetVolume(clamped);
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
    if (nativeAudioActiveRef.current) {
      void nativeAudioSetVolume(nextMuted ? 0 : volumeRef.current);
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
      if (isNativeAudioAvailable()) {
        void nativeAudioSetRepeatMode(nextR);
      }
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
      if (nativeAudioActiveRef.current) {
        void nativeAudioSetPlaybackRate(rate);
      }
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
      cancelAutoMixRef.current();
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

  // Soundify Connect Multi-Device Command Listener
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
            const cachedExt = externalTracksCache.get(targetTrackId);
            if (inQueue) {
              playTrack(inQueue, undefined, resumeTime, shouldPlay);
            } else if (cachedExt) {
              playTrack(cachedExt, undefined, resumeTime, shouldPlay);
            } else if (isExternalTrack(targetTrackId)) {
              const synth = synthesizeExternalTrack(targetTrackId);
              playTrack(synth, undefined, resumeTime, shouldPlay);
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
              const cachedExt = externalTracksCache.get(parsedCmd.trackId);
              if (inQueue) {
                playTrack(inQueue, undefined, 0, true);
              } else if (cachedExt) {
                playTrack(cachedExt, undefined, 0, true);
              } else if (isExternalTrack(parsedCmd.trackId)) {
                const synth = synthesizeExternalTrack(parsedCmd.trackId);
                playTrack(synth, undefined, 0, true);
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
      const rawNonBlobCover =
        normalizedTrack.coverUrl && !normalizedTrack.coverUrl.startsWith("blob:")
          ? normalizedTrack.coverUrl
          : originalCoverUrlsRef.current[normalizedTrack.id] || "";
      const resolvedCover = rawNonBlobCover ? resolveMediaUrl(rawNonBlobCover) : "";
      let artworkSrc = "";
      try {
        artworkSrc = resolvedCover && !resolvedCover.startsWith("blob:")
          ? new URL(resolvedCover, window.location.origin).toString()
          : "";
      } catch {
        artworkSrc = resolvedCover && !resolvedCover.startsWith("blob:") ? resolvedCover : "";
      }
      void (async () => {
        const localBlobCover =
          normalizedTrack.coverUrl && normalizedTrack.coverUrl.startsWith("blob:")
            ? normalizedTrack.coverUrl
            : getCachedCoverBlobUrl(normalizedTrack.id) || (await getDownloadedCoverBlobUrl(normalizedTrack.id).catch(() => null));
        const inlineArtwork = localBlobCover ? await blobUrlToJpegDataUrl(localBlobCover, 256) : null;
        await updateAndroidMediaMetadata({
          title: normalizedTrack.title,
          artist: normalizedTrack.artistName,
          album: normalizedTrack.album,
          coverUrl: inlineArtwork || artworkSrc,
          duration: syncState.duration || normalizedTrack.durationSec || 0,
          trackId: normalizedTrack.id,
        });
      })();
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

  const triggerExternalFallback = useCallback(
    async (curr: Track, resumePosSec = 0): Promise<boolean> => {
      const audio = getSingletonAudio();
      if (!audio || !isExternalTrack(curr)) return false;
      const isDownloaded = Boolean(resolveDownloadedTrackId(curr));
      if (isDownloaded || (!nativeAudioActiveRef.current && audio.src.startsWith("blob:"))) return false;

      const attempts = refreshAttemptsRef.current[curr.id] || 0;
      if (attempts >= 5) return false;
      refreshAttemptsRef.current[curr.id] = attempts + 1;

      const tried = triedFallbackUrlsRef.current[curr.id] ?? (triedFallbackUrlsRef.current[curr.id] = new Set());
      if (curr.audioUrl) tried.add(curr.audioUrl);
      if (curr.pageUrl) tried.add(curr.pageUrl);

      setIsBuffering(true);
      isBufferingRef.current = true;

      try {
        const { title: cleanT, artist: cleanA } = extractCleanTitleAndArtist(curr.title, curr.artistName);
        const canonical = extractCanonicalExternalUrl(curr.pageUrl || curr.audioUrl, curr.id);

        // Step 1 (First recovery attempt): Ask backend to re-extract fresh stream URL / mirror for the exact track
        if (attempts === 0) {
          try {
            const refreshed = await api.refreshStreamUrl(
              curr.id,
              canonical || curr.pageUrl || curr.audioUrl || curr.id,
              cleanT || curr.title,
              cleanA || curr.artistName,
            );
            if (refreshed.ok && (refreshed.audioUrl || refreshed.streamUrl)) {
              const rawRefreshed = refreshed.audioUrl
                ? `${refreshed.audioUrl}${refreshed.audioUrl.includes("?") ? "&" : "?"}_t=${Date.now()}`
                : refreshed.streamUrl;
              const refreshedTrack: Track = {
                ...curr,
                audioUrl: rawRefreshed,
                pageUrl: refreshed.canonicalUrl || curr.pageUrl || canonical,
              };
              currentTrackRef.current = refreshedTrack;
              setCurrentTrack(refreshedTrack);
              updateTrackInQueue(refreshedTrack);
              externalTracksCache.set(curr.id, refreshedTrack);
              const fbSource = resolveMediaUrl(refreshedTrack.audioUrl);
              const useNativeFallback =
                isNativeAudioAvailable() &&
                Boolean(fbSource) &&
                (fbSource.startsWith("http://") || fbSource.startsWith("https://"));
              if (useNativeFallback) {
                await startNativeStreamForTrack(refreshedTrack, stripFastStartParam(fbSource), resumePosSec);
              } else {
                isSettingSourceRef.current = true;
                audio.src = fbSource;
                try { audio.load(); } catch {}
                if (resumePosSec > 0) {
                  try { audio.currentTime = resumePosSec; } catch {}
                }
                await audio.play();
                isSettingSourceRef.current = false;
                setIsBuffering(false);
                isBufferingRef.current = false;
              }
              setIsPlaying(true);
              isPlayingRef.current = true;
              broadcastLeaderState();
              broadcastCurrentState();
              noticeTypeRef.current = null;
              setOfflineNotice(null);
              return true;
            }
          } catch {}
        }

        // Step 2: Populate & iterate verified cross-platform mirror queue (opposite provider prioritized)
        const fallbackQuery = `${cleanA ? `${cleanA} ` : ""}${cleanT}`.trim();
        if (!fallbackQuery) return false;

        if (!fallbackCandidatesRef.current[curr.id]) {
          const collected: Array<{
            source: "soundcloud" | "youtube";
            audioUrl: string;
            pageUrl?: string;
            coverUrl?: string;
          }> = [];

          const [scRes, ytRes] = await Promise.allSettled([
            api.searchExternal(fallbackQuery, "soundcloud", 8),
            api.searchExternal(fallbackQuery, "youtube", 8),
          ]);

          const scItems = scRes.status === "fulfilled" && scRes.value.results ? scRes.value.results : [];
          const ytItems = ytRes.status === "fulfilled" && ytRes.value.results ? ytRes.value.results : [];

          const currentYtId = extractYouTubeIdClient(curr.pageUrl || curr.audioUrl || curr.id);
          const orderedBatches: Array<{ source: "soundcloud" | "youtube"; items: Track[] }> =
            curr.source === "soundcloud"
              ? [
                  { source: "youtube", items: ytItems },
                  { source: "soundcloud", items: scItems },
                ]
              : [
                  { source: "soundcloud", items: scItems },
                  { source: "youtube", items: ytItems },
                ];

          const seenUrls = new Set<string>(tried);
          for (const batch of orderedBatches) {
            for (const r of batch.items) {
              if (!r.audioUrl || r.id === curr.id) continue;
              if (seenUrls.has(r.audioUrl) || (r.pageUrl && seenUrls.has(r.pageUrl))) continue;
              if (batch.source === "youtube") {
                const rId = extractYouTubeIdClient(r.pageUrl || r.audioUrl || r.id);
                if (currentYtId && rId && rId === currentYtId) continue;
              }
              if (
                !isMatchingExternalFallback(
                  curr.title,
                  curr.artistName,
                  r.title,
                  r.artistName,
                  curr.durationSec,
                  r.durationSec,
                )
              ) {
                continue;
              }
              seenUrls.add(r.audioUrl);
              if (r.pageUrl) seenUrls.add(r.pageUrl);
              collected.push({
                source: batch.source,
                audioUrl: r.audioUrl,
                pageUrl: r.pageUrl || curr.pageUrl,
                coverUrl: r.coverUrl || curr.coverUrl,
              });
            }
          }
          fallbackCandidatesRef.current[curr.id] = collected.slice(0, 5);
        }

        const queueList = fallbackCandidatesRef.current[curr.id] || [];
        const nextCandidate = queueList.shift();
        if (nextCandidate) {
          tried.add(nextCandidate.audioUrl);
          if (nextCandidate.pageUrl) tried.add(nextCandidate.pageUrl);
          const fallbackTrack: Track = {
            ...curr,
            source: nextCandidate.source,
            audioUrl: nextCandidate.audioUrl,
            pageUrl: nextCandidate.pageUrl || curr.pageUrl,
            coverUrl: nextCandidate.coverUrl || curr.coverUrl,
          };
          currentTrackRef.current = fallbackTrack;
          setCurrentTrack(fallbackTrack);
          updateTrackInQueue(fallbackTrack);
          externalTracksCache.set(curr.id, fallbackTrack);
          const fbSource = resolveMediaUrl(fallbackTrack.audioUrl);
          const useNativeFallback =
            isNativeAudioAvailable() &&
            Boolean(fbSource) &&
            (fbSource.startsWith("http://") || fbSource.startsWith("https://"));
          if (useNativeFallback) {
            await startNativeStreamForTrack(fallbackTrack, stripFastStartParam(fbSource), resumePosSec);
          } else {
            isSettingSourceRef.current = true;
            audio.src = fbSource;
            try { audio.load(); } catch {}
            await audio.play();
            isSettingSourceRef.current = false;
            setIsBuffering(false);
            isBufferingRef.current = false;
          }
          setIsPlaying(true);
          isPlayingRef.current = true;
          broadcastLeaderState();
          broadcastCurrentState();
          noticeTypeRef.current = null;
          setOfflineNotice(null);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [broadcastCurrentState, broadcastLeaderState, startNativeStreamForTrack, updateTrackInQueue],
  );

  // Setup persistent singleton <audio> element events
  useEffect(() => {
    if (audioDeckVersion < 0) return;
    const audio = getSingletonAudio();
    if (!audio) return;
    if (document.body && !document.body.contains(audio)) {
      document.body.appendChild(audio);
    }

    const onPlay = () => {
      if (audio !== getSingletonAudio() || nativeAudioActiveRef.current) return;
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
      if (audio !== getSingletonAudio() || nativeAudioActiveRef.current) return;
      isSettingSourceRef.current = false;
      isRetryingPlayRef.current = false;
      setIsBuffering(false);
      isBufferingRef.current = false;
      if (bufferingDebounceTimerRef.current) {
        clearTimeout(bufferingDebounceTimerRef.current);
        bufferingDebounceTimerRef.current = null;
      }
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
      if (audio !== getSingletonAudio() || nativeAudioActiveRef.current) return;
      // Keep UI in playing/buffering state during VPN/mobile network stalls instead of auto-pausing
      const curr = currentTrackRef.current;
      if (curr && !userPausedIntentRef.current && (isPlayingRef.current || isRetryingPlayRef.current)) {
        const probeStartPos = audio.currentTime || 0;
        preservePlaybackIntent(curr.id, probeStartPos || currentTimeRef.current, true);

        // If playback already started (>0.25s), debounce the buffering spinner by 450ms so brief
        // fastStart chunk handoffs at ~1s never flash loading -> playing -> resume in the UI.
        if (probeStartPos > 0.25) {
          if (!bufferingDebounceTimerRef.current && !isBufferingRef.current) {
            bufferingDebounceTimerRef.current = setTimeout(() => {
              bufferingDebounceTimerRef.current = null;
              if (
                currentTrackRef.current?.id === curr.id &&
                !userPausedIntentRef.current &&
                (isPlayingRef.current || isRetryingPlayRef.current) &&
                !audio.paused &&
                audio.readyState < 3
              ) {
                setIsBuffering(true);
                isBufferingRef.current = true;
              }
            }, 450);
          }
        } else {
          setIsBuffering(true);
          isBufferingRef.current = true;
        }

        if (!stallProbeTimerRef.current) {
          const probeDelayMs = probeStartPos > 0.5 ? 9000 : 2800;
          stallProbeTimerRef.current = setTimeout(() => {
            stallProbeTimerRef.current = null;
            const stillStuckAtSamePos = Math.abs((audio.currentTime || 0) - probeStartPos) < 0.05;
            if (
              !userPausedIntentRef.current &&
              (isPlayingRef.current || isRetryingPlayRef.current) &&
              audio.readyState < 3 &&
              stillStuckAtSamePos
            ) {
              if (probeStartPos <= 0.5 && isExternalTrack(curr) && audio.readyState < 2 && !audio.src.startsWith("blob:")) {
                void triggerExternalFallback(curr);
              } else {
                void triggerImmediateNetworkProbe();
              }
            }
          }, probeDelayMs);
        }
      }
    };
    const onPause = () => {
      if (audio !== getSingletonAudio() || nativeAudioActiveRef.current) return;
      if (autoMixStartedRef.current && !userPausedIntentRef.current) return;
      // Ignore synthetic pause events fired by the browser during audio.src swaps or active retries
      if (isSettingSourceRef.current || isRetryingPlayRef.current) {
        return;
      }
      if (bufferingDebounceTimerRef.current) {
        clearTimeout(bufferingDebounceTimerRef.current);
        bufferingDebounceTimerRef.current = null;
      }
      setIsBuffering(false);
      isBufferingRef.current = false;
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
      if (audio !== getSingletonAudio() || nativeAudioActiveRef.current) return;
      const playbackPos = audio.currentTime;
      currentTimeRef.current = playbackPos;
      const now = performance.now();

      if (playbackPos > lastAdvancingPlaybackPosRef.current + 0.05 && !audio.paused) {
        lastAdvancingPlaybackPosRef.current = playbackPos;
        if (bufferingDebounceTimerRef.current) {
          clearTimeout(bufferingDebounceTimerRef.current);
          bufferingDebounceTimerRef.current = null;
        }
        if (isBufferingRef.current) {
          setIsBuffering(false);
          isBufferingRef.current = false;
        }
        if (stallProbeTimerRef.current && audio.readyState >= 3) {
          clearTimeout(stallProbeTimerRef.current);
          stallProbeTimerRef.current = null;
        }
      } else if (playbackPos < lastAdvancingPlaybackPosRef.current) {
        lastAdvancingPlaybackPosRef.current = playbackPos;
      }

      // Battery & thermal optimization: skip React UI re-renders 4x/sec while app is in background / multitasking / screen locked
      const inForeground = isAppInForeground() && (typeof document === "undefined" || !document.hidden);
      if (inForeground) {
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

      // Periodic Soundify Connect state broadcast (every 4 seconds while active to reduce battery wakeups)
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
        recordListeningEvent(curr);
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

      if (curr && isPlayingRef.current) {
        checkAutoMixProgressRef.current(
          playbackPos,
          audio.duration || durationRef.current || curr.durationSec || 0,
        );
      }
    };
    const onLoadedMetadata = () => {
      if (audio !== getSingletonAudio() || nativeAudioActiveRef.current) return;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        durationRef.current = audio.duration;
        setDuration(audio.duration);
        broadcastLeaderState();
      }
    };

    const onError = async () => {
      if (audio !== getSingletonAudio() || nativeAudioActiveRef.current) return;
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
      const matchedOfflineId = await resolveDownloadedTrackIdAsync(curr);
      const isDownloaded = Boolean(matchedOfflineId);

      if (isDownloaded) {
        try {
          const blobUrl = await getDownloadedTrackBlobUrl(matchedOfflineId || curr.id);
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
          // If offline blob fallback fails, notify user about saved file error
        }
        setOfflineNotice(
          lang === "fa"
            ? "خطا در بارگذاری فایل صوتی ذخیره‌شده برای پخش آفلاین"
            : "Error loading saved audio file for offline playback",
        );
        setIsPlaying(false);
        isPlayingRef.current = false;
        broadcastLeaderState();
        return;
      }

      // Track is an ONLINE streaming track (!isDownloaded)
      // NEVER show offlinePlaybackNotice ("این قطعه دانلود نشده است...") for online tracks!
      const isExternal = isExternalTrack(curr);

      if (isExternal) {
        const attempts = refreshAttemptsRef.current[curr.id] || 0;
        if (attempts < 2) {
          refreshAttemptsRef.current[curr.id] = attempts + 1;
          const resumeTime = currentTimeRef.current;
          const canonical = extractCanonicalExternalUrl(curr.pageUrl || curr.audioUrl, curr.id);

          api
            .refreshStreamUrl(curr.id, canonical || curr.pageUrl || curr.audioUrl || curr.id)
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
                  // Fallback: direct streamUrl if proxy fails and direct is non-googlevideo (or not domestic blocked)
                  if (
                    res.streamUrl &&
                    res.audioUrl &&
                    finalSource !== res.streamUrl &&
                    !res.streamUrl.includes("googlevideo.com")
                  ) {
                    try {
                      isSettingSourceRef.current = true;
                      audio.src = res.streamUrl;
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
                }
              }

              // Multi-candidate resilient fallback across SoundCloud and YouTube (runs if refresh returned no url OR if playing refreshed url failed)
              const { title: cleanT, artist: cleanA } = extractCleanTitleAndArtist(curr.title, curr.artistName);
                const fallbackQuery = `${cleanA ? `${cleanA} ` : ""}${cleanT}`.trim();
                if (fallbackQuery) {
                  const fallbackCandidates: Array<{
                    source: "soundcloud" | "youtube";
                    audioUrl: string;
                    pageUrl?: string;
                    coverUrl?: string;
                  }> = [];

                  const [scRes, ytRes] = await Promise.allSettled([
                    curr.source !== "soundcloud"
                      ? api.searchExternal(fallbackQuery, "soundcloud", 3)
                      : Promise.resolve({ results: [] as Track[] }),
                    api.searchExternal(fallbackQuery, "youtube", 3),
                  ]);

                  if (scRes.status === "fulfilled" && scRes.value.results) {
                    for (const r of scRes.value.results) {
                      if (
                        r.audioUrl &&
                        isMatchingExternalFallback(
                          curr.title,
                          curr.artistName,
                          r.title,
                          r.artistName,
                          curr.durationSec,
                          r.durationSec,
                        )
                      ) {
                        fallbackCandidates.push({
                          source: "soundcloud",
                          audioUrl: r.audioUrl,
                          pageUrl: r.pageUrl || curr.pageUrl,
                          coverUrl: r.coverUrl || curr.coverUrl,
                        });
                      }
                    }
                  }

                  const currentYtId = extractYouTubeIdClient(curr.pageUrl || curr.audioUrl || curr.id);
                  if (ytRes.status === "fulfilled" && ytRes.value.results) {
                    for (const r of ytRes.value.results) {
                      const rId = extractYouTubeIdClient(r.pageUrl || r.audioUrl || r.id);
                      if (
                        r.audioUrl &&
                        (!rId || rId !== currentYtId) &&
                        r.id !== curr.id &&
                        isMatchingExternalFallback(
                          curr.title,
                          curr.artistName,
                          r.title,
                          r.artistName,
                          curr.durationSec,
                          r.durationSec,
                        )
                      ) {
                        fallbackCandidates.push({
                          source: "youtube",
                          audioUrl: r.audioUrl,
                          pageUrl: r.pageUrl || curr.pageUrl,
                          coverUrl: r.coverUrl || curr.coverUrl,
                        });
                      }
                    }
                  }

                  if (curr.source === "soundcloud" && fallbackCandidates.length === 0) {
                    try {
                      const scSearch = await api.searchExternal(fallbackQuery, "soundcloud", 3);
                      if (scSearch.results) {
                        for (const r of scSearch.results) {
                          if (
                            r.audioUrl &&
                            r.audioUrl !== curr.audioUrl &&
                            isMatchingExternalFallback(
                              curr.title,
                              curr.artistName,
                              r.title,
                              r.artistName,
                              curr.durationSec,
                              r.durationSec,
                            )
                          ) {
                            fallbackCandidates.push({
                              source: "soundcloud",
                              audioUrl: r.audioUrl,
                              pageUrl: r.pageUrl || curr.pageUrl,
                              coverUrl: r.coverUrl || curr.coverUrl,
                            });
                          }
                        }
                      }
                    } catch {}
                  }

                  for (const candidate of fallbackCandidates) {
                    try {
                      const fallbackTrack: Track = {
                        ...curr,
                        source: candidate.source,
                        audioUrl: candidate.audioUrl,
                        pageUrl: candidate.pageUrl || curr.pageUrl,
                        coverUrl: candidate.coverUrl || curr.coverUrl,
                      };
                      currentTrackRef.current = fallbackTrack;
                      setCurrentTrack(fallbackTrack);
                      updateTrackInQueue(fallbackTrack);
                      externalTracksCache.set(curr.id, fallbackTrack);
                      const fbSource = resolveMediaUrl(fallbackTrack.audioUrl);
                      isSettingSourceRef.current = true;
                      audio.src = fbSource;
                      await audio.play();
                      isSettingSourceRef.current = false;
                      setIsPlaying(true);
                      isPlayingRef.current = true;
                      broadcastLeaderState();
                      broadcastCurrentState();
                      noticeTypeRef.current = null;
                      setOfflineNotice(null);
                      return;
                    } catch {}
                  }
                }
                setIsPlaying(false);
                isPlayingRef.current = false;
                setIsBuffering(false);
                isBufferingRef.current = false;
                broadcastLeaderState();
                noticeTypeRef.current = null;
                setOfflineNotice(null);
            })
            .catch(() => {
              setIsPlaying(false);
              isPlayingRef.current = false;
              setIsBuffering(false);
              isBufferingRef.current = false;
              broadcastLeaderState();
              noticeTypeRef.current = null;
              setOfflineNotice(null);
            });
          return;
        }
      }

      setIsPlaying(false);
      isPlayingRef.current = false;
      setIsBuffering(false);
      isBufferingRef.current = false;
      broadcastLeaderState();
      const isExternalFailed = isExternalTrack(curr);
      if (!isExternalFailed) {
        notifyServerConnectivityIssue();
        const isServerDown = getServerConnectivityStatus() === "vpn_or_server_down" || getServerConnectivityStatus() === "offline";
        noticeTypeRef.current = "stream";
        setOfflineNotice(
          isServerDown
            ? (lang === "fa"
                ? "عدم برقراری ارتباط با سرور - اتصال اینترنت یا وضعیت فیلترشکن خود را بررسی کنید"
                : "Cannot connect to server - check internet connection or VPN status")
            : (lang === "fa"
                ? "خطا در پخش قطعه صوتی آنلاین - لطفاً اتصال اینترنت یا وضعیت سرور را بررسی کنید"
                : "Error playing online audio track - please check connection or server status"),
        );
      } else {
        noticeTypeRef.current = null;
        setOfflineNotice(null);
      }
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("waiting", onStalledOrWaiting);
    audio.addEventListener("stalled", onStalledOrWaiting);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("error", onError);

    const unsubApp = subscribeToAppState((inFg) => {
      if (inFg && audio && !nativeAudioActiveRef.current) {
        currentTimeRef.current = audio.currentTime;
        setCurrentTime(audio.currentTime);
      }
    });

    return () => {
      // NOTE: Do not call audio.pause() here so soft client-side navigation
      // never stops playback!
      unsubApp();
      if (stallProbeTimerRef.current) {
        clearTimeout(stallProbeTimerRef.current);
        stallProbeTimerRef.current = null;
      }
      if (bufferingDebounceTimerRef.current) {
        clearTimeout(bufferingDebounceTimerRef.current);
        bufferingDebounceTimerRef.current = null;
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
  }, [audioDeckVersion, broadcastCurrentState, broadcastLeaderState, claimThisDevice, deviceId, getTabId, lang, notifyServerConnectivityIssue, savePlayerState, t, triggerExternalFallback, updateTrackInQueue]);

  // Intelligent Network Resilience subscription:
  // Keeps offline UI synced and automatically resumes interrupted playback when VPN/network returns.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const unsubscribe = subscribeNetworkResilience((event) => {
      setIsOffline(!event.isOnline);
      if (!event.isOnline) return;

      if (noticeTypeRef.current === "network") {
        setOfflineNotice(null);
        noticeTypeRef.current = null;
      }
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

      const isDownloaded = Boolean(resolveDownloadedTrackId(curr));
      const targetUrl = resolveMediaUrl(curr.audioUrl);
      if (!isDownloaded && targetUrl && !targetUrl.startsWith("blob:")) {
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
    if (audioDeckVersion < 0) return;
    const audio = getSingletonAudio();
    if (!audio) return;
    const onEnded = () => {
      if (audio !== getSingletonAudio()) return;
      if (autoMixStartedRef.current) {
        if (finalizeWebAutoMixRef.current) {
          finalizeWebAutoMixRef.current();
        }
        return;
      }
      next(true);
    };
    audio.addEventListener("ended", onEnded);
    return () => audio.removeEventListener("ended", onEnded);
  }, [audioDeckVersion, next]);

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
        const isPausedNow = nativeAudioActiveRef.current
          ? !isPlayingRef.current
          : Boolean(audio && audio.paused);
        // Never call togglePlay() if playback is already active or retrying/buffering,
        // otherwise togglePlay() would enter its pause branch and kill playback.
        if (isPausedNow && !isPlayingRef.current && !isRetryingPlayRef.current) {
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
        if (nativeAudioActiveRef.current) {
          void nativeAudioPause();
        }
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
        if (nativeAudioActiveRef.current) {
          nativeAudioActiveRef.current = false;
          void nativeAudioStop();
        }
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
        if (nativeAudioActiveRef.current) {
          void nativeAudioPause();
        }
        if (audio && !audio.paused) {
          audio.pause();
        }
        setIsPlaying(false);
        isPlayingRef.current = false;
        mediaActionsRef.current.broadcastLeaderState();
        mediaActionsRef.current.broadcastCurrentState();
      },
      onVolumeDuck: (duck) => {
        const targetVol = duck ? Math.max(0, volumeRef.current * 0.25) : mutedRef.current ? 0 : volumeRef.current;
        const audio = getSingletonAudio();
        if (audio) {
          audio.volume = targetVol;
        }
        if (nativeAudioActiveRef.current) {
          void nativeAudioSetVolume(targetVol);
        }
      },
    });

    return () => {
      cleanup();
    };
  }, []);

  // Subscribe to Native Android ExoPlayer state events
  useEffect(() => {
    if (!isNativeAudioAvailable()) return;
    const unsub = subscribeNativeAudioState((state) => {
      if (!nativeAudioActiveRef.current) return;

      if (state.event === "crossfadeStarted") {
        autoMixStartedRef.current = true;
        const outgoingTrack = currentTrackRef.current;
        const promoted =
          autoMixTargetTrackRef.current ||
          (state.trackId ? queueRef.current.find((t) => t.id === state.trackId) || null : null);
        setIsCrossfading(true);
        setCrossfadeFromTrack(outgoingTrack && promoted && outgoingTrack.id !== promoted.id ? outgoingTrack : null);
        if (promoted && currentTrackRef.current?.id !== promoted.id) {
          resetLyricsForTrackSwitch();
          recordedPlayForIdRef.current = null;
          currentTrackRef.current = promoted;
          setCurrentTrack(promoted);

          const newPos = typeof state.position === "number" && Number.isFinite(state.position) ? state.position : 0;
          const newDur =
            typeof state.duration === "number" && Number.isFinite(state.duration) && state.duration > 0
              ? state.duration
              : promoted.durationSec || 0;
          crossfadePositionFloorRef.current = newPos;
          crossfadePositionGuardUntilRef.current = Date.now() + 850;
          currentTimeRef.current = newPos;
          setCurrentTime(newPos);
          durationRef.current = newDur;
          setDuration(newDur);
          setCurrentlyPlayingTrackId(promoted.id);
          setIsPlaying(true);
          isPlayingRef.current = true;
          setIsBuffering(Boolean(state.isBuffering));
          isBufferingRef.current = Boolean(state.isBuffering);
          void loadLyricsForTrack(promoted.id, false);
          savePlayerState(newPos);
          broadcastLeaderState();
          broadcastCurrentState();
        }
        return;
      }

      if (state.event === "crossfadeFailed") {
        autoMixStartedRef.current = false;
        autoMixPreparedKeyRef.current = null;
        autoMixPreparingKeyRef.current = null;
        autoMixTargetTrackRef.current = null;
        autoMixPlanRef.current = null;
        autoMixPlanDurRef.current = 0;
        autoMixModeRef.current = null;
        setIsCrossfading(false);
        setCrossfadeFromTrack(null);
        if (
          !state.isPlaying &&
          durationRef.current > 0 &&
          currentTimeRef.current >= durationRef.current - 1.5
        ) {
          handlersRef.current.next(true);
        }
        return;
      }

      if (state.event === "crossfadeComplete") {
        const promoted =
          autoMixTargetTrackRef.current ||
          (state.trackId ? queueRef.current.find((t) => t.id === state.trackId) || null : null);
        autoMixStartedRef.current = false;
        autoMixPreparedKeyRef.current = null;
        autoMixPreparingKeyRef.current = null;
        autoMixTargetTrackRef.current = null;
        autoMixPlanRef.current = null;
        autoMixPlanDurRef.current = 0;
        autoMixModeRef.current = null;
        setIsCrossfading(false);
        setCrossfadeFromTrack(null);

        if (promoted && currentTrackRef.current?.id !== promoted.id) {
          resetLyricsForTrackSwitch();
          recordedPlayForIdRef.current = null;
          currentTrackRef.current = promoted;
          setCurrentTrack(promoted);

          const newPos = typeof state.position === "number" && Number.isFinite(state.position) ? state.position : 0;
          const newDur =
            typeof state.duration === "number" && Number.isFinite(state.duration) && state.duration > 0
              ? state.duration
              : promoted.durationSec || 0;
          currentTimeRef.current = newPos;
          setCurrentTime(newPos);
          durationRef.current = newDur;
          setDuration(newDur);
          setCurrentlyPlayingTrackId(promoted.id);
          setIsPlaying(true);
          isPlayingRef.current = true;
          setIsBuffering(Boolean(state.isBuffering));
          isBufferingRef.current = Boolean(state.isBuffering);
          void loadLyricsForTrack(promoted.id, false);
          savePlayerState(newPos);
          broadcastLeaderState();
          broadcastCurrentState();
        }
        return;
      }

      if (state.trackId && currentTrackRef.current && currentTrackRef.current.id !== state.trackId) {
        return;
      }
      const curr = currentTrackRef.current;

      if (typeof state.duration === "number" && Number.isFinite(state.duration) && state.duration > 0) {
        durationRef.current = state.duration;
        setDuration(state.duration);
      }
      if (typeof state.position === "number" && Number.isFinite(state.position) && state.position >= 0) {
        const inCrossfadeGuard =
          Date.now() < crossfadePositionGuardUntilRef.current &&
          Math.abs(state.position - crossfadePositionFloorRef.current) > 2.5;
        const stablePos = inCrossfadeGuard ? crossfadePositionFloorRef.current : state.position;
        if (!inCrossfadeGuard && Date.now() >= crossfadePositionGuardUntilRef.current) {
          crossfadePositionGuardUntilRef.current = 0;
        }
        currentTimeRef.current = stablePos;
        const inForeground = isAppInForeground() && (typeof document === "undefined" || !document.hidden);
        if (inForeground) {
          setCurrentTime(stablePos);
        }
        if (Math.abs(stablePos - lastSavedStateTimeRef.current) >= 5) {
          lastSavedStateTimeRef.current = stablePos;
          savePlayerState(stablePos);
        }
        if (curr && stablePos >= 3 && recordedPlayForIdRef.current !== curr.id) {
          recordedPlayForIdRef.current = curr.id;
          recordListeningEvent(curr);
          void api
            .recordPlay(curr.id)
            .then((res) => {
              setCurrentTrack((prev) =>
                prev?.id === curr.id ? { ...prev, playsCount: res.playsCount } : prev,
              );
            })
            .catch(() => {});
        }
        if (curr && isPlayingRef.current) {
          checkAutoMixProgressRef.current(
            stablePos,
            durationRef.current || curr.durationSec || 0,
          );
        }
      }

      if (state.event === "buffering") {
        if (!userPausedIntentRef.current) {
          setIsBuffering(true);
          isBufferingRef.current = true;
        }
      } else if (state.event === "ready") {
        setIsBuffering(false);
        isBufferingRef.current = false;
        reportNetworkSuccess();
        setOfflineNotice(null);
        if (typeof state.isPlaying === "boolean") {
          setIsPlaying(state.isPlaying);
          isPlayingRef.current = state.isPlaying;
        }
      } else if (state.event === "state") {
        if (typeof state.isBuffering === "boolean") {
          setIsBuffering(state.isBuffering);
          isBufferingRef.current = state.isBuffering;
        }
        if (typeof state.isPlaying === "boolean") {
          setIsPlaying(state.isPlaying);
          isPlayingRef.current = state.isPlaying;
        }
      } else if (state.event === "ended") {
        if (autoMixStartedRef.current) return;
        setIsBuffering(false);
        isBufferingRef.current = false;
        handlersRef.current.next(true);
      } else if (state.event === "error") {
        setIsBuffering(false);
        isBufferingRef.current = false;
        if (curr && isExternalTrack(curr)) {
          const retryCount = nativeErrorRetryCountRef.current[curr.id] || 0;
          if (retryCount === 3) {
            const rawHttp = resolveMediaUrl(curr.audioUrl);
            const webAudio = getSingletonAudio();
            if (
              webAudio &&
              rawHttp &&
              (rawHttp.startsWith("http://") || rawHttp.startsWith("https://"))
            ) {
              nativeErrorRetryCountRef.current[curr.id] = retryCount + 1;
              nativeAudioActiveRef.current = false;
              void nativeAudioStop();
              const resumePos = currentTimeRef.current > 3 ? currentTimeRef.current : 0;
              isSettingSourceRef.current = true;
              webAudio.src = rawHttp;
              try { webAudio.load(); } catch {}
              void attemptPlayWithRetry(webAudio, curr, false, rawHttp, resumePos, true);
              return;
            }
          }
          if (retryCount < 4) {
            nativeErrorRetryCountRef.current[curr.id] = retryCount + 1;
            const resumePos = currentTimeRef.current > 3 ? currentTimeRef.current : 0;
            void triggerExternalFallback(curr, resumePos).then((recovered) => {
              if (!recovered && currentTrackRef.current?.id === curr.id) {
                setIsPlaying(false);
                isPlayingRef.current = false;
                noticeTypeRef.current = "stream";
                setOfflineNotice(
                  lang === "fa"
                    ? "این قطعه در حال حاضر قابل پخش نیست"
                    : "This track is currently unavailable for playback",
                );
              }
            });
            return;
          }
        }
        setIsPlaying(false);
        isPlayingRef.current = false;
        if (curr && isExternalTrack(curr)) {
          noticeTypeRef.current = "stream";
          setOfflineNotice(
            lang === "fa"
              ? "این قطعه در حال حاضر قابل پخش نیست"
              : "This track is currently unavailable for playback",
          );
        }
      }
    });
    return unsub;
  }, [attemptPlayWithRetry, broadcastCurrentState, broadcastLeaderState, lang, loadLyricsForTrack, resetLyricsForTrackSwitch, savePlayerState, triggerExternalFallback]);

  // Synchronize Metadata whenever currentTrack changes
  useEffect(() => {
    if (!currentTrack) return;
    let active = true;
    const rawNonBlobCover =
      currentTrack.coverUrl && !currentTrack.coverUrl.startsWith("blob:")
        ? currentTrack.coverUrl
        : originalCoverUrlsRef.current[currentTrack.id] || "";
    const resolvedCover = rawNonBlobCover ? resolveMediaUrl(rawNonBlobCover) : "";
    let artworkSrc = "";
    try {
      artworkSrc = resolvedCover && !resolvedCover.startsWith("blob:")
        ? new URL(resolvedCover, window.location.origin).toString()
        : "";
    } catch {
      artworkSrc = resolvedCover && !resolvedCover.startsWith("blob:") ? resolvedCover : "";
    }

    const syncMetadata = async () => {
      // Prefer offline downloaded cover artwork (converted to compact JPEG data URI)
      // so downloaded tracks display album art reliably in Android notification shade even offline.
      let finalArtwork = artworkSrc;
      const blobCover =
        currentTrack.coverUrl && currentTrack.coverUrl.startsWith("blob:")
          ? currentTrack.coverUrl
          : getCachedCoverBlobUrl(currentTrack.id) || (await getDownloadedCoverBlobUrl(currentTrack.id).catch(() => null));
      if (blobCover) {
        const inlineData = await blobUrlToJpegDataUrl(blobCover, 256);
        if (inlineData) {
          finalArtwork = inlineData;
        }
      }
      if (!active) return;

      void updateAndroidMediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artistName,
        album: currentTrack.album,
        coverUrl: finalArtwork,
        duration: currentTrack.durationSec || duration,
        trackId: currentTrack.id,
      });
    };

    void syncMetadata();
    return () => {
      active = false;
    };
  }, [currentTrack, duration]);

  // Keep Native ExoPlayer Repeat Mode synchronized with repeat toggle
  useEffect(() => {
    if (isNativeAudioAvailable()) {
      void nativeAudioSetRepeatMode(repeat);
    }
  }, [repeat]);

  // Synchronize Playback State whenever isPlaying, duration, or playbackRate changes (WebView <audio> only)
  useEffect(() => {
    if (nativeAudioActiveRef.current) return;
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
          (Boolean(resolveDownloadedTrackId(effectiveCurrentTrack)) ||
            getCachedAudioBlobUrl(effectiveCurrentTrack.id) !== null),
      ),
      isBuffering,
      isCrossfading,
      crossfadeFromTrack,
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
      isBuffering,
      isCrossfading,
      crossfadeFromTrack,
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
