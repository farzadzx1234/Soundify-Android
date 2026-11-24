/**
 * Soundify Mobile Security Integrity Service
 *
 * Implements client-side anti-tampering, anti-debugging, and root/jailbreak detection heuristics:
 * - Native Android bridge to Capacitor SecurityIntegrityPlugin
 * - Web & WebView environment tampering detection (prototype pollution, hooking)
 * - Debugger presence & execution timing deviation checks
 * - Automation & emulator artifact detection
 * - Graceful policy enforcement: restricts offline media decryption on compromised devices
 * - Remote attestation reporting to Soundify backend (/api/mobile/sec/integrity)
 */

export type ThreatLevel = "SECURE" | "SUSPICIOUS" | "COMPROMISED";

export interface IntegrityState {
  threatLevel: ThreatLevel;
  isRooted: boolean;
  isHooked: boolean;
  isDebuggerConnected: boolean;
  isEmulator: boolean;
  detectedSignals: string[];
  lastChecked: number;
}

export type IntegrityListener = (state: IntegrityState) => void;

// Module state
let currentState: IntegrityState = {
  threatLevel: "SECURE",
  isRooted: false,
  isHooked: false,
  isDebuggerConnected: false,
  isEmulator: false,
  detectedSignals: [],
  lastChecked: 0,
};

const listeners = new Set<IntegrityListener>();

export function getIntegrityState(): IntegrityState {
  return { ...currentState };
}

export function subscribeToIntegrityState(listener: IntegrityListener): () => void {
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

function notifyListeners(): void {
  for (const listener of listeners) {
    try {
      listener(currentState);
    } catch {}
  }
}

/**
 * Checks for JavaScript prototype tampering and hook artifacts (Frida / Xposed Web injections).
 */
export function checkPrototypeTampering(): { tampered: boolean; signals: string[] } {
  const signals: string[] = [];

  try {
    const globalScope =
      typeof window !== "undefined"
        ? (window as unknown as Record<string, unknown>)
        : (globalThis as unknown as Record<string, unknown>);

    const isBrowser =
      typeof window !== "undefined" &&
      typeof (window as unknown as { document?: unknown }).document !== "undefined" &&
      typeof (globalThis as unknown as { process?: { versions?: { node?: string } } }).process?.versions?.node === "undefined";

    const isCapacitorRuntime = Boolean(globalScope.Capacitor);

    // 1. Check Function.prototype.toString integrity
    try {
      const fnToString = Function.prototype.toString.call(Function.prototype.toString);
      if (!fnToString.includes("[native code]")) {
        signals.push("FUNCTION_TOSTRING_TAMPERED");
      }
    } catch {
      signals.push("FUNCTION_TOSTRING_CALL_FAILED");
    }

    // 2. Check fetch native code verification & hooking artifacts
    try {
      if (typeof globalScope.fetch === "function") {
        const fetchStr = Function.prototype.toString.call(globalScope.fetch);
        const lowerFetchStr = fetchStr.toLowerCase();
        if (
          lowerFetchStr.includes("frida") ||
          lowerFetchStr.includes("hook") ||
          lowerFetchStr.includes("xposed") ||
          lowerFetchStr.includes("substrate") ||
          lowerFetchStr.includes("cycript") ||
          (!isCapacitorRuntime && isBrowser && !fetchStr.includes("[native code]"))
        ) {
          signals.push("FETCH_PROTOTYPE_TAMPERED");
        }
      }
    } catch {
      signals.push("FETCH_CHECK_FAILED");
    }

    // 3. Check Web Crypto Subtle API integrity & hooking artifacts
    try {
      const cryptoObj = (globalScope.crypto || globalThis.crypto) as
        | { subtle?: { encrypt?: unknown } }
        | undefined;
      if (cryptoObj?.subtle?.encrypt) {
        const encStr = Function.prototype.toString.call(cryptoObj.subtle.encrypt);
        const lowerEncStr = encStr.toLowerCase();
        if (
          lowerEncStr.includes("frida") ||
          lowerEncStr.includes("hook") ||
          lowerEncStr.includes("xposed") ||
          lowerEncStr.includes("substrate") ||
          lowerEncStr.includes("cycript") ||
          (!isCapacitorRuntime && isBrowser && !encStr.includes("[native code]"))
        ) {
          signals.push("CRYPTO_SUBTLE_ENCRYPT_HOOKED");
        }
      }
    } catch {
      signals.push("CRYPTO_CHECK_FAILED");
    }

    // 4. Check for known Frida / Xposed global objects
    if (globalScope.__frida || globalScope._frida || globalScope.Frida || globalScope.frida) {
      signals.push("FRIDA_GLOBAL_OBJECT_DETECTED");
    }
    if (globalScope.__xposed || globalScope.XposedBridge) {
      signals.push("XPOSED_GLOBAL_OBJECT_DETECTED");
    }
  } catch {
    // Fail-safe
  }

  return {
    tampered: signals.length > 0,
    signals,
  };
}

/**
 * Checks for debugger presence via execution delta measurement.
 */
export function checkDebuggerTiming(thresholdMs = 120): { isDebuggerDetected: boolean; deltaMs: number } {
  if (typeof performance === "undefined") {
    return { isDebuggerDetected: false, deltaMs: 0 };
  }

  const t0 = performance.now();
  // Evaluates a micro-statement that will stall if a breakpoint is hit or devtools debugger is attached
  let sum = 0;
  for (let i = 0; i < 200; i++) {
    sum += i;
  }
  const deltaMs = performance.now() - t0 + (sum < 0 ? 1 : 0);

  return {
    isDebuggerDetected: deltaMs > thresholdMs,
    deltaMs,
  };
}

/**
 * Checks for automation flags and emulator environment markers in browser / webview.
 */
export function checkEmulatorAndAutomation(): { isAutomated: boolean; signals: string[] } {
  const signals: string[] = [];

  try {
    if (typeof navigator !== "undefined") {
      // 1. Check for navigator.webdriver
      if ((navigator as unknown as { webdriver?: boolean }).webdriver) {
        signals.push("WEBDRIVER_AUTOMATION_FLAG");
      }

      // 2. Check for missing language or platform anomalies
      const ua = navigator.userAgent || "";
      if (/HeadlessChrome/i.test(ua)) {
        signals.push("HEADLESS_CHROME_DETECTED");
      }
    }
  } catch {}

  return {
    isAutomated: signals.length > 0,
    signals,
  };
}

/**
 * Performs a comprehensive integrity audit across native plugins and web heuristics.
 */
export async function checkDeviceIntegrity(options?: {
  customNativeChecker?: () => Promise<Partial<IntegrityState>>;
}): Promise<IntegrityState> {
  const detectedSignals: string[] = [];
  let isRooted = false;
  let isHooked = false;
  let isDebuggerConnected = false;
  let isEmulator = false;

  // 1. Try native Capacitor SecurityIntegrityPlugin if available
  try {
    if (options?.customNativeChecker) {
      const nativeResult = await options.customNativeChecker();
      if (nativeResult.isRooted) isRooted = true;
      if (nativeResult.isHooked) isHooked = true;
      if (nativeResult.isDebuggerConnected) isDebuggerConnected = true;
      if (nativeResult.isEmulator) isEmulator = true;
      if (nativeResult.detectedSignals) {
        detectedSignals.push(...nativeResult.detectedSignals);
      }
    } else if (typeof window !== "undefined") {
      const cap = (window as unknown as {
        Capacitor?: {
          Plugins?: {
            SecurityIntegrity?: {
              checkIntegrity?: () => Promise<{
                threatLevel: ThreatLevel;
                isRooted: boolean;
                isHooked: boolean;
                isDebuggerConnected: boolean;
                isEmulator: boolean;
                detectedSignals: string[];
              }>;
            };
          };
        };
      }).Capacitor;

      if (cap?.Plugins?.SecurityIntegrity?.checkIntegrity) {
        const nativeCheck = await cap.Plugins.SecurityIntegrity.checkIntegrity();
        isRooted = Boolean(nativeCheck.isRooted);
        isHooked = Boolean(nativeCheck.isHooked);
        isDebuggerConnected = Boolean(nativeCheck.isDebuggerConnected);
        isEmulator = Boolean(nativeCheck.isEmulator);
        if (Array.isArray(nativeCheck.detectedSignals)) {
          detectedSignals.push(...nativeCheck.detectedSignals);
        }
      }
    }
  } catch {}

  // 2. Perform web heuristics checks
  const protoCheck = checkPrototypeTampering();
  if (protoCheck.tampered) {
    isHooked = true;
    detectedSignals.push(...protoCheck.signals);
  }

  const debugCheck = checkDebuggerTiming();
  if (debugCheck.isDebuggerDetected) {
    isDebuggerConnected = true;
    detectedSignals.push(`TIMING_ANOMALY_DELTA_${Math.round(debugCheck.deltaMs)}MS`);
  }

  const autoCheck = checkEmulatorAndAutomation();
  if (autoCheck.isAutomated) {
    isEmulator = true;
    detectedSignals.push(...autoCheck.signals);
  }

  // 3. Determine Threat Level
  let threatLevel: ThreatLevel = "SECURE";
  if (isRooted || isHooked) {
    threatLevel = "COMPROMISED";
  } else if (isDebuggerConnected || isEmulator) {
    threatLevel = "SUSPICIOUS";
  }

  currentState = {
    threatLevel,
    isRooted,
    isHooked,
    isDebuggerConnected,
    isEmulator,
    detectedSignals: Array.from(new Set(detectedSignals)),
    lastChecked: Date.now(),
  };

  notifyListeners();
  return { ...currentState };
}

/**
 * Enforces policy: Checks whether offline decryption of DRM/cached media is permitted.
 * If the device is COMPROMISED (rooted or dynamic hooks detected), sensitive offline decryption is barred.
 */
export function isOfflineDecryptionPermitted(): boolean {
  return currentState.threatLevel !== "COMPROMISED";
}

/**
 * Overrides or resets integrity state (used in testing and explicit attestation responses).
 */
export function setIntegrityStateForTesting(state: Partial<IntegrityState>): void {
  currentState = {
    ...currentState,
    ...state,
    lastChecked: Date.now(),
  };
  notifyListeners();
}

/**
 * Reports device security integrity attestation to the Soundify backend.
 */
export async function reportIntegrityAttestation(
  deviceId: string,
  apiOrigin = "",
): Promise<{ ok: boolean; policyAction: string; offlineDecryptionPermitted: boolean }> {
  try {
    const res = await fetch(`${apiOrigin}/api/mobile/sec/integrity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId,
        threatLevel: currentState.threatLevel,
        isRooted: currentState.isRooted,
        isHooked: currentState.isHooked,
        isDebuggerConnected: currentState.isDebuggerConnected,
        isEmulator: currentState.isEmulator,
        detectedSignals: currentState.detectedSignals,
        timestamp: Date.now(),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      return {
        ok: true,
        policyAction: data.policyAction || "ALLOW",
        offlineDecryptionPermitted: data.offlineDecryptionPermitted !== false,
      };
    }
  } catch {}

  return {
    ok: false,
    policyAction: isOfflineDecryptionPermitted() ? "ALLOW" : "RESTRICT_OFFLINE",
    offlineDecryptionPermitted: isOfflineDecryptionPermitted(),
  };
}
