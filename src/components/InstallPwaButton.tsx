"use client";

import React, { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/GlassControls";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { useI18n } from "@/context/I18nContext";
import { isAndroidNative } from "@/lib/androidBridge";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const subscribeNoop = () => () => {};
const getSupportsNativeInstall = () =>
  typeof (navigator as Navigator & { install?: unknown }).install === "function";
const getSupportsNativeInstallServer = () => false;

export function InstallPwaButton({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissedNative, setDismissedNative] = useState(false);
  const supportsNativeInstall =
    useSyncExternalStore(subscribeNoop, getSupportsNativeInstall, getSupportsNativeInstallServer) &&
    !dismissedNative;
  const [installing, setInstalling] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  if (isAndroidNative() || (!supportsNativeInstall && !deferredPrompt)) {
    return null;
  }

  const handleInstall = async () => {
    if (installing) return;
    setInstalling(true);
    try {
      const nav = navigator as Navigator & { install?: () => Promise<void> };
      if (supportsNativeInstall && typeof nav.install === "function") {
        await nav.install();
        setStatusMsg("Installed");
        setDismissedNative(true);
      } else if (deferredPrompt) {
        const evt = deferredPrompt;
        setDeferredPrompt(null);
        await evt.prompt();
        const choice = await evt.userChoice;
        setStatusMsg(choice.outcome === "accepted" ? "Installed" : "");
      }
    } catch {
      // User dismissed or aborted
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="w-full min-w-0">
      <Button
        variant="glass"
        aria-disabled={installing}
        onClick={handleInstall}
        icon={<DownloadSimpleIcon size={17} weight="bold" aria-hidden="true" />}
        className={`w-full max-w-full justify-center ${compact ? "text-xs px-3" : ""}`}
      >
        {compact ? t("installAppShort") : t("installApp")}
      </Button>
      {statusMsg && (
        <span role="status" className="visually-hidden">
          {statusMsg}
        </span>
      )}
    </div>
  );
}
