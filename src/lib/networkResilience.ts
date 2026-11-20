/**
 * Intelligent Network Resilience & Auto-Recovery Service
 *
 * Designed specifically for unstable mobile networks, high packet loss, DNS jitter,
 * and frequent VPN toggles (V2Ray, Shadowsocks, WireGuard, Outline, Psiphon).
 *
 * Key capabilities:
 * 1. Active fast probing against the backend instead of blindly trusting Android WebView's
 *    unreliable `navigator.onLine` (which frequently gets stuck on `false` under VPNs).
 * 2. High-frequency recovery probing (1.5s intervals) when disconnected so VPN reconnects
 *    or cellular handovers are detected in under 2 seconds.
 * 3. Battery-friendly idle heartbeat when healthy and visible (paused in background).
 * 4. Automatic playback intent preservation and resurrection when connectivity returns.
 */

import {
  resolveApiUrl,
  setServerConnectivityStatus,
  getServerConnectivityStatus,
} from "./mobileBackend";

export type ResilienceStatus = "online" | "degraded" | "offline";

export interface NetworkResilienceEvent {
  isOnline: boolean;
  status: ResilienceStatus;
  recovered: boolean;
  latencyMs?: number;
}

export interface PreservedPlaybackIntent {
  trackId: string;
  currentTime: number;
  intendedPlaying: boolean;
  timestamp: number;
}

type ResilienceListener = (event: NetworkResilienceEvent) => void;

const PROBE_TIMEOUT_MS = 5500;
const FAST_RECOVERY_INTERVAL_MS = 1500;
const STEADY_RECOVERY_INTERVAL_MS = 3500;
const HEALTHY_HEARTBEAT_INTERVAL_MS = 18000;
const MAX_FAST_PROBES = 10;

class NetworkResilienceManager {
  private status: ResilienceStatus = "online";
  private consecutiveFailures = 0;
  private recoveryAttempts = 0;
  private lastSuccessAt = Date.now();
  private lastLatencyMs: number | undefined = undefined;
  private inFlightProbe: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private listeners = new Set<ResilienceListener>();
  private preservedIntent: PreservedPlaybackIntent | null = null;

  private boundOnline = () => {
    this.recoveryAttempts = 0;
    void this.probeNow(true);
  };

  private boundOffline = () => {
    // Do NOT immediately hard-lock to offline on Android WebView (VPNs trigger spurious offline events).
    // Instead, immediately run an active probe to verify real reachability.
    this.recoveryAttempts = 0;
    void this.probeNow(false);
  };

  private boundVisibility = () => {
    if (typeof document === "undefined") return;
    if (document.visibilityState === "visible") {
      this.recoveryAttempts = 0;
      void this.probeNow(false);
    } else {
      this.clearTimer();
    }
  };

  private boundConnectionChange = () => {
    this.recoveryAttempts = 0;
    void this.probeNow(false);
  };

  public start(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;

    window.addEventListener("online", this.boundOnline);
    window.addEventListener("offline", this.boundOffline);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.boundVisibility);
    }

    const nav = navigator as Navigator & {
      connection?: EventTarget & { addEventListener?: (t: string, cb: () => void) => void };
    };
    if (nav?.connection && typeof nav.connection.addEventListener === "function") {
      nav.connection.addEventListener("change", this.boundConnectionChange);
    }

    // Schedule initial lightweight heartbeat without blocking startup
    this.scheduleNextProbe(HEALTHY_HEARTBEAT_INTERVAL_MS);
  }

  public stop(): void {
    if (!this.started || typeof window === "undefined") return;
    this.started = false;
    this.clearTimer();

    window.removeEventListener("online", this.boundOnline);
    window.removeEventListener("offline", this.boundOffline);

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.boundVisibility);
    }

    const nav = navigator as Navigator & {
      connection?: EventTarget & { removeEventListener?: (t: string, cb: () => void) => void };
    };
    if (nav?.connection && typeof nav.connection.removeEventListener === "function") {
      nav.connection.removeEventListener("change", this.boundConnectionChange);
    }
  }

  public getStatus(): ResilienceStatus {
    return this.status;
  }

  /**
   * Returns true only when active probing has confirmed we are offline
   * (or navigator.onLine is false AND we have recent consecutive probe failures).
   * Never falsely blocks playback on a fresh VPN toggle.
   */
  public isEffectivelyOffline(): boolean {
    if (getServerConnectivityStatus() === "online") return false;
    if (this.status === "offline") return true;
    if (
      typeof navigator !== "undefined" &&
      navigator.onLine === false &&
      this.consecutiveFailures >= 2
    ) {
      return true;
    }
    return false;
  }

  public isEffectivelyOnline(): boolean {
    return !this.isEffectivelyOffline();
  }

  public getLastSuccessAt(): number {
    return this.lastSuccessAt;
  }

  public getLastLatencyMs(): number | undefined {
    return this.lastLatencyMs;
  }

  /**
   * Notify manager that an API or audio request succeeded so we immediately transition to online.
   */
  public reportNetworkSuccess(latencyMs?: number): void {
    const wasDown = this.status !== "online";
    this.consecutiveFailures = 0;
    this.recoveryAttempts = 0;
    this.lastSuccessAt = Date.now();
    if (typeof latencyMs === "number") {
      this.lastLatencyMs = latencyMs;
    }
    this.status = "online";
    setServerConnectivityStatus("online");

    if (wasDown) {
      this.emit({
        isOnline: true,
        status: "online",
        recovered: true,
        latencyMs: this.lastLatencyMs,
      });
    }

    if (this.started) {
      this.scheduleNextProbe(HEALTHY_HEARTBEAT_INTERVAL_MS);
    }
  }

  /**
   * Notify manager that an audio stream or network request failed.
   * Triggers immediate fast probing to determine whether this is a brief VPN jitter or full drop.
   */
  public reportNetworkFailure(): void {
    this.consecutiveFailures += 1;
    if (this.status === "online") {
      this.status = "degraded";
    }
    if (this.started) {
      void this.probeNow(false);
    }
  }

  public subscribe(listener: ResilienceListener): () => void {
    this.listeners.add(listener);
    if (!this.started && typeof window !== "undefined") {
      this.start();
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  public preservePlaybackIntent(trackId: string, currentTime: number, intendedPlaying: boolean): void {
    if (!trackId) return;
    this.preservedIntent = {
      trackId,
      currentTime: Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0,
      intendedPlaying,
      timestamp: Date.now(),
    };
  }

  public getPreservedPlaybackIntent(): PreservedPlaybackIntent | null {
    if (!this.preservedIntent) return null;
    // Expire stale intents older than 15 minutes
    if (Date.now() - this.preservedIntent.timestamp > 15 * 60 * 1000) {
      this.preservedIntent = null;
      return null;
    }
    return this.preservedIntent;
  }

  public clearPreservedPlaybackIntent(): void {
    this.preservedIntent = null;
  }

  /**
   * Executes an active lightweight connectivity probe against the Soundify backend.
   * Deduplicates concurrent probes.
   */
  public async probeNow(preferFastRecovery = false): Promise<boolean> {
    if (typeof fetch === "undefined") {
      return true;
    }

    if (this.inFlightProbe) {
      return this.inFlightProbe;
    }

    this.inFlightProbe = this.executeProbe(preferFastRecovery).finally(() => {
      this.inFlightProbe = null;
    });

    return this.inFlightProbe;
  }

  private async executeProbe(preferFastRecovery: boolean): Promise<boolean> {
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    const endpoints = [
      resolveApiUrl(`/api/mobile/status?_ping=${Date.now()}`),
      resolveApiUrl(`/api/health?_ping=${Date.now()}`),
    ];

    for (const url of endpoints) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        // Any HTTP response from our server (even 401/404/503) proves network reachability
        if (res.status > 0 && res.status < 500) {
          const latencyMs = Math.round(
            (typeof performance !== "undefined" ? performance.now() : Date.now()) - start,
          );
          this.reportNetworkSuccess(latencyMs);
          return true;
        }
      } catch {
        clearTimeout(timeoutId);
      }
    }

    // Both endpoints failed to reach the server
    this.consecutiveFailures += 1;
    this.recoveryAttempts += 1;

    const prevStatus = this.status;
    const isBrowserOnline =
      typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
        ? navigator.onLine
        : true;

    if (this.consecutiveFailures >= 2 || !isBrowserOnline) {
      this.status = "offline";
      const nextBackendStatus = isBrowserOnline ? "vpn_or_server_down" : "offline";
      if (getServerConnectivityStatus() !== nextBackendStatus) {
        setServerConnectivityStatus(nextBackendStatus);
      }
    } else {
      this.status = "degraded";
    }

    if (prevStatus !== this.status) {
      this.emit({
        isOnline: false,
        status: this.status,
        recovered: false,
      });
    }

    // Schedule rapid recovery probe so VPN reconnects are caught in ~1.5s
    if (this.started) {
      const nextDelay =
        preferFastRecovery || this.recoveryAttempts <= MAX_FAST_PROBES
          ? FAST_RECOVERY_INTERVAL_MS
          : STEADY_RECOVERY_INTERVAL_MS;
      this.scheduleNextProbe(nextDelay);
    }

    return false;
  }

  private scheduleNextProbe(delayMs: number): void {
    this.clearTimer();
    if (typeof document !== "undefined" && document.hidden) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.probeNow(false);
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private emit(event: NetworkResilienceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Isolate subscriber errors
      }
    }
  }

  public resetForTests(): void {
    this.stop();
    this.status = "online";
    this.consecutiveFailures = 0;
    this.recoveryAttempts = 0;
    this.lastSuccessAt = Date.now();
    this.lastLatencyMs = undefined;
    this.inFlightProbe = null;
    this.listeners.clear();
    this.preservedIntent = null;
  }
}

const networkResilience = new NetworkResilienceManager();

export function getNetworkResilience(): NetworkResilienceManager {
  return networkResilience;
}

export function startNetworkResilience(): void {
  networkResilience.start();
}

export function isNetworkEffectivelyOffline(): boolean {
  return networkResilience.isEffectivelyOffline();
}

export function isNetworkEffectivelyOnline(): boolean {
  return networkResilience.isEffectivelyOnline();
}

export function triggerImmediateNetworkProbe(): Promise<boolean> {
  return networkResilience.probeNow(true);
}

export function subscribeNetworkResilience(listener: ResilienceListener): () => void {
  return networkResilience.subscribe(listener);
}

export function reportNetworkSuccess(latencyMs?: number): void {
  networkResilience.reportNetworkSuccess(latencyMs);
}

export function reportNetworkFailure(): void {
  networkResilience.reportNetworkFailure();
}

export function preservePlaybackIntent(
  trackId: string,
  currentTime: number,
  intendedPlaying: boolean,
): void {
  networkResilience.preservePlaybackIntent(trackId, currentTime, intendedPlaying);
}

export function getPreservedPlaybackIntent(): PreservedPlaybackIntent | null {
  return networkResilience.getPreservedPlaybackIntent();
}

export function clearPreservedPlaybackIntent(): void {
  networkResilience.clearPreservedPlaybackIntent();
}

export function resetNetworkResilienceForTests(): void {
  networkResilience.resetForTests();
}
