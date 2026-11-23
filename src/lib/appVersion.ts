/**
 * Single Source of Truth for Soundify Android Application Version.
 * Automatically kept in sync with package.json, android/app/build.gradle, and public/sw.js
 * via `scripts/bump-version.mjs`.
 */
export const APP_VERSION = "1.0.25";
export const APP_BUILD_NUMBER = 26;
export const APP_CHANNEL = "Android";

/**
 * Minimum version enforced by Soundify Backend (v1.0.15+)
 * Lower versions receive HTTP 426 Upgrade Required.
 */
export const MIN_SERVER_SUPPORTED_VERSION = "1.0.15";

export interface AppUpdateRequiredInfo {
  minSupportedVersion?: string;
  message?: string;
  messageFa?: string;
  messageEn?: string;
}

type UpdateListener = (info: AppUpdateRequiredInfo) => void;
const updateListeners = new Set<UpdateListener>();
let latestUpdateInfo: AppUpdateRequiredInfo | null = null;

export function triggerAppUpdateRequired(info: AppUpdateRequiredInfo): void {
  latestUpdateInfo = info;
  updateListeners.forEach((fn) => {
    try {
      fn(info);
    } catch {}
  });
}

export function subscribeAppUpdateRequired(fn: UpdateListener): () => void {
  updateListeners.add(fn);
  if (latestUpdateInfo) {
    try {
      fn(latestUpdateInfo);
    } catch {}
  }
  return () => {
    updateListeners.delete(fn);
  };
}

export function getLatestAppUpdateInfo(): AppUpdateRequiredInfo | null {
  return latestUpdateInfo;
}

export function clearAppUpdateRequired(): void {
  latestUpdateInfo = null;
}
