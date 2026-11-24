"use client";

import { useSyncExternalStore } from "react";

export type SleepTimerMode = "off" | "after_song" | "countdown";

export interface SleepTimerState {
  mode: SleepTimerMode;
  endsAtMs: number | null;
  remainingSec: number;
  fadeOut: boolean;
  afterSongTrackId: string | null;
}

const DEFAULT_STATE: SleepTimerState = {
  mode: "off",
  endsAtMs: null,
  remainingSec: 0,
  fadeOut: true,
  afterSongTrackId: null,
};

let state: SleepTimerState = { ...DEFAULT_STATE };
const listeners = new Set<() => void>();
let intervalId: number | null = null;
let onExpireCallback: ((fadeOut: boolean) => void) | null = null;

function notify() {
  for (const l of listeners) l();
}

function stopTicker() {
  if (intervalId !== null && typeof window !== "undefined") {
    window.clearInterval(intervalId);
    intervalId = null;
  }
}

function ensureTicker() {
  if (typeof window === "undefined" || intervalId !== null) return;
  intervalId = window.setInterval(() => {
    if (state.mode !== "countdown" || !state.endsAtMs) {
      stopTicker();
      return;
    }
    const left = Math.max(0, Math.ceil((state.endsAtMs - Date.now()) / 1000));
    if (left <= 0) {
      const shouldFade = state.fadeOut;
      state = { ...DEFAULT_STATE, fadeOut: state.fadeOut };
      stopTicker();
      notify();
      onExpireCallback?.(shouldFade);
      return;
    }
    if (left !== state.remainingSec) {
      state = { ...state, remainingSec: left };
      notify();
    }
  }, 500);
}

export function registerSleepTimerExpireHandler(cb: ((fadeOut: boolean) => void) | null): void {
  onExpireCallback = cb;
}

export function notifySleepTimerTrackChanged(nextTrackId: string | undefined): void {
  if (state.mode !== "after_song") return;
  if (state.afterSongTrackId && nextTrackId && nextTrackId !== state.afterSongTrackId) {
    const shouldFade = state.fadeOut;
    state = { ...DEFAULT_STATE, fadeOut: state.fadeOut };
    notify();
    onExpireCallback?.(shouldFade);
  }
}

export function startSleepTimerMinutes(minutes: number): void {
  const safeMin = Math.max(1, Math.min(480, Math.round(minutes)));
  const endsAtMs = Date.now() + safeMin * 60 * 1000;
  state = {
    ...state,
    mode: "countdown",
    endsAtMs,
    remainingSec: safeMin * 60,
    afterSongTrackId: null,
  };
  ensureTicker();
  notify();
}

export function startSleepTimerAfterCurrentSong(currentTrackId: string | undefined): void {
  stopTicker();
  state = {
    ...state,
    mode: "after_song",
    endsAtMs: null,
    remainingSec: 0,
    afterSongTrackId: currentTrackId || "__pending__",
  };
  notify();
}

export function setSleepTimerFadeOut(fadeOut: boolean): void {
  state = { ...state, fadeOut };
  notify();
}

export function cancelSleepTimer(): void {
  stopTicker();
  state = { ...DEFAULT_STATE, fadeOut: state.fadeOut };
  notify();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): SleepTimerState {
  return state;
}

export function useSleepTimer(): SleepTimerState {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_STATE);
}
