"use client";

import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
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
import { AppLaunchSplash } from "@/components/AppLaunchSplash";
import { DevicePickerPopover } from "@/components/DevicePickerPopover";
import { Button, SearchField } from "@/components/GlassControls";
import { InstallPwaButton } from "@/components/InstallPwaButton";
import { PlaylistPickerSheet } from "@/components/PlaylistPickerSheet";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";
import { usePlayer } from "@/context/PlayerContext";
import { checkBackendHealth } from "@/lib/api";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";
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
import { BitChordBackdrop } from "./BitChordBackdrop";
import { BitChordMiniPlayer } from "./BitChordMiniPlayer";

const BitChordNowPlaying = dynamic(
  () => import("./BitChordNowPlaying").then((m) => m.BitChordNowPlaying),
  { ssr: false },
);

const AuthDialog = dynamic(
  () => import("@/components/AuthDialog").then((m) => m.AuthDialog),
  { ssr: false },
);

const AppUpdateDialog = dynamic(
  () => import("@/components/AppUpdateDialog").then((m) => m.AppUpdateDialog),
  { ssr: false },
);

function LazyBitChordNowPlaying() {
  const { expanded } = usePlayer();
  if (!expanded) return null;
  return <BitChordNowPlaying />;
}

function LazyAuthDialog() {
  const { authDialogOpen } = useAuth();
  if (!authDialogOpen) return null;
  return <AuthDialog />;
}

export function BitChordShell({ children }: { children: React.ReactNode }) {
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

  // Keep data-ui-skin="bitchord" locked on <html> even across hydration recovery passes
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-ui-skin", "bitchord");
    return () => {
      document.documentElement.removeAttribute("data-ui-skin");
    };
  }, []);

  useEffect(() => {
    let active = true;

    const verifyConnectivity = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
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
    const handleOffline = () => void triggerImmediateNetworkProbe();
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
    pathname.startsWith("/profile") ||
    pathname.startsWith("/history") ||
    pathname.startsWith("/studio") ||
    pathname.startsWith("/settings");

  const handleQuickSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = quickQuery.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  return (
    <div className="relative z-0 min-h-dvh flex flex-col lg:flex-row overflow-x-clip">
      <BitChordBackdrop />

      <a href="#main-content" className="skip-link">
        {t("skipToContent")}
      </a>

      {/* Desktop BitChord Obsidian Sidebar */}
      <aside className="hidden lg:flex lg:fixed lg:inset-y-4 lg:start-4 lg:w-60 z-30">
        <div className="bc-pill-glass w-full rounded-[28px] p-4 flex flex-col justify-between">
          <div className="space-y-6">
            <Link href="/" className="flex items-center gap-3 px-2 py-1 group">
              <img
                src="/images/logo-icon.png"
                alt={t("brandName")}
                width={38}
                height={38}
                className="h-9 w-9 object-contain rounded-xl shadow-md transition-transform duration-300 group-hover:scale-105"
              />
              <div>
                <span className="block font-black text-lg leading-tight tracking-tight text-slate-900 dark:text-white">
                  {t("brandName")}
                </span>
                <span className="block text-[10.5px] text-slate-500 dark:text-zinc-400 font-semibold tracking-wide">
                  BitChord Edition
                </span>
              </div>
            </Link>

            <nav aria-label="Primary">
              <ul className="space-y-1">
                {navItems.map((item) => {
                  const active =
                    item.value === "/" ? pathname === "/" || pathname === "" : pathname.startsWith(item.value);
                  return (
                    <li key={item.value}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`bc-control-btn group flex items-center gap-3 rounded-full px-4 py-2.5 text-[13.5px] ${
                          active
                            ? "bg-slate-900 text-white dark:bg-white dark:text-zinc-950 font-bold shadow-sm"
                            : "font-medium text-slate-600 dark:text-zinc-400 hover:text-slate-950 dark:hover:text-white hover:bg-black/[0.05] dark:hover:bg-white/[0.08]"
                        }`}
                      >
                        <span className={active ? "" : "opacity-80 group-hover:opacity-100"}>
                          {item.icon(active, 19)}
                        </span>
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>

          <div className="space-y-2.5 pt-4 border-t border-black/[0.07] dark:border-white/[0.08]">
            <InstallPwaButton compact />
            {user ? (
              <div className="flex items-center justify-between gap-2 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border border-black/[0.05] dark:border-white/[0.08] px-3 py-1.5">
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
                  <span className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                    {user.displayName}
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => void logout()}
                  aria-label={t("signOut")}
                  className="p-1.5 rounded-full text-slate-500 dark:text-zinc-400 hover:text-slate-950 dark:hover:text-white cursor-pointer"
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
                className="w-full justify-center !bg-slate-950 !text-white dark:!bg-white dark:!text-zinc-950"
              >
                {t("signIn")}
              </Button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:ms-[268px] flex flex-col min-w-0">
        {/* Desktop Header */}
        <header className="hidden lg:block sticky top-0 z-20 px-6 pt-3 pb-2">
          <div className="mx-auto w-full max-w-[1600px]">
            <div className="bc-pill-glass rounded-full px-4 py-2 flex items-center justify-between gap-3">
              <form onSubmit={handleQuickSearch} className="flex-1 max-w-sm transition-all duration-300 focus-within:max-w-md">
                <SearchField
                  aria-label={t("navSearch")}
                  placeholder={t("searchPlaceholder")}
                  value={quickQuery}
                  onValueChange={setQuickQuery}
                />
              </form>

              <div className="flex items-center gap-2 ms-auto shrink-0">
                <div
                  aria-label="Server status"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/[0.04] dark:bg-white/[0.08] text-xs font-semibold select-none"
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      backendOnline
                        ? "bg-emerald-500"
                        : connectivityStatus === "vpn_or_server_down"
                          ? "bg-rose-500"
                          : "bg-cyan-400"
                    }`}
                  />
                  <span className="text-[11px] font-bold text-slate-800 dark:text-zinc-200">
                    {backendOnline
                      ? lang === "fa"
                        ? "سرور آنلاین"
                        : "Server"
                      : connectivityStatus === "vpn_or_server_down"
                        ? lang === "fa"
                          ? "قطع سرور"
                          : "Blocked"
                        : lang === "fa"
                          ? "آفلاین"
                          : "Offline"}
                  </span>
                </div>

                {isOffline && (
                  <Link
                    href="/library"
                    aria-label={t("offlineMode")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-xs font-bold"
                  >
                    <CloudSlashIcon size={16} weight="bold" />
                    <span>{t("offlineMode")}</span>
                  </Link>
                )}

                <div
                  role="group"
                  aria-label="Language selector"
                  className="inline-flex items-center rounded-full bg-black/[0.04] dark:bg-white/[0.08] p-0.5"
                >
                  <button
                    type="button"
                    onClick={() => lang !== "fa" && toggleLang()}
                    aria-pressed={lang === "fa"}
                    className={`rounded-full px-3 py-1 min-h-[30px] text-xs font-bold transition-colors cursor-pointer ${
                      lang === "fa"
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-500 dark:text-zinc-400"
                    }`}
                  >
                    فا
                  </button>
                  <button
                    type="button"
                    onClick={() => lang !== "en" && toggleLang()}
                    aria-pressed={lang === "en"}
                    className={`rounded-full px-3 py-1 min-h-[30px] text-xs font-bold transition-colors cursor-pointer ${
                      lang === "en"
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-500 dark:text-zinc-400"
                    }`}
                  >
                    EN
                  </button>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Mobile BitChord Top Header (photo_2 / photo_4 frosted circular & pill controls) */}
        <header className="lg:hidden sticky top-0 z-30 pt-[max(0.6rem,var(--sat,env(safe-area-inset-top,0px)))] px-4 pb-3 flex items-center justify-between gap-2 pointer-events-none bg-gradient-to-b from-[#f4f4f6]/90 via-[#f4f4f6]/55 to-transparent dark:from-[#09090b]/90 dark:via-[#09090b]/55">
          <div className="pointer-events-auto flex items-center gap-2 min-w-0">
            {isSubPage ? (
              <button
                type="button"
                onClick={() => {
                  void triggerHapticFeedback("selection");
                  if (typeof window !== "undefined" && window.history.length > 1) {
                    router.back();
                  } else {
                    router.push("/");
                  }
                }}
                aria-label={lang === "fa" ? "بازگشت" : "Back"}
                className="bc-pill-glass bc-control-btn inline-flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-900 dark:text-white cursor-pointer"
              >
                {lang === "fa" ? (
                  <CaretRightIcon size={20} weight="bold" aria-hidden="true" />
                ) : (
                  <CaretLeftIcon size={20} weight="bold" aria-hidden="true" />
                )}
              </button>
            ) : (
              <Link
                href="/"
                className="bc-pill-glass inline-flex items-center gap-2 rounded-full ps-2 pe-3.5 py-1.5 min-h-[40px]"
              >
                <img
                  src="/images/logo-icon.png"
                  alt={t("brandName")}
                  width={24}
                  height={24}
                  className="h-6 w-6 rounded-lg object-contain"
                />
                <span className="font-black text-sm tracking-tight text-slate-900 dark:text-white">
                  {t("brandName")}
                </span>
              </Link>
            )}
          </div>

          <div className="bc-pill-glass pointer-events-auto inline-flex items-center gap-1 rounded-full px-2 py-1 min-h-[42px] shrink-0">
            <span
              aria-label="Server status"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10.5px] font-bold text-slate-700 dark:text-zinc-200"
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  backendOnline
                    ? "bg-emerald-500"
                    : connectivityStatus === "vpn_or_server_down"
                      ? "bg-rose-500"
                      : "bg-cyan-400"
                }`}
              />
              <span>
                {backendOnline
                  ? lang === "fa"
                    ? "آنلاین"
                    : "Online"
                  : connectivityStatus === "vpn_or_server_down"
                    ? lang === "fa"
                      ? "قطع"
                      : "Blocked"
                    : lang === "fa"
                      ? "آفلاین"
                      : "Offline"}
              </span>
            </span>

            {isOffline && (
              <Link
                href="/library"
                aria-label={t("offlineMode")}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/15 text-amber-500"
              >
                <CloudSlashIcon size={15} weight="bold" />
              </Link>
            )}

            <button
              type="button"
              onClick={() => {
                void triggerHapticFeedback("selection");
                toggleLang();
              }}
              aria-label="Toggle language"
              className="h-8 min-w-[32px] px-2 rounded-full bg-black/[0.06] dark:bg-white/[0.12] text-[11px] font-bold text-slate-900 dark:text-white cursor-pointer"
            >
              {lang === "fa" ? "فا" : "EN"}
            </button>

            {user ? (
              <Link
                href="/profile"
                aria-label={t("navProfile")}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shrink-0"
                style={{ backgroundColor: user.avatarColor }}
              >
                {user.displayName.slice(0, 1).toUpperCase()}
              </Link>
            ) : (
              <button
                type="button"
                onClick={openAuthDialog}
                aria-label={t("signIn")}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-white dark:bg-white dark:text-zinc-950 cursor-pointer"
              >
                <UserCircleIcon size={17} weight="bold" aria-hidden="true" />
              </button>
            )}
          </div>
        </header>

        {/* Global Server / VPN Connectivity Alert Banner */}
        {connectivityStatus === "vpn_or_server_down" && !bannerDismissed && (
          <aside
            role="alert"
            aria-live="assertive"
            style={{ top: "calc(env(safe-area-inset-top, 0px) + 64px)" }}
            className="fixed inset-x-3.5 sm:inset-x-auto sm:start-1/2 sm:-translate-x-1/2 max-w-xl w-[calc(100%-28px)] sm:w-auto z-[9999] pointer-events-auto"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-[22px] bg-[#160d10]/95 border border-rose-500/35 shadow-2xl backdrop-blur-2xl text-white">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500 shrink-0" />
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
                  className="min-h-[32px] px-3.5 py-1 text-xs font-semibold rounded-full bg-rose-500/20 text-rose-200 border border-rose-500/35 cursor-pointer"
                >
                  {lang === "fa" ? "تلاش مجدد" : "Retry"}
                </button>
                <button
                  type="button"
                  onClick={() => setBannerDismissed(true)}
                  aria-label={t("close")}
                  className="h-7 w-7 inline-flex items-center justify-center rounded-full text-rose-300/70 hover:text-white cursor-pointer"
                >
                  <XIcon size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          </aside>
        )}

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-3 sm:px-6 pt-2 pb-[max(15.5rem,calc(13.5rem+var(--sab,env(safe-area-inset-bottom,0px))))] lg:pb-32"
        >
          <div key={pathname} className="sf-page-enter mx-auto w-full max-w-[1600px]">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile Floating Pill Bottom Nav (BitChord photo_2 & photo_4 style) */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed inset-x-3.5 bottom-[max(0.75rem,calc(var(--sab,env(safe-area-inset-bottom,0px))+0.35rem))] z-40 select-none touch-manipulation"
      >
        <div className="bc-pill-glass relative mx-auto max-w-md rounded-full p-1.5">
          {activeTabIndex >= 0 && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-1.5">
              <div
                className="h-full w-1/5 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{
                  transform: `translate3d(${(dir === "rtl" ? -activeTabIndex : activeTabIndex) * 100}%, 0, 0)`,
                }}
              >
                <div className="h-full w-full rounded-full bg-black/[0.08] dark:bg-white/[0.15] border border-black/[0.04] dark:border-white/[0.1]" />
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
                  className={`bc-control-btn flex flex-col items-center justify-center min-h-[50px] py-1 px-1 rounded-full cursor-pointer outline-none select-none ${
                    active
                      ? "text-slate-950 dark:text-white font-bold"
                      : "text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200"
                  }`}
                >
                  <span className={`transition-transform duration-200 ${active ? "scale-105" : "opacity-80"}`}>
                    {item.icon(active, 21)}
                  </span>
                  <span className="text-[10px] leading-tight mt-0.5 truncate max-w-full px-0.5">
                    {item.mobileLabel}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      <BitChordMiniPlayer />
      <LazyBitChordNowPlaying />
      <LazyAuthDialog />
      <DevicePickerPopover />
      <PlaylistPickerSheet />
      <AppUpdateDialog />
      <AppLaunchSplash />
    </div>
  );
}
