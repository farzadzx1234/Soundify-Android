"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, getApiToken, normalizeTrack, resolveApiUrl } from "@/lib/api";
import { isAndroidNative } from "@/lib/androidBridge";
import { APP_VERSION } from "@/lib/appVersion";
import { getOrCreateDeviceId } from "@/lib/mobileSync";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { localizeDeviceName } from "@/lib/deviceFormatter";
import { runAfterInitialPaint, scheduleDeferredInterval } from "@/lib/startupScheduler";
import { reportNetworkFailure, reportNetworkSuccess, subscribeNetworkResilience } from "@/lib/networkResilience";
import type { DeviceInfo, PlaybackStateSync, Track } from "@/lib/types";

export interface ClaimDevicePlaybackPayload {
  track?: Track | null;
  trackId?: string | null;
  isPlaying?: boolean;
  currentTime?: number;
  duration?: number;
  volume?: number;
  repeat?: "off" | "all" | "one";
  shuffle?: boolean;
}

export interface DeviceSyncContextValue {
  deviceId: string;
  deviceName: string;
  deviceType: "desktop" | "smartphone" | "tablet" | "browser" | "speaker";
  devices: DeviceInfo[];
  activeDeviceId: string | null;
  setActiveDeviceId: (id: string | null) => void;
  isThisDeviceActive: boolean;
  isRemotePlaybackActive: boolean;
  activeDeviceName: string;
  localizedActiveDeviceName: string;
  isRefreshing: boolean;
  syncState: PlaybackStateSync | null;
  devicePickerOpen: boolean;
  setDevicePickerOpen: (open: boolean) => void;
  toggleDevicePicker: () => void;
  isSyncEnabled: boolean;
  toggleSyncEnabled: () => void;
  refreshDevices: () => Promise<void>;
  claimThisDevice: (playback?: ClaimDevicePlaybackPayload) => Promise<void>;
  transferToThisDevice: (payload?: { currentTime?: number; trackId?: string; isPlaying?: boolean }) => Promise<void>;
  transferToDevice: (targetDeviceId: string, payload?: { currentTime?: number; trackId?: string; isPlaying?: boolean }) => Promise<void>;
  sendRemoteCommand: (command: string, payload?: unknown) => Promise<void>;
  broadcastLocalState: (stateUpdate: {
    trackId?: string | null;
    isPlaying?: boolean;
    currentTime?: number;
    duration?: number;
    volume?: number;
    repeat?: "off" | "all" | "one";
    shuffle?: boolean;
  }) => Promise<void>;
  registerCommandHandler: (handler: (command: string, payload: unknown) => void) => () => void;
}

const DeviceSyncContext = createContext<DeviceSyncContextValue | null>(null);

function detectDeviceName(): string {
  if (typeof window === "undefined") return "Web Player";
  if (isAndroidNative()) {
    return "Soundify Android App";
  }
  const ua = navigator.userAgent;
  let os = "Desktop";
  if (/iPhone/i.test(ua)) os = "iPhone";
  else if (/iPad/i.test(ua)) os = "iPad";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Macintosh|Mac OS/i.test(ua)) os = "Mac";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "Web";
  if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) browser = "Chrome";
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
  else if (/Firefox/i.test(ua)) browser = "Firefox";
  else if (/Edg/i.test(ua)) browser = "Edge";

  return `${browser} on ${os}`;
}

function detectDeviceType(): "desktop" | "smartphone" | "tablet" | "browser" | "speaker" {
  if (typeof window === "undefined") return "desktop";
  if (isAndroidNative()) return "smartphone";
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return "tablet";
  if (/iPhone|Android.*Mobile|Mobile/i.test(ua)) return "smartphone";
  return "desktop";
}

export function DeviceSyncProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const deviceId = useMemo(
    () => (typeof window !== "undefined" ? getOrCreateDeviceId(user?.id) : ""),
    [user?.id],
  );
  const [deviceName] = useState<string>(() => (typeof window !== "undefined" ? detectDeviceName() : "Web Player"));
  const [deviceType] = useState<"desktop" | "smartphone" | "tablet" | "browser" | "speaker">(() =>
    typeof window !== "undefined" ? detectDeviceType() : "desktop",
  );
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<PlaybackStateSync | null>(null);
  const [devicePickerOpen, setDevicePickerOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const STORAGE_KEY_SYNC_ENABLED = "soundify_device_sync_enabled";
  const [isSyncEnabled, setIsSyncEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SYNC_ENABLED);
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });

  const commandHandlersRef = useRef<Set<(command: string, payload: unknown) => void>>(new Set());
  const eventSourceRef = useRef<EventSource | null>(null);
  const localOwnershipUntilRef = useRef<number>(0);
  const remoteOwnershipTargetRef = useRef<string | null>(null);
  const remoteOwnershipUntilRef = useRef<number>(0);
  const activeDeviceIdRef = useRef<string | null>(null);
  const syncStateRef = useRef<PlaybackStateSync | null>(null);
  const isSyncEnabledRef = useRef<boolean>(isSyncEnabled);

  // Watch user?.id: reset devices, activeDeviceId, syncState, and ownership locks when account changes or logs out
  const [prevUserId, setPrevUserId] = useState<string | undefined>(user?.id);
  if (user?.id !== prevUserId) {
    setPrevUserId(user?.id);
    setDevices([]);
    setActiveDeviceId(deviceId);
    setSyncState(null);
  }

  useEffect(() => {
    localOwnershipUntilRef.current = 0;
    remoteOwnershipTargetRef.current = null;
    remoteOwnershipUntilRef.current = 0;
    activeDeviceIdRef.current = deviceId;
    syncStateRef.current = null;
  }, [user?.id, deviceId]);

  useEffect(() => {
    isSyncEnabledRef.current = isSyncEnabled;
  }, [isSyncEnabled]);

  useEffect(() => {
    activeDeviceIdRef.current = activeDeviceId;
  }, [activeDeviceId]);

  useEffect(() => {
    syncStateRef.current = syncState;
  }, [syncState]);

  const toggleSyncEnabled = useCallback(() => {
    setIsSyncEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_SYNC_ENABLED, String(next));
      } catch {}
      if (!next) {
        setSyncState(null);
        syncStateRef.current = null;
        if (deviceId) {
          activeDeviceIdRef.current = deviceId;
          setActiveDeviceId(deviceId);
        }
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
      }
      return next;
    });
  }, [deviceId]);

  const applyServerSnapshot = useCallback(
    (patch: {
      devices?: DeviceInfo[];
      activeDeviceId?: string | null;
      state?: PlaybackStateSync | null;
    }) => {
      if (Array.isArray(patch.devices) && patch.devices.length > 0) {
        const seen = new Set<string>();
        const uniqueDevices: DeviceInfo[] = [];
        for (const d of patch.devices) {
          if (d?.id && !seen.has(d.id)) {
            seen.add(d.id);
            uniqueDevices.push(d);
          }
        }
        setDevices(uniqueDevices);
      }

      const hasLocalClaimLock = Date.now() < localOwnershipUntilRef.current;
      const hasRemoteHandoverLock = Boolean(
        remoteOwnershipTargetRef.current && Date.now() < remoteOwnershipUntilRef.current
      );

      if (!isSyncEnabledRef.current) {
        return;
      }

      if (patch.activeDeviceId !== undefined) {
        if (hasRemoteHandoverLock && patch.activeDeviceId === deviceId) {
          // preserve remote active device during handover lock
        } else if (!hasLocalClaimLock || !patch.activeDeviceId || patch.activeDeviceId === deviceId) {
          activeDeviceIdRef.current = patch.activeDeviceId;
          setActiveDeviceId(patch.activeDeviceId);
        }
      }

      if (patch.state && typeof patch.state === "object") {
        const incomingOwner = patch.state.activeDeviceId;
        if (hasRemoteHandoverLock && incomingOwner === deviceId) {
          // preserve remote active state during handover lock
        } else if (!hasLocalClaimLock || !incomingOwner || incomingOwner === deviceId) {
          const normalizedState: PlaybackStateSync = {
            ...patch.state,
            track: patch.state.track ? normalizeTrack(patch.state.track) : null,
          };
          setSyncState(normalizedState);
        }
      }
    },
    [deviceId],
  );

  const isThisDeviceActive = useMemo(() => {
    if (!user) return true;
    if (!isSyncEnabled) return true;
    if (!deviceId) return true;
    if (!activeDeviceId) return true;
    return activeDeviceId === deviceId;
  }, [user, deviceId, activeDeviceId, isSyncEnabled]);

  const isRemotePlaybackActive = useMemo(() => {
    if (!user) return false;
    if (!isSyncEnabled) return false;
    if (!deviceId || !activeDeviceId) return false;
    return activeDeviceId !== deviceId;
  }, [user, deviceId, activeDeviceId, isSyncEnabled]);

  const activeDeviceName = useMemo(() => {
    const targetId = activeDeviceId || deviceId;
    if (!targetId || targetId === deviceId) return deviceName;
    const found = devices.find((d) => d.id === targetId);
    return found ? found.name : (lang === "fa" ? "دستگاه راه دور" : "Remote Device");
  }, [activeDeviceId, deviceId, deviceName, devices, lang]);

  const localizedActiveDeviceName = useMemo(() => {
    return localizeDeviceName(activeDeviceName, lang);
  }, [activeDeviceName, lang]);

  const toggleDevicePicker = useCallback(() => {
    setDevicePickerOpen((prev) => !prev);
  }, []);

  const registerCommandHandler = useCallback((handler: (command: string, payload: unknown) => void) => {
    commandHandlersRef.current.add(handler);
    return () => {
      commandHandlersRef.current.delete(handler);
    };
  }, []);

  // Register device and periodic heartbeat
  const refreshDevices = useCallback(async () => {
    if (!user || !deviceId) return;
    setIsRefreshing(true);
    try {
      const isNative = isAndroidNative();
      const meta = isNative
        ? {
            brand: "Android",
            model: "Android Device",
            osVersion: "Android",
            appVersion: APP_VERSION,
          }
        : undefined;

      const res = await api.registerDevice({
        deviceId,
        name: deviceName,
        type: deviceType,
        isActive: activeDeviceIdRef.current === deviceId ? true : undefined,
        ...meta,
      });
      applyServerSnapshot({
        devices: res.devices,
        activeDeviceId: res.activeDeviceId,
        state: res.state,
      });
    } catch {
      // ignore network errors
    } finally {
      setIsRefreshing(false);
    }
  }, [user, deviceId, deviceName, deviceType, applyServerSnapshot]);

  // Initial registration and lightweight heartbeat loop (Section 7.2 #4)
  useEffect(() => {
    if (!user || !deviceId) return;

    let isDisposed = false;

    const doRegister = async () => {
      try {
        const isNative = isAndroidNative();
        const meta = isNative
          ? {
              brand: "Android",
              model: "Android Device",
              osVersion: "Android",
              appVersion: APP_VERSION,
            }
          : undefined;

        const isLocallyActive = activeDeviceIdRef.current === deviceId;
        const res = await api.registerDevice({
          deviceId,
          name: deviceName,
          type: deviceType,
          isActive: isLocallyActive ? true : undefined,
          ...meta,
        });
        if (!isDisposed) {
          const hasRemoteHandoverLock = Boolean(
            remoteOwnershipTargetRef.current && Date.now() < remoteOwnershipUntilRef.current
          );
          const effectiveActiveId =
            hasRemoteHandoverLock && res.activeDeviceId === deviceId
              ? remoteOwnershipTargetRef.current
              : res.activeDeviceId;

          applyServerSnapshot({
            devices: res.devices,
            activeDeviceId: effectiveActiveId,
            state: res.state,
          });
        }
      } catch {
        // ignore
      }
    };

    // Fast initial registration
    void doRegister();

    // Periodic heartbeat every 18s following Section 7.2 #4
    let heartbeatTick = 0;
    const doHeartbeat = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      heartbeatTick++;
      if (heartbeatTick % 2 === 0) {
        void doRegister();
      }
      try {
        const isLocalActive = activeDeviceIdRef.current === deviceId;
        const curState = syncStateRef.current;
        const res = await api.mobileHeartbeat({
          deviceId,
          trackId: isLocalActive ? (curState?.trackId ?? null) : null,
          isPlaying: isLocalActive ? Boolean(curState?.isPlaying) : false,
          currentTime: isLocalActive ? (curState?.currentTime ?? 0) : 0,
        }).catch(() => null);

        if (isDisposed) return;

        if (res && typeof res.isActivePlayer === "boolean") {
          const hasLocalClaimLock = Date.now() < localOwnershipUntilRef.current;
          const hasRemoteHandoverLock = Boolean(
            remoteOwnershipTargetRef.current && Date.now() < remoteOwnershipUntilRef.current
          );
          if (
            isSyncEnabledRef.current &&
            !hasLocalClaimLock &&
            !hasRemoteHandoverLock &&
            !res.isActivePlayer &&
            res.activeDeviceId &&
            res.activeDeviceId !== deviceId
          ) {
            activeDeviceIdRef.current = res.activeDeviceId;
            setActiveDeviceId(res.activeDeviceId);
          }
        }
      } catch {
        // Non-blocking transient error
      }
    };

    const cancelSchedule = scheduleDeferredInterval(doHeartbeat, 18_000, 2000);

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void doRegister();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      isDisposed = true;
      cancelSchedule();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [user, deviceId, deviceName, deviceType, applyServerSnapshot]);

  // Real-time Server-Sent Events (SSE) listener deferred until after initial paint
  useEffect(() => {
    if (!user || !deviceId || typeof window === "undefined" || !isSyncEnabled) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    let isDisposed = false;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;

    const setupEventSource = () => {
      if (isDisposed) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      const token = getApiToken();
      const qs = new URLSearchParams({
        deviceId,
        ...(token ? { token } : {}),
      });

      const sseUrl = resolveApiUrl(`/api/devices/events?${qs.toString()}`);
      const es = new EventSource(sseUrl);
      eventSourceRef.current = es;

      const handleInitialOrConnected = (data: Record<string, unknown>) => {
        retryAttempt = 0;
        reportNetworkSuccess();
        applyServerSnapshot({
          devices: Array.isArray(data?.devices) ? (data.devices as DeviceInfo[]) : undefined,
          activeDeviceId: data?.activeDeviceId !== undefined ? (data.activeDeviceId as string | null) : undefined,
          state: typeof data?.state === "object" && data?.state !== null ? (data.state as PlaybackStateSync) : undefined,
        });
      };

      es.addEventListener("initial", (e: MessageEvent) => {
        try {
          handleInitialOrConnected(JSON.parse(e.data));
        } catch {
          // ignore
        }
      });

      es.addEventListener("connected", (e: MessageEvent) => {
        try {
          handleInitialOrConnected(JSON.parse(e.data));
        } catch {
          // ignore
        }
      });

      es.addEventListener("devices", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          applyServerSnapshot({
            devices: Array.isArray(data?.devices) ? data.devices : undefined,
            activeDeviceId: data?.activeDeviceId !== undefined ? data.activeDeviceId : undefined,
          });
        } catch {
          // ignore
        }
      });

      es.addEventListener("state", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          applyServerSnapshot({
            state: data?.state ?? undefined,
            activeDeviceId: data?.activeDeviceId !== undefined ? data.activeDeviceId : undefined,
          });
        } catch {
          // ignore
        }
      });

      es.addEventListener("transfer", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data.fromDeviceId === deviceId) {
            return;
          }
          if (data.targetDeviceId && data.targetDeviceId !== deviceId) {
            localOwnershipUntilRef.current = 0;
          } else if (data.targetDeviceId === deviceId) {
            localOwnershipUntilRef.current = Date.now() + 8000;
          }
          applyServerSnapshot({
            activeDeviceId: data.targetDeviceId ?? undefined,
            state: data.state ?? undefined,
            devices: Array.isArray(data.devices) ? data.devices : undefined,
          });

          for (const handler of commandHandlersRef.current) {
            handler("TRANSFER", data);
          }
        } catch {
          // ignore
        }
      });

      es.addEventListener("command", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          if (data.fromDeviceId !== deviceId) {
            const enrichedPayload = {
              ...(typeof data.payload === "object" && data.payload !== null ? data.payload : {}),
              targetDeviceId: data.targetDeviceId,
              fromDeviceId: data.fromDeviceId,
            };
            for (const handler of commandHandlersRef.current) {
              handler(data.command, enrichedPayload);
            }
          }
        } catch {
          // ignore
        }
      });

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED && !isDisposed) {
          if (typeof document !== "undefined" && document.hidden) {
            return;
          }
          reportNetworkFailure();
          if (!reconnectTimeout) {
            const backoffMs = Math.min(30000, 2000 * Math.pow(2, retryAttempt));
            retryAttempt = Math.min(4, retryAttempt + 1);
            reconnectTimeout = setTimeout(() => {
              reconnectTimeout = null;
              setupEventSource();
            }, backoffMs);
          }
        }
      };
    };

    const cancelDeferred = runAfterInitialPaint(() => {
      setupEventSource();
    }, 1200);

    // Instant SSE recovery as soon as NetworkResilience detects VPN/internet restoration
    const unsubscribeNetwork = subscribeNetworkResilience((event) => {
      if (isDisposed || !event.isOnline) return;
      if (typeof document !== "undefined" && document.hidden) return;
      if (event.recovered || !eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
        retryAttempt = 0;
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
        setupEventSource();
        void refreshDevices();
      }
    });

    const onVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "hidden") {
        // Battery optimization: tear down idle SSE connection and pending reconnect timers in background
        if (reconnectTimeout) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = null;
        }
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
      } else if (document.visibilityState === "visible") {
        retryAttempt = 0;
        if (!eventSourceRef.current || eventSourceRef.current.readyState === EventSource.CLOSED) {
          setupEventSource();
        }
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      isDisposed = true;
      cancelDeferred();
      unsubscribeNetwork();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [user, deviceId, applyServerSnapshot, isSyncEnabled, refreshDevices]);

  // Transfer playback to specified device (Soundify Connect handover)
  const transferToDevice = useCallback(
    async (targetDeviceId: string, payload?: { currentTime?: number; trackId?: string; isPlaying?: boolean }) => {
      if (!deviceId || !isSyncEnabled) return;
      const claimingLocally = targetDeviceId === deviceId;
      if (claimingLocally) {
        localOwnershipUntilRef.current = Date.now() + 8000;
        remoteOwnershipTargetRef.current = null;
        remoteOwnershipUntilRef.current = 0;
      } else {
        localOwnershipUntilRef.current = 0;
        remoteOwnershipTargetRef.current = targetDeviceId;
        remoteOwnershipUntilRef.current = Date.now() + 15000;
      }
      activeDeviceIdRef.current = targetDeviceId;
      setActiveDeviceId(targetDeviceId);

      try {
        const res = await api.sendDeviceCommand({
          command: "TRANSFER",
          targetDeviceId,
          fromDeviceId: deviceId,
          payload,
        });
        if (res.activeDeviceId) {
          activeDeviceIdRef.current = res.activeDeviceId;
          setActiveDeviceId(res.activeDeviceId);
        }
        if (res.state && (!claimingLocally || !syncState?.track)) {
          setSyncState(res.state);
        }
        if (Array.isArray(res.devices) && res.devices.length > 0) {
          setDevices(res.devices);
        }
        // Immediate local handover: whether this device is receiving or yielding playback,
        // actuate audio immediately without waiting for network SSE round-trip
        for (const handler of commandHandlersRef.current) {
          handler("TRANSFER", {
            targetDeviceId,
            fromDeviceId: deviceId,
            state: res.state ?? {
              activeDeviceId: targetDeviceId,
              trackId: payload?.trackId ?? syncState?.trackId ?? null,
              track: syncState?.track ?? null,
              currentTime: payload?.currentTime ?? syncState?.currentTime ?? 0,
              isPlaying: payload?.isPlaying ?? syncState?.isPlaying ?? true,
              updatedAt: Date.now(),
            },
            devices: Array.isArray(res.devices) && res.devices.length > 0 ? res.devices : undefined,
          });
        }
      } catch {
        // Handover state was still asserted locally so local audio actuation completes cleanly
      }
    },
    [deviceId, syncState, isSyncEnabled],
  );

  // Claim active playback ownership on THIS device when user taps Play locally,
  // ensuring the PC/remote device pauses and the phone UI never shows PC's song.
  const claimThisDevice = useCallback(
    async (playback?: ClaimDevicePlaybackPayload) => {
      if (!deviceId || !isSyncEnabled) return;
      const previousOwner = activeDeviceIdRef.current;
      localOwnershipUntilRef.current = Date.now() + 8000;
      remoteOwnershipTargetRef.current = null;
      remoteOwnershipUntilRef.current = 0;
      activeDeviceIdRef.current = deviceId;
      setActiveDeviceId(deviceId);

      const resolvedTrackId = playback?.trackId ?? playback?.track?.id ?? syncState?.trackId ?? null;
      setSyncState((prev) => ({
        activeDeviceId: deviceId,
        trackId: resolvedTrackId,
        track: playback?.track !== undefined ? playback.track : (prev?.track ?? null),
        isPlaying: playback?.isPlaying ?? true,
        currentTime: playback?.currentTime ?? 0,
        duration: playback?.duration ?? playback?.track?.durationSec ?? prev?.duration ?? 0,
        volume: playback?.volume ?? prev?.volume ?? 0.82,
        repeat: playback?.repeat ?? prev?.repeat ?? "off",
        shuffle: playback?.shuffle ?? prev?.shuffle ?? false,
        updatedAt: Date.now(),
      }));

      if (!user) return;

      try {
        const ops: Promise<unknown>[] = [];
        if (previousOwner && previousOwner !== deviceId) {
          ops.push(
            api.sendDeviceCommand({
              command: "TRANSFER",
              targetDeviceId: deviceId,
              fromDeviceId: deviceId,
              payload: {
                trackId: resolvedTrackId ?? undefined,
                currentTime: playback?.currentTime ?? 0,
                isPlaying: playback?.isPlaying ?? true,
              },
            }),
          );
        }
        ops.push(
          api.updatePlaybackState({
            deviceId,
            trackId: resolvedTrackId,
            isPlaying: playback?.isPlaying ?? true,
            currentTime: playback?.currentTime ?? 0,
            duration: playback?.duration ?? playback?.track?.durationSec,
            volume: playback?.volume,
            repeat: playback?.repeat,
            shuffle: playback?.shuffle,
            takeover: true,
          }),
        );
        await Promise.allSettled(ops);
      } catch {
        // Best-effort server claim; optimistic lock protects local state
      }
    },
    [deviceId, isSyncEnabled, syncState?.trackId, user],
  );

  const transferToThisDevice = useCallback(
    async (payload?: { currentTime?: number; trackId?: string; isPlaying?: boolean }) => {
      if (!deviceId) return;
      await transferToDevice(deviceId, payload);
    },
    [deviceId, transferToDevice],
  );

  // Send control command (either remote or local)
  const sendRemoteCommand = useCallback(
    async (command: string, payload?: unknown) => {
      if (!deviceId || !isSyncEnabled) return;
      try {
        const res = await api.sendDeviceCommand({
          command,
          payload,
          fromDeviceId: deviceId,
          targetDeviceId: activeDeviceId || undefined,
        });
        if (res.state) {
          setSyncState(res.state);
        }
      } catch {
        // handled gracefully
      }
    },
    [deviceId, activeDeviceId, isSyncEnabled],
  );

  // Broadcast state from the active player device
  const broadcastLocalState = useCallback(
    async (stateUpdate: {
      trackId?: string | null;
      isPlaying?: boolean;
      currentTime?: number;
      duration?: number;
      volume?: number;
      repeat?: "off" | "all" | "one";
      shuffle?: boolean;
    }) => {
      if (!isSyncEnabled) return;
      const canBroadcast = isThisDeviceActive || Date.now() < localOwnershipUntilRef.current;
      if (!user || !deviceId || !canBroadcast) return;
      try {
        await api.updatePlaybackState({
          deviceId,
          ...stateUpdate,
        });
      } catch {
        // ignore network error
      }
    },
    [user, deviceId, isSyncEnabled, isThisDeviceActive],
  );

  const value = useMemo<DeviceSyncContextValue>(
    () => ({
      deviceId,
      deviceName,
      deviceType,
      devices,
      activeDeviceId,
      isThisDeviceActive,
      isRemotePlaybackActive,
      activeDeviceName,
      localizedActiveDeviceName,
      isRefreshing,
      syncState,
      devicePickerOpen,
      setDevicePickerOpen,
      toggleDevicePicker,
      isSyncEnabled,
      toggleSyncEnabled,
      setActiveDeviceId,
      refreshDevices,
      claimThisDevice,
      transferToThisDevice,
      transferToDevice,
      sendRemoteCommand,
      broadcastLocalState,
      registerCommandHandler,
    }),
    [
      deviceId,
      deviceName,
      deviceType,
      devices,
      activeDeviceId,
      isThisDeviceActive,
      isRemotePlaybackActive,
      activeDeviceName,
      localizedActiveDeviceName,
      isRefreshing,
      syncState,
      devicePickerOpen,
      toggleDevicePicker,
      isSyncEnabled,
      toggleSyncEnabled,
      setActiveDeviceId,
      refreshDevices,
      claimThisDevice,
      transferToThisDevice,
      transferToDevice,
      sendRemoteCommand,
      broadcastLocalState,
      registerCommandHandler,
    ],
  );

  return <DeviceSyncContext.Provider value={value}>{children}</DeviceSyncContext.Provider>;
}

export function useDeviceSync() {
  const ctx = useContext(DeviceSyncContext);
  if (!ctx) {
    throw new Error("useDeviceSync must be used within a DeviceSyncProvider");
  }
  return ctx;
}
