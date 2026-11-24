"use client";

import { useCallback, useSyncExternalStore } from "react";

export const BITCHORD_DESIGN_STORAGE_KEY = "soundify_ui_bitchord_v1";
export const BITCHORD_DESIGN_EVENT = "soundify-bitchord-design-change";

let cachedBootState: boolean | null = null;

export function getBitChordDesignPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(BITCHORD_DESIGN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function setBitChordDesignPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) {
      window.localStorage.setItem(BITCHORD_DESIGN_STORAGE_KEY, "true");
    } else {
      window.localStorage.setItem(BITCHORD_DESIGN_STORAGE_KEY, "false");
    }
    window.dispatchEvent(new Event(BITCHORD_DESIGN_EVENT));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

function subscribeDesignPreference(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === BITCHORD_DESIGN_STORAGE_KEY) onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(BITCHORD_DESIGN_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(BITCHORD_DESIGN_EVENT, onStoreChange);
  };
}

export function useBitChordDesignPreference(): [boolean, (next: boolean) => void] {
  const pref = useSyncExternalStore(
    subscribeDesignPreference,
    getBitChordDesignPreference,
    () => false,
  );

  const setPref = useCallback((next: boolean) => {
    setBitChordDesignPreference(next);
  }, []);

  return [pref, setPref];
}

/**
 * Returns whether the current app session booted into BitChord UI mode.
 * Locked at startup so toggling in Settings cleanly prompts for an app restart
 * without jarring mid-session layout mutations.
 */
export function isBitChordBootActive(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }
  if (cachedBootState !== null) {
    return cachedBootState;
  }
  const attr = document.documentElement.getAttribute("data-ui-skin");
  if (attr === "bitchord") {
    cachedBootState = true;
    return true;
  }
  const pref = getBitChordDesignPreference();
  if (pref) {
    document.documentElement.setAttribute("data-ui-skin", "bitchord");
  }
  cachedBootState = pref;
  return pref;
}

export function restartAppForDesignChange(): void {
  if (typeof window === "undefined") return;
  cachedBootState = null;
  window.location.reload();
}
