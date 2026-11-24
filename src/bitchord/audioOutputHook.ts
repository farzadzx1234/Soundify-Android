"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getNativeAudioOutputDevice,
  requestNativeBluetoothPermission,
  subscribeNativeAudioOutput,
  type AudioOutputDeviceInfo,
} from "@/lib/nativeAudioBridge";
import { isAndroidNative, subscribeToAppState } from "@/lib/androidBridge";

const DEFAULT_OUTPUT: AudioOutputDeviceInfo = {
  kind: "speaker",
  name: "",
  permissionNeeded: false,
};

export function useAudioOutputDevice() {
  const [device, setDevice] = useState<AudioOutputDeviceInfo>(DEFAULT_OUTPUT);

  const refresh = useCallback(async () => {
    if (!isAndroidNative()) {
      setDevice(DEFAULT_OUTPUT);
      return;
    }
    const info = await getNativeAudioOutputDevice();
    setDevice(info);
  }, []);

  const requestBluetoothNamesIfNeeded = useCallback(async () => {
    if (!isAndroidNative()) return;
    const info = await requestNativeBluetoothPermission();
    setDevice(info);
  }, []);

  useEffect(() => {
    if (!isAndroidNative()) return;
    const initialTimer = window.setTimeout(() => {
      void refresh();
    }, 0);
    const unsubOutput = subscribeNativeAudioOutput((info) => {
      setDevice(info);
    });
    const unsubApp = subscribeToAppState((inFg) => {
      if (inFg) void refresh();
    });
    return () => {
      window.clearTimeout(initialTimer);
      unsubOutput();
      unsubApp();
    };
  }, [refresh]);

  return {
    outputDevice: device,
    refreshOutputDevice: refresh,
    requestBluetoothNamesIfNeeded,
  };
}
