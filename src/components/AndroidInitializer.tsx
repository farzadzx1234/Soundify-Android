"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { usePlayer } from "@/context/PlayerContext";
import { useDeviceSync } from "@/context/DeviceSyncContext";
import { dispatchAndroidBack, isAndroidNative, registerBackButtonHandler } from "@/lib/androidBridge";
import { installLogSanitizer } from "@/lib/secureLogger";
import { secureStorage } from "@/lib/secureStorage";
import { runAfterInitialPaint } from "@/lib/startupScheduler";
import { checkDeviceIntegrity } from "@/lib/mobileSecurityIntegrity";

export function AndroidInitializer() {
  // Install log sanitizer and safe area insets immediately, but defer heavy crypto/vault init until after initial paint
  useEffect(() => {
    installLogSanitizer();
    if (typeof document !== "undefined" && isAndroidNative()) {
      const current = document.documentElement.style.getPropertyValue("--sab");
      if (!current || current === "0px") {
        document.documentElement.style.setProperty("--sab", "48px");
      }
    }
    const cancel = runAfterInitialPaint(() => {
      void secureStorage.init();
      void checkDeviceIntegrity();
    }, 800);
    return () => cancel();
  }, []);

  const router = useRouter();
  const pathname = usePathname();
  const { expanded, setExpanded } = usePlayer();
  const { authDialogOpen, closeAuthDialog } = useAuth();
  const { devicePickerOpen, toggleDevicePicker } = useDeviceSync();

  // Register Back Button priority handlers:
  // 1. Full-screen Player Overlay
  // 2. Auth Dialog
  // 3. Soundify Connect Device Picker
  // 4. In-App Navigation (go back if not on home `/`)
  useEffect(() => {
    const unregister = registerBackButtonHandler(() => {
      if (expanded) {
        if (typeof window !== "undefined") {
          const ev = new CustomEvent("soundify-dismiss-now-playing", { cancelable: true });
          const notHandled = window.dispatchEvent(ev);
          if (notHandled) {
            setExpanded(false);
          }
        } else {
          setExpanded(false);
        }
        return true;
      }
      if (authDialogOpen) {
        closeAuthDialog();
        return true;
      }
      if (devicePickerOpen) {
        toggleDevicePicker();
        return true;
      }
      if (pathname !== "/") {
        router.back();
        return true;
      }
      return false;
    });

    return unregister;
  }, [expanded, setExpanded, authDialogOpen, closeAuthDialog, devicePickerOpen, toggleDevicePicker, pathname, router]);

  // Hook into Capacitor native App backButton event if running natively
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cleanup: (() => void) | undefined;

    // Use Capacitor's global plugin registry if present on window
    const capApp = (window.Capacitor?.Plugins?.App ?? null) as {
      addListener?: (
        eventName: string,
        listenerFunc: (info: { canGoBack: boolean }) => void
      ) => Promise<{ remove: () => Promise<void> }> | { remove: () => void };
      exitApp?: () => void;
    } | null;

    if (capApp?.addListener) {
      const handle = capApp.addListener("backButton", ({ canGoBack }) => {
        const handled = dispatchAndroidBack();
        if (!handled) {
          if (canGoBack && pathname !== "/") {
            window.history.back();
          } else {
            capApp.exitApp?.();
          }
        }
      });

      cleanup = () => {
        if (handle && "then" in handle) {
          handle.then((h) => h.remove()).catch(() => {});
        } else if (handle && "remove" in handle) {
          handle.remove();
        }
      };
    } else {
      // Standard browser/webview popstate fallback
      const handlePopState = (e: PopStateEvent) => {
        if (expanded || authDialogOpen || devicePickerOpen) {
          e.preventDefault();
          dispatchAndroidBack();
        }
      };
      window.addEventListener("popstate", handlePopState);
      cleanup = () => window.removeEventListener("popstate", handlePopState);
    }

    return () => {
      cleanup?.();
    };
  }, [expanded, authDialogOpen, devicePickerOpen, pathname]);

  return null;
}
