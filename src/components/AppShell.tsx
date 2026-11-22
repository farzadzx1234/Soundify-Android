"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BooksIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CloudSlashIcon,
  CompassIcon,
  GearSixIcon,
  HouseIcon,
  MagnifyingGlassIcon,
  SignOutIcon,
  UserCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { AmbientBackdrop } from "./AmbientBackdrop";
import { Button, Glass, SearchField } from "./GlassControls";
import { InstallPwaButton } from "./InstallPwaButton";
import { PlayerDock } from "./PlayerDock";
import { DevicePickerPopover } from "./DevicePickerPopover";
import { checkBackendHealth } from "@/lib/api";
import {
  getServerConnectivityStatus,
  subscribeServerConnectivity,
  type ServerConnectivityStatus,
} from "@/lib/mobileBackend";
import {
  startNetworkResilience,
  subscribeNetworkResilience,
  triggerImmediateNetworkProbe,
} from "@/lib/networkResilience";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";

const NowPlayingOverlay = dynamic(
  () => import("./NowPlayingOverlay").then((m) => m.NowPlayingOverlay),
  { ssr: false },
);

const AuthDialog = dynamic(
  () => import("./AuthDialog").then((m) => m.AuthDialog),
  { ssr: false },
);

const AppUpdateDialog = dynamic(
  () => import("./AppUpdateDialog").then((m) => m.AppUpdateDialog),
  { ssr: false },
);

function LazyNowPlayingOverlay() {
  const { expanded } = usePlayer();
  if (!expanded) return null;
  return <NowPlayingOverlay />;
}

function LazyAuthDialog() {
  const { authDialogOpen } = useAuth();
  if (!authDialogOpen) return null;
  return <AuthDialog />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, openAuthDialog, logout } = useAuth();
  const { lang, dir, toggleLang, t } = useI18n();
  const { isOffline } = usePlayer();
  const [quickQuery, setQuickQuery] = useState("");
  const [backendOnline, setBackendOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [connectivityStatus, setConnectivityStatus] = useState<ServerConnectivityStatus>(() =>
    getServerConnectivityStatus(),
  );
  const [bannerDismissed, setBannerDismissed] = useState(false);

  useEffect(() => {
    let active = true;

    const verifyConnectivity = async () => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        if (active) {
          setBackendOnline(false);
          setConnectivityStatus("offline");
        }
        return;
      }
      try {
        const res = await checkBackendHealth();
        if (active) {
          setBackendOnline(res.ok);
          setConnectivityStatus(res.ok ? "online" : "vpn_or_server_down");
          if (res.ok) setBannerDismissed(false);
        }
      } catch {
        if (active) {
          setBackendOnline(false);
          setConnectivityStatus("vpn_or_server_down");
        }
      }
    };

    startNetworkResilience();
    void verifyConnectivity();

    const unsub = subscribeServerConnectivity((status) => {
      if (!active) return;
      setConnectivityStatus(status);
      setBackendOnline(status === "online");
      if (status === "online") setBannerDismissed(false);
    });

    const unsubResilience = subscribeNetworkResilience((event) => {
      if (!active) return;
      if (event.isOnline) {
        setBackendOnline(true);
        setConnectivityStatus("online");
        setBannerDismissed(false);
      } else if (event.status === "offline") {
        setBackendOnline(false);
        const browserOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
        setConnectivityStatus(browserOnline ? "vpn_or_server_down" : "offline");
      }
    });

    const handleOnline = () => {
      void triggerImmediateNetworkProbe();
      void verifyConnectivity();
    };
    const handleOffline = () => {
      // Do not hard-lock offline immediately on Android WebView VPN switches; probe actively first.
      void triggerImmediateNetworkProbe();
    };
    const handleVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void triggerImmediateNetworkProbe();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibility);
    }
    const interval = setInterval(verifyConnectivity, 45000);

    return () => {
      active = false;
      unsub();
      unsubResilience();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibility);
      }
      clearInterval(interval);
    };
  }, []);

  const navItems = useMemo(
    () => [
      {
        value: "/",
        href: "/",
        label: t("navHome"),
        mobileLabel: t("navHomeShort"),
        icon: (active: boolean, size = 20) => (
          <HouseIcon size={size} weight={active ? "fill" : "regular"} aria-hidden="true" />
        ),
      },
      {
        value: "/explore",
        href: "/explore",
        label: t("navExplore"),
        mobileLabel: t("navExploreShort"),
        icon: (active: boolean, size = 20) => (
          <CompassIcon size={size} weight={active ? "fill" : "regular"} aria-hidden="true" />
        ),
      },
      {
        value: "/search",
        href: "/search",
        label: t("navSearch"),
        mobileLabel: t("navSearch"),
        icon: (active: boolean, size = 20) => (
          <MagnifyingGlassIcon size={size} weight={active ? "bold" : "regular"} aria-hidden="true" />
        ),
      },
      {
        value: "/library",
        href: "/library",
        label: t("navLibrary"),
        mobileLabel: t("navLibraryShort"),
        icon: (active: boolean, size = 20) => (
          <BooksIcon size={size} weight={active ? "fill" : "regular"} aria-hidden="true" />
        ),
      },
      {
        value: "/settings",
        href: "/settings",
        label: t("navSettings"),
        mobileLabel: t("navSettingsShort"),
        icon: (active: boolean, size = 20) => (
          <GearSixIcon size={size} weight={active ? "fill" : "regular"} aria-hidden="true" />
        ),
      },
    ],
    [t],
  );

  const activeTabIndex = useMemo(
    () =>
      navItems.findIndex((item) =>
        item.value === "/" ? pathname === "/" || pathname === "" : pathname.startsWith(item.value),
      ),
    [navItems, pathname],
  );

  const isSubPage =
    pathname.startsWith("/playlist/") ||
    pathname.startsWith("/track/") ||
    pathname === "/profile" ||
    pathname === "/history" ||
    pathname === "/studio";

  const subPageTitle = useMemo(() => {
    if (pathname.startsWith("/playlist/")) return lang === "fa" ? "پلی‌لیست" : "Playlist";
    if (pathname.startsWith("/track/")) return lang === "fa" ? "جزئیات قطعه" : "Track Detail";
    if (pathname === "/profile") return t("navProfile");
    if (pathname === "/history") return lang === "fa" ? "تاریخچه پخش" : "History";
    if (pathname === "/studio") return lang === "fa" ? "استودیو ضبط" : "Studio";
    return "";
  }, [pathname, lang, t]);

  const handleQuickSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = quickQuery.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  return (
    <div className="relative z-0 min-h-dvh flex flex-col lg:flex-row overflow-x-clip">
      <AmbientBackdrop />

      <a href="#main-content" className="skip-link">
        {t("skipToContent")}
      </a>

      {/* Desktop Liquid Glass Sidebar */}
      <aside className="hidden lg:flex lg:fixed lg:inset-y-4 lg:start-4 lg:w-60 z-30">
        <Glass
          variant="chrome"
          className="w-full rounded-3xl p-4 flex flex-col justify-between border border-black/[0.06] dark:border-white/[0.08] dark:bg-[#0c0e18]/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_16px_40px_rgba(0,0,0,0.4)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_44px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
        >
          <div className="space-y-6">
            <Link href="/" className="flex items-center gap-3 px-2 py-1 group">
              <img
                src="/images/logo-icon.png"
                alt={t("brandName")}
                width={40}
                height={40}
                className="h-10 w-10 object-contain rounded-2xl drop-shadow-[0_4px_12px_rgba(0,0,0,0.35)] dark:drop-shadow-[0_4px_14px_rgba(255,255,255,0.12)] transition-transform duration-300 group-hover:scale-105"
              />
              <div>
                <span className="block font-black text-lg leading-tight tracking-tight text-slate-900 dark:text-white">{t("brandName")}</span>
                <span className="block text-[11px] opacity-65 font-medium">{t("brandSub")}</span>
              </div>
            </Link>

            <nav aria-label="Primary">
              <ul className="space-y-1">
                {navItems.map((item) => {
                  const active = pathname === item.value;
                  return (
                    <li key={item.value}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`group flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[13.5px] transition-all duration-200 ${
                          active
                            ? "bg-black/[0.06] dark:bg-white/[0.14] text-slate-950 dark:text-white font-semibold rounded-2xl border border-black/[0.04] dark:border-white/[0.1] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_8px_rgba(0,0,0,0.25)]"
                            : "font-medium text-[var(--sf-muted)] dark:text-slate-300 hover:text-[var(--sf-text)] dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.08] border border-transparent"
                        }`}
                      >
                        <span className={active ? "text-indigo-600 dark:text-indigo-400" : "opacity-75 group-hover:opacity-100 transition-opacity"}>
                          {item.icon(active, 20)}
                        </span>
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>

          <div className="space-y-2.5 pt-4 border-t border-[var(--sf-hairline)] dark:border-white/[0.08]">
            <InstallPwaButton compact />
            {user ? (
              <div className="flex items-center justify-between gap-2 rounded-2xl bg-[var(--sf-subtle)] dark:bg-white/[0.07] border border-black/[0.04] dark:border-white/[0.08] px-3 py-2">
                <Link
                  href="/profile"
                  aria-label={t("navProfile")}
                  className="flex items-center gap-2 min-w-0 flex-1 hover:opacity-85 transition-opacity"
                >
                  <span
                    className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                    style={{ backgroundColor: user.avatarColor }}
                  >
                    {user.displayName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate text-xs font-semibold">{user.displayName}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => void logout()}
                  aria-label={t("signOut")}
                  className="p-1.5 rounded-full opacity-75 hover:opacity-100 hover:bg-[var(--sf-subtle-hover)] dark:hover:bg-white/[0.1] cursor-pointer"
                >
                  <SignOutIcon size={16} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <Button
                type="button"
                variant="filled"
                onClick={openAuthDialog}
                icon={<UserCircleIcon size={18} aria-hidden="true" />}
                className="w-full justify-center"
              >
                {t("signIn")}
              </Button>
            )}
          </div>
        </Glass>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:ms-[264px] flex flex-col min-w-0">
        {/* Desktop Header */}
        <header className="hidden lg:block sticky top-0 z-20 px-6 pt-3 pb-2">
          <div className="mx-auto w-full max-w-[1600px]">
            <Glass variant="chrome" className="rounded-3xl px-4 py-2.5 flex items-center justify-between gap-3">
              <form onSubmit={handleQuickSearch} className="flex-1 max-w-sm transition-all duration-300 focus-within:max-w-md">
                <SearchField
                  aria-label={t("navSearch")}
                  placeholder={t("searchPlaceholder")}
                  value={quickQuery}
                  onValueChange={setQuickQuery}
                />
              </form>

              <div className="flex items-center gap-2 ms-auto shrink-0">
                {/* Server Status Indicator Badge (Non-intrusive status pill) */}
                <div
                  aria-label="Server status"
                  title={
                    backendOnline
                      ? "Connected to Soundify Server"
                      : connectivityStatus === "vpn_or_server_down"
                      ? "Server unreachable - check VPN or internet connection"
                      : "Offline / Cached Data"
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border border-black/[0.04] dark:border-white/[0.06] shadow-sm text-xs font-semibold select-none"
                >
                  <span className="relative flex h-2 w-2 shrink-0">
                    {backendOnline ? (
                      <>
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.9)]" />
                      </>
                    ) : connectivityStatus === "vpn_or_server_down" ? (
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.9)]" />
                    ) : (
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.9)]" />
                    )}
                  </span>
                  <span className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                    {backendOnline
                      ? (lang === "fa" ? "سرور آنلاین" : "Server")
                      : connectivityStatus === "vpn_or_server_down"
                      ? (lang === "fa" ? "خطای سرور/فیلترشکن" : "Blocked")
                      : (lang === "fa" ? "حالت آفلاین" : "Offline")}
                  </span>
                </div>

                {/* Offline Mode Indicator Badge */}
                {isOffline && (
                  <Link
                    href="/library"
                    aria-label={t("offlineMode")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-bold transition-all hover:scale-105 active:scale-95"
                  >
                    <CloudSlashIcon size={16} weight="bold" className="shrink-0 animate-pulse text-amber-500" />
                    <span className="hidden sm:inline">{t("offlineMode")}</span>
                  </Link>
                )}

                {/* Apple Segmented Pill Language Toggle */}
                <div
                  role="group"
                  aria-label="Language selector"
                  className="relative inline-flex items-center rounded-full bg-black/[0.04] dark:bg-white/[0.08] p-0.5 backdrop-blur-xl border border-black/[0.04] dark:border-white/[0.06] shadow-[inset_0_1px_1px_rgba(0,0,0,0.06)]"
                >
                  <button
                    type="button"
                    onClick={() => lang !== "fa" && toggleLang()}
                    aria-pressed={lang === "fa"}
                    className={`relative z-10 rounded-full px-3 py-1.5 min-h-[32px] min-w-[34px] text-xs font-bold transition-all duration-200 cursor-pointer ${
                      lang === "fa"
                        ? "bg-white text-slate-950 dark:bg-white/20 dark:text-white shadow-[0_1px_3px_rgba(0,0,0,0.14)]"
                        : "text-[var(--sf-muted)] hover:text-[var(--sf-text)]"
                    }`}
                  >
                    فا
                  </button>
                  <button
                    type="button"
                    onClick={() => lang !== "en" && toggleLang()}
                    aria-pressed={lang === "en"}
                    className={`relative z-10 rounded-full px-3 py-1.5 min-h-[32px] min-w-[34px] text-xs font-bold transition-all duration-200 cursor-pointer ${
                      lang === "en"
                        ? "bg-white text-slate-950 dark:bg-white/20 dark:text-white shadow-[0_1px_3px_rgba(0,0,0,0.14)]"
                        : "text-[var(--sf-muted)] hover:text-[var(--sf-text)]"
                    }`}
                  >
                    EN
                  </button>
                </div>
              </div>
            </Glass>
          </div>
        </header>

        {/* Native Apple HIG Mobile Navigation Bar */}
        <header className="lg:hidden sticky top-0 z-30 pt-[max(0.5rem,var(--sat,env(safe-area-inset-top,0px)))] border-b border-black/[0.06] dark:border-white/[0.08] bg-white/92 dark:bg-[#070810]/92 backdrop-blur-md px-3.5 py-2.5 flex items-center justify-between gap-2 shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.25)]">
          {isSubPage ? (
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => router.back()}
                aria-label={lang === "fa" ? "بازگشت" : "Back"}
                className="inline-flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.09] dark:hover:bg-white/[0.14] text-[var(--sf-text)] active:scale-95 transition-all cursor-pointer border border-black/[0.04] dark:border-white/[0.1]"
              >
                {lang === "fa" ? (
                  <CaretRightIcon size={20} weight="bold" aria-hidden="true" />
                ) : (
                  <CaretLeftIcon size={20} weight="bold" aria-hidden="true" />
                )}
              </button>
              <span className="font-bold text-[16px] tracking-tight text-slate-900 dark:text-white truncate">
                {subPageTitle}
              </span>
            </div>
          ) : (
            <Link href="/" className="flex items-center gap-2 min-w-0 shrink group">
              <img
                src="/images/logo-icon.png"
                alt={t("brandName")}
                width={28}
                height={28}
                className="h-7 w-7 shrink-0 object-contain rounded-xl drop-shadow-[0_2px_8px_rgba(0,0,0,0.2)]"
              />
              <span className="font-extrabold text-[15px] tracking-tight text-slate-900 dark:text-white">
                {t("brandName")}
              </span>
            </Link>
          )}

          <div className="flex items-center gap-1.5 ms-auto shrink-0">
            {/* Calm Apple Server Status Indicator (clean static dot, no ping distraction) */}
            <div
              aria-label="Server status"
              title={
                backendOnline
                  ? "Connected to Soundify Server"
                  : connectivityStatus === "vpn_or_server_down"
                  ? "Server unreachable - check VPN or internet connection"
                  : "Offline / Cached Data"
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border border-black/[0.04] dark:border-white/[0.06] text-xs font-semibold select-none"
            >
              <span className="relative flex h-2 w-2 shrink-0">
                {backendOnline ? (
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.7)]" />
                ) : connectivityStatus === "vpn_or_server_down" ? (
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500 shadow-[0_0_5px_rgba(244,63,94,0.7)]" />
                ) : (
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400 shadow-[0_0_5px_rgba(34,211,238,0.7)]" />
                )}
              </span>
              <span className="text-[10.5px] font-bold text-slate-700 dark:text-slate-200">
                {backendOnline
                  ? (lang === "fa" ? "آنلاین" : "Online")
                  : connectivityStatus === "vpn_or_server_down"
                  ? (lang === "fa" ? "قطع سرور" : "Blocked")
                  : (lang === "fa" ? "آفلاین" : "Offline")}
              </span>
            </div>

            {/* Offline Mode Indicator Badge */}
            {isOffline && (
              <Link
                href="/library"
                aria-label={t("offlineMode")}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs font-bold"
              >
                <CloudSlashIcon size={14} weight="bold" className="shrink-0 text-amber-500" />
              </Link>
            )}

            {/* Apple Segmented Pill Language Toggle */}
            <div
              role="group"
              aria-label="Language selector"
              className="relative inline-flex items-center rounded-full bg-black/[0.04] dark:bg-white/[0.08] p-0.5 backdrop-blur-xl border border-black/[0.04] dark:border-white/[0.06]"
            >
              <button
                type="button"
                onClick={() => lang !== "fa" && toggleLang()}
                aria-pressed={lang === "fa"}
                className={`relative z-10 rounded-full px-2 py-0.5 min-h-[28px] min-w-[28px] text-[11px] font-bold transition-all duration-200 cursor-pointer ${
                  lang === "fa"
                    ? "bg-white text-slate-950 dark:bg-white/20 dark:text-white shadow-[0_1px_3px_rgba(0,0,0,0.14)]"
                    : "text-[var(--sf-muted)] hover:text-[var(--sf-text)]"
                }`}
              >
                فا
              </button>
              <button
                type="button"
                onClick={() => lang !== "en" && toggleLang()}
                aria-pressed={lang === "en"}
                className={`relative z-10 rounded-full px-2 py-0.5 min-h-[28px] min-w-[28px] text-[11px] font-bold transition-all duration-200 cursor-pointer ${
                  lang === "en"
                    ? "bg-white text-slate-950 dark:bg-white/20 dark:text-white shadow-[0_1px_3px_rgba(0,0,0,0.14)]"
                    : "text-[var(--sf-muted)] hover:text-[var(--sf-text)]"
                }`}
              >
                EN
              </button>
            </div>

            {!user ? (
              <Button
                type="button"
                variant="filled"
                onClick={openAuthDialog}
                icon={<UserCircleIcon size={16} aria-hidden="true" />}
                className="!min-h-[30px] !px-2.5 !py-0.5 !text-[11px]"
              >
                {t("signIn")}
              </Button>
            ) : (
              <Link
                href="/profile"
                className="inline-flex h-8 w-8 min-h-[32px] min-w-[32px] items-center justify-center rounded-full text-xs font-bold text-white shadow-sm"
                style={{ backgroundColor: user.avatarColor }}
                aria-label={t("navProfile")}
              >
                {user.displayName.slice(0, 1).toUpperCase()}
              </Link>
            )}
          </div>
        </header>

        {/* Apple HIG Server Connectivity & VPN Alert Banner (Global Floating Pill) */}
        {connectivityStatus === "vpn_or_server_down" && !bannerDismissed && (
          <aside
            role="alert"
            aria-live="assertive"
            style={{
              top: "calc(env(safe-area-inset-top, 0px) + 64px)",
            }}
            className="fixed inset-x-3.5 sm:inset-x-auto sm:start-1/2 sm:-translate-x-1/2 max-w-xl w-[calc(100%-28px)] sm:w-auto z-[9999] pointer-events-auto transition-all duration-300 ease-out animate-in fade-in slide-in-from-top-4"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-[22px] bg-black/85 dark:bg-[#160d10]/95 border border-rose-500/35 shadow-[0_16px_40px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-3xl text-white ring-1 ring-white/5">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.9)]" />
                </span>
                <p className="text-xs sm:text-[13px] font-medium text-rose-100 leading-snug">
                  {lang === "fa"
                    ? "عدم برقراری ارتباط با سرور - اتصال اینترنت یا وضعیت فیلترشکن خود را بررسی کنید"
                    : "Cannot connect to server - check internet connection or VPN status"}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    void triggerHapticFeedback("selection");
                    try {
                      const res = await checkBackendHealth();
                      setBackendOnline(res.ok);
                      setConnectivityStatus(res.ok ? "online" : "vpn_or_server_down");
                      if (res.ok) setBannerDismissed(false);
                    } catch {
                      setBackendOnline(false);
                      setConnectivityStatus("vpn_or_server_down");
                    }
                  }}
                  className="min-h-[32px] px-3.5 py-1 text-xs font-semibold rounded-full bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/35 active:scale-95 transition-all cursor-pointer"
                >
                  {lang === "fa" ? "تلاش مجدد" : "Retry"}
                </button>
                <button
                  type="button"
                  onClick={() => setBannerDismissed(true)}
                  aria-label={t("close")}
                  className="h-7 w-7 min-h-[28px] min-w-[28px] inline-flex items-center justify-center rounded-full text-rose-300/70 hover:text-white hover:bg-white/10 active:scale-95 transition-all cursor-pointer"
                >
                  <XIcon size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          </aside>
        )}

        <main id="main-content" tabIndex={-1} className="flex-1 px-3 sm:px-6 pt-3 pb-[max(15.5rem,calc(13rem+var(--sab,env(safe-area-inset-bottom,0px))))] md:pb-48 lg:pb-32">
          <div key={pathname} className="mx-auto w-full max-w-[1600px]">
            {children}
          </div>
        </main>
      </div>

      {/* Native Apple HIG Liquid Glass Mobile Tab Bar */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 select-none touch-manipulation [user-select:none] [-webkit-user-select:none] [-webkit-touch-callout:none] border-t border-black/[0.08] dark:border-white/[0.1] bg-white/92 dark:bg-[#070913]/92 backdrop-blur-md pt-1.5 pb-[max(0.75rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+0.35rem))] shadow-[0_-4px_24px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.7)] dark:shadow-[0_-8px_32px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.08)]"
      >
        <div className="relative mx-auto max-w-md px-1.5">
          {/* GPU-gliding Liquid Glass Active Pill */}
          {activeTabIndex >= 0 && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0.5 inset-x-1.5">
              <div
                className="h-full w-1/5 px-1 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{
                  transform: `translate3d(${(dir === "rtl" ? -activeTabIndex : activeTabIndex) * 100}%, 0, 0)`,
                }}
              >
                <div className="h-full w-full rounded-2xl bg-indigo-500/[0.11] dark:bg-indigo-400/[0.15] border border-indigo-500/20 dark:border-indigo-400/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]" />
              </div>
            </div>
          )}

          <div className="relative z-10 grid grid-cols-5 items-center">
            {navItems.map((item, idx) => {
              const active = idx === activeTabIndex;
              return (
                <Link
                  key={item.value}
                  href={item.href}
                  onClick={() => void triggerHapticFeedback("selection")}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  className={`sf-press group relative flex flex-col items-center justify-center min-h-[48px] py-1 px-1 rounded-2xl cursor-pointer outline-none select-none touch-manipulation [-webkit-user-select:none] [-webkit-touch-callout:none] ${
                    active
                      ? "text-indigo-600 dark:text-indigo-400 font-semibold"
                      : "text-slate-400 dark:text-zinc-400 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  <span className="relative flex items-center justify-center">
                    <span
                      className={`relative z-10 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                        active
                          ? "scale-105 text-indigo-600 dark:text-indigo-400 sf-spring-pop"
                          : "opacity-75 group-hover:opacity-100"
                      }`}
                    >
                      {item.icon(active, 24)}
                    </span>
                  </span>
                  <span
                    className={`text-[10px] leading-tight mt-1 tracking-tight truncate max-w-full px-0.5 select-none transition-colors duration-200 ${
                      active
                        ? "font-bold text-indigo-600 dark:text-indigo-400"
                        : "font-medium text-slate-500 dark:text-zinc-400 group-hover:text-slate-800 dark:group-hover:text-slate-300"
                    }`}
                  >
                    {item.mobileLabel}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <PlayerDock />
      <LazyNowPlayingOverlay />
      <LazyAuthDialog />
      <DevicePickerPopover />
      <AppUpdateDialog />
    </div>
  );
}
