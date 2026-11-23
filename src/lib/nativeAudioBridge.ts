/**
 * Native Android Media3 ExoPlayer Bridge
 *
 * Routes online external streams (YouTube, SoundCloud, Spotify) and remote catalog
 * streams directly through Android's hardware ExoPlayer engine inside SoundifyMediaService
 * for rapid 500ms playback startup, resilient cross-protocol redirects, and uninterrupted
 * lockscreen/background playback.
 */

import { isAndroidNative } from "./androidBridge";

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
  event: "buffering" | "ready" | "state" | "ended" | "error" | "crossfadeStarted" | "crossfadeComplete";
  active?: boolean;
  trackId?: string;
  isPlaying?: boolean;
  isBuffering?: boolean;
  position?: number;
  duration?: number;
  playbackRate?: number;
  errorCode?: number;
  errorMessage?: string;
}

export interface NativePrepareNextOptions {
  url: string;
  authToken?: string;
  startSec?: number;
  playbackRate?: number;
  trackId?: string;
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

interface NativeAudioPluginInterface {
  playStream?: (opts: NativePlayStreamOptions) => Promise<void>;
  prepareNextStream?: (opts: NativePrepareNextOptions) => Promise<void>;
  startCrossfade?: (opts: NativeStartCrossfadeOptions) => Promise<void>;
  cancelCrossfade?: () => Promise<void>;
  play?: () => Promise<void>;
  pause?: () => Promise<void>;
  stop?: () => Promise<void>;
  seek?: (opts: { position: number }) => Promise<void>;
  setVolume?: (opts: { volume: number }) => Promise<void>;
  setPlaybackRate?: (opts: { rate: number }) => Promise<void>;
  getState?: () => Promise<Record<string, unknown>>;
  addListener?: (
    eventName: "nativeAudioState",
    listener: (event: NativeAudioStateEvent) => void,
  ) => Promise<{ remove: () => Promise<void> }> | { remove: () => void };
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

export async function nativeAudioCancelCrossfade(): Promise<void> {
  const plugin = getNativeAudioPlugin();
  if (plugin?.cancelCrossfade) {
    await plugin.cancelCrossfade().catch(() => {});
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
