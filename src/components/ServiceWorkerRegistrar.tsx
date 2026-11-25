"use client";

import { useEffect } from "react";
import { isAndroidNative } from "@/lib/androidBridge";
import { APP_VERSION, APP_BUILD_NUMBER } from "@/lib/appVersion";

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    // On Capacitor Android Native, web assets are already bundled locally inside the APK.
    // A Service Worker caches old HTML/JS/CSS across APK updates and traps users on stale UI builds!
    if (isAndroidNative()) {
      const purgeKey = `soundify_sw_purged_${APP_VERSION}_${APP_BUILD_NUMBER}`;
      const hadController = Boolean(navigator.serviceWorker.controller);

      void (async () => {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)));

          let purgedCaches = 0;
          if ("caches" in window) {
            const keys = await window.caches.keys();
            // Purge all legacy SW bundle caches while preserving user cover art cache
            const staleKeys = keys.filter((k) => k !== "soundify-covers-v1");
            purgedCaches = staleKeys.length;
            await Promise.all(
              staleKeys.map((k) => window.caches.delete(k).catch(() => false)),
            );
          }

          if ((hadController || regs.length > 0 || purgedCaches > 0) && !sessionStorage.getItem(purgeKey)) {
            sessionStorage.setItem(purgeKey, "1");
            window.location.reload();
          }
        } catch {
          // Non-blocking cleanup
        }
      })();
      return;
    }

    // Standard Web / PWA only (avoid localhost/127.0.0.1 so local previews do not trigger Capacitor's SW self-destruct loop)
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Ignore registration error in unsupported/insecure contexts
    });
  }, []);

  return null;
}
