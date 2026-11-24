/**
 * Native Android Media3 ExoPlayer Bridge
 *
 * Routes online external streams (YouTube, SoundCloud, Spotify) and remote catalog
 * streams directly through Android's hardware ExoPlayer engine inside SoundifyMediaService
 * for rapid 500ms playback startup, resilient cross-protocol redirects, and uninterrupted
 * lockscreen/background playback.
 */

import { isAndroidNative } from "./androidBridge";
import type { AutoMixPlan as Stage5AutoMixPlan } from "./autoMixEngine";

export interface NativePlayStreamOptions {
  url: string;
  authToken?: string;
  startSec?: number;
  playbackRate?: number;
  volume?: number;
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
  trackId?: string;
}

export interface NativeAudioStateEvent {
  event: "buffering" | "ready" | "state" | "ended" | "error" | "crossfadeStarted" | "crossfadeComplete" | "crossfadeFailed" | "trackChanged";
  active?: boolean;
  trackId?: string;
  title?: string;
  artist?: string;
  coverUrl?: string;
  queueIndex?: number;
  repeatMode?: "off" | "all" | "one";
  shuffle?: boolean;
  isPlaying?: boolean;
  isBuffering?: boolean;
  position?: number;
  duration?: number;
  playbackRate?: number;
  errorCode?: number;
  errorMessage?: string;
}

export interface NativeQueueTrackItem {
  id: string;
  url: string;
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
}

export interface NativePrepareNextOptions {
  url: string;
  authToken?: string;
  startSec?: number;
  playbackRate?: number;
  trackId?: string;
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
}

export interface NativeStartCrossfadeOptions {
  crossfadeMs: number;
  volume?: number;
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
  trackId?: string;
}

export interface NativeScheduleAutoMixPlanOptions extends Stage5AutoMixPlan {
  sampleRate?: number;
  volume?: number;
  title?: string;
  artist?: string;
  album?: string;
  coverUrl?: string;
  duration?: number;
}

export interface AudioOutputDeviceInfo {
  kind: "speaker" | "bluetooth" | "wired" | "usb";
  name: string;
  permissionNeeded?: boolean;
}

interface NativeAudioPluginInterface {
  playStream?: (opts: NativePlayStreamOptions) => Promise<void>;
  prepareNextStream?: (opts: NativePrepareNextOptions) => Promise<void>;
  startCrossfade?: (opts: NativeStartCrossfadeOptions) => Promise<void>;
  scheduleAutoMixPlan?: (opts: NativeScheduleAutoMixPlanOptions) => Promise<void>;
  cancelCrossfade?: () => Promise<void>;
  fadeOutAndStop?: (opts: { fadeMs: number }) => Promise<void>;
  play?: () => Promise<void>;
  pause?: () => Promise<void>;
  stop?: () => Promise<void>;
  seek?: (opts: { position: number }) => Promise<void>;
  setRepeatMode?: (opts: { mode: string }) => Promise<void>;
  syncQueue?: (opts: {
    queueJson: string;
    currentIndex: number;
    currentTrackId: string;
    shuffle: boolean;
    repeatMode: string;
    autoMixEnabled: boolean;
    authToken?: string;
  }) => Promise<void>;
  setAutoMixEnabled?: (opts: { enabled: boolean }) => Promise<void>;
  replay?: () => Promise<void>;
  setVolume?: (opts: { volume: number }) => Promise<void>;
  setPlaybackRate?: (opts: { rate: number }) => Promise<void>;
  getState?: () => Promise<Record<string, unknown>>;
  getAudioOutputDevice?: () => Promise<AudioOutputDeviceInfo>;
  requestBluetoothPermission?: () => Promise<AudioOutputDeviceInfo>;
  addListener?: {
    (
      eventName: "nativeAudioState",
      listener: (event: NativeAudioStateEvent) => void,
    ): Promise<{ remove: () => Promise<void> }> | { remove: () => void };
    (
      eventName: "audioOutputChanged",
      listener: (event: AudioOutputDeviceInfo) => void,
    ): Promise<{ remove: () => Promise<void> }> | { remove: () => void };
  };
}

function getNativeAudioPlugin(): NativeAudioPluginInterface | null {
  if (typeof window === "undefined") return null;
  const plugins = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor?.Plugins;
  if (plugins && "NativeAudioPlugin" in plugins) {
    return plugins.NativeAudioPlugin as NativeAudioPluginInterface;
  }
  return null;
}

export function isNativeAudioAvailable(): boolean {
  return isAndroidNative() && Boolean(getNativeAudioPlugin()?.playStream);
}

export async function nativeAudioPlayStream(opts: NativePlayStreamOptions): Promise<boolean> {
  const plugin = getNativeAudioPlugin();
  if (!plugin?.playStream) return false;
  await plugin.playStream(opts);
  return true;
}

export async function nativeAudioPrepareNextStream(opts: NativePrepareNextOptions): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.prepareNextStream) {
    await plugin.prepareNextStream(opts).catch(() => {});
  }
}

export async function nativeAudioStartCrossfade(opts: NativeStartCrossfadeOptions): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.startCrossfade) {
    await plugin.startCrossfade(opts).catch(() => {});
  }
}

export async function nativeAudioScheduleAutoMixPlan(opts: NativeScheduleAutoMixPlanOptions): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.scheduleAutoMixPlan) {
    await plugin.scheduleAutoMixPlan(opts).catch(() => {});
  }
}

export async function nativeAudioCancelCrossfade(): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.cancelCrossfade) {
    await plugin.cancelCrossfade().catch(() => {});
  }
}

export async function nativeAudioFadeOutAndStop(fadeMs: number): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.fadeOutAndStop) {
    await plugin.fadeOutAndStop({ fadeMs: Math.max(400, Math.round(fadeMs)) }).catch(() => {});
  } else if (plugin?.stop) {
    await plugin.stop().catch(() => {});
  }
}

export async function nativeAudioPlay(): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.play) {
    await plugin.play().catch(() => {});
  }
}

export async function nativeAudioPause(): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.pause) {
    await plugin.pause().catch(() => {});
  }
}

export async function nativeAudioStop(): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.stop) {
    await plugin.stop().catch(() => {});
  }
}

export async function nativeAudioSeek(position: number): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.seek) {
    await plugin.seek({ position }).catch(() => {});
  }
}

export async function nativeAudioSetRepeatMode(mode: "off" | "all" | "one"): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.setRepeatMode) {
    await plugin.setRepeatMode({ mode }).catch(() => {});
  }
}

export async function nativeAudioSyncQueue(opts: {
  queue: NativeQueueTrackItem[];
  currentIndex: number;
  currentTrackId: string;
  shuffle: boolean;
  repeatMode: "off" | "all" | "one";
  autoMixEnabled: boolean;
  authToken?: string;
}): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.syncQueue) {
    await plugin
      .syncQueue({
        queueJson: JSON.stringify(opts.queue),
        currentIndex: opts.currentIndex,
        currentTrackId: opts.currentTrackId,
        shuffle: opts.shuffle,
        repeatMode: opts.repeatMode,
        autoMixEnabled: opts.autoMixEnabled,
        authToken: opts.authToken || "",
      })
      .catch(() => {});
  }
}

export async function nativeAudioSetAutoMixEnabled(enabled: boolean): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.setAutoMixEnabled) {
    await plugin.setAutoMixEnabled({ enabled: Boolean(enabled) }).catch(() => {});
  }
}

export async function nativeAudioGetState(): Promise<NativeAudioStateEvent | null> {
  const plugin = getNativeAudioPlugin();
  if (!plugin?.getState) return null;
  try {
    const raw = await plugin.getState();
    return raw ? (raw as unknown as NativeAudioStateEvent) : null;
  } catch {
    return null;
  }
}

export async function nativeAudioReplay(): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.replay) {
    await plugin.replay().catch(() => {});
  }
}

export async function nativeAudioSetVolume(volume: number): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.setVolume) {
    await plugin.setVolume({ volume: Math.max(0, Math.min(1, volume)) }).catch(() => {});
  }
}

export async function nativeAudioSetPlaybackRate(rate: number): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.setPlaybackRate) {
    await plugin.setPlaybackRate({ rate }).catch(() => {});
  }
}

export function subscribeNativeAudioState(
  listener: (event: NativeAudioStateEvent) => void,
): () => void {
  const plugin = getNativeAudioPlugin();
  if (!plugin?.addListener) return () => {};
  try {
    const res = plugin.addListener("nativeAudioState", listener);
    return () => {
      try {
        if (res && "then" in res) {
          void (res as Promise<{ remove: () => Promise<void> }>).then((h) => h.remove()).catch(() => {});
        } else if (res && "remove" in res) {
          (res as { remove: () => void }).remove();
        }
      } catch {}
    };
  } catch {
    return () => {};
  }
}

export async function getNativeAudioOutputDevice(): Promise<AudioOutputDeviceInfo> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.getAudioOutputDevice) {
    try {
      const res = await plugin.getAudioOutputDevice();
      if (res && res.kind) return res;
    } catch {}
  }
  return { kind: "speaker", name: "" };
}

export async function requestNativeBluetoothPermission(): Promise<AudioOutputDeviceInfo> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.requestBluetoothPermission) {
    try {
      const res = await plugin.requestBluetoothPermission();
      if (res && res.kind) return res;
    } catch {}
  }
  return getNativeAudioOutputDevice();
}

export function subscribeNativeAudioOutput(
  listener: (event: AudioOutputDeviceInfo) => void,
): () => void {
  const plugin = getNativeAudioPlugin();
  if (!plugin?.addListener) return () => {};
  try {
    const res = plugin.addListener("audioOutputChanged", listener);
    return () => {
      try {
        if (res && "then" in res) {
          void (res as Promise<{ remove: () => Promise<void> }>).then((h) => h.remove()).catch(() => {});
        } else if (res && "remove" in res) {
          (res as { remove: () => void }).remove();
        }
      } catch {}
    };
  } catch {
    return () => {};
  }
}
