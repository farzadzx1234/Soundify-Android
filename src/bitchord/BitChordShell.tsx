"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { BitChordArtistSheet } from "./BitChordArtistSheet";
import { OPEN_ARTIST_PROFILE_EVENT, type OpenArtistDetail } from "./artistNavigation";
import { notifySleepTimerTrackChanged, registerSleepTimerExpireHandler } from "./sleepTimer";
import { BC_MOTION, PillSquashModel, stepSpring, usePrefersReducedMotion } from "./motion";
import type { Track } from "@/lib/types";

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

interface NavTabItem {
  value: string;
  href: string;
  label: string;
  mobileLabel: string;
  icon: (active: boolean, size?: number) => React.ReactNode;
}

/**
 * BitChord FloatingBottomBar + GlassSelectionPill physics:
 * - Travel spring: stiffness 280, damping 31.4
 * - Lift X/Y springs: stiffness 250, dampingX 19.0, dampingY 22.1
 * - Acceleration-coupled squash & stretch (STRETCH = 0.16, SQUASH = 0.5)
 * - Horizontal drag across tabs with haptic boundary ticks & spring settle
 */
const FloatingLiquidTabBar = React.memo(function FloatingLiquidTabBar({
  navItems,
  activeTabIndex,
  dir,
  onSelectIndex,
}: {
  navItems: NavTabItem[];
  activeTabIndex: number;
  dir: "rtl" | "ltr";
  onSelectIndex: (idx: number) => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTab: number;
    moved: boolean;
    lastHapticTab: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const n = navItems.length;
  const safeActive = activeTabIndex >= 0 ? activeTabIndex : 0;
  const prevActiveIndexRef = useRef(activeTabIndex);
  const squashModelRef = useRef<PillSquashModel | null>(null);

  const stateRef = useRef({
    pos: safeActive,
    vel: 0,
    target: safeActive,
    from: safeActive,
    travelSign: 0,
    travelSignEased: 0,
    squash: 0,
    liftX: 0,
    liftXVel: 0,
    liftY: 0,
    liftYVel: 0,
    lifted: false,
    dragging: false,
    dragTarget: safeActive,
    dragFollow: safeActive,
    rafId: null as number | null,
    lastTime: 0,
  });

  const paintPill = useCallback(() => {
    const pill = pillRef.current;
    if (!pill) return;
    const s = stateRef.current;
    const activePos = s.dragging ? s.dragFollow : s.pos;
    const visualStep = dir === "rtl" ? -activePos : activePos;

    // Acceleration-coupled squash & stretch (GlassSelectionPill.kt) + lifted lens expansion
    const span = Math.max(0.001, Math.abs(s.target - s.from));
    const lag = s.dragging
      ? Math.min(1, Math.abs(s.dragTarget - s.dragFollow) * 1.4 + 0.18)
      : Math.min(1, Math.abs(s.target - s.pos) / Math.max(1, span * 0.75));

    const dev = s.squash;
    const stretchX = (1 + lag * BC_MOTION.TAB_STRETCH + s.liftX * 0.11) * (1 + dev);
    const squashY = (1 - lag * BC_MOTION.TAB_STRETCH * BC_MOTION.TAB_SQUASH + s.liftY * 0.15) * (1 - dev);

    pill.style.transform = `translate3d(${(visualStep * 100).toFixed(3)}%, 0, 0) scale3d(${stretchX.toFixed(4)}, ${squashY.toFixed(4)}, 1)`;
    pill.setAttribute("data-lifted", s.lifted || s.liftX > 0.04 ? "true" : "false");
  }, [dir]);

  const startLoop = useCallback(() => {
    const s = stateRef.current;
    if (s.rafId !== null) return;
    s.lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - s.lastTime) / 1000));
      s.lastTime = now;

      let travelSettled = true;
      if (!s.dragging) {
        const [np, nv] = stepSpring(
          s.pos,
          s.vel,
          s.target,
          dt,
          BC_MOTION.TAB_TRAVEL_STIFFNESS,
          BC_MOTION.TAB_TRAVEL_DAMPING,
        );
        s.pos = np;
        s.vel = nv;
        travelSettled = Math.abs(np - s.target) < 0.003 && Math.abs(nv) < 0.04;
        if (travelSettled) {
          s.pos = s.target;
          s.vel = 0;
        }
      } else {
        s.dragFollow += (s.dragTarget - s.dragFollow) * (1 - Math.exp(-dt / 0.05));
        s.pos = s.dragFollow;
      }

      const span = Math.abs(s.target - s.from);
      const progress = span < 1e-4 ? 1 : Math.min(1, 1 - Math.abs(s.target - s.pos) / span);
      if (!s.dragging && (travelSettled || progress >= BC_MOTION.TAB_HANDOVER_START)) {
        s.lifted = false;
      }

      const liftTarget = s.lifted ? 1 : 0;
      const [lx, lxv] = stepSpring(
        s.liftX,
        s.liftXVel,
        liftTarget,
        dt,
        BC_MOTION.TAB_LIFT_STIFFNESS,
        BC_MOTION.TAB_LIFT_DAMPING_X,
      );
      const [ly, lyv] = stepSpring(
        s.liftY,
        s.liftYVel,
        liftTarget,
        dt,
        BC_MOTION.TAB_LIFT_STIFFNESS,
        BC_MOTION.TAB_LIFT_DAMPING_Y,
      );
      s.liftX = Math.abs(lx - liftTarget) < 0.001 && Math.abs(lxv) < 0.01 ? liftTarget : lx;
      s.liftXVel = s.liftX === liftTarget ? 0 : lxv;
      s.liftY = Math.abs(ly - liftTarget) < 0.001 && Math.abs(lyv) < 0.01 ? liftTarget : ly;
      s.liftYVel = s.liftY === liftTarget ? 0 : lyv;

      // Acceleration-coupled squash model (GlassSelectionPill.kt)
      const trackW = trackRef.current?.offsetWidth ?? 320;
      const stepPx = Math.max(40, trackW / n);
      const frac = s.dragging ? s.dragFollow : s.pos;
      if (!squashModelRef.current) {
        squashModelRef.current = new PillSquashModel();
      }
      const squashModel = squashModelRef.current;
      if (squashModel) {
        if (!squashModel.isTracking) squashModel.start();
        let nextSquash = squashModel.track(frac * stepPx, now / 1000, dt);
        if (s.travelSignEased === 0) {
          s.travelSignEased = s.travelSign;
        } else if (s.travelSignEased !== s.travelSign) {
          s.travelSignEased += (s.travelSign - s.travelSignEased) * (1 - Math.exp(-dt / 0.25));
          if (Math.abs(s.travelSign - s.travelSignEased) < 0.01) s.travelSignEased = s.travelSign;
        }
        const key = s.travelSignEased;
        if (key !== 0) {
          nextSquash = nextSquash * (1 - Math.abs(key)) - key * Math.abs(nextSquash);
        }
        s.squash = nextSquash;
      }

      paintPill();

      const liftSettled = !s.lifted && s.liftX === 0 && s.liftY === 0;
      if (!s.dragging && travelSettled && liftSettled && Math.abs(s.squash) < 0.001) {
        s.squash = 0;
        s.travelSign = 0;
        s.travelSignEased = 0;
        squashModel?.stop();
        s.rafId = null;
        return;
      }
      s.rafId = requestAnimationFrame(tick);
    };

    s.rafId = requestAnimationFrame(tick);
  }, [n, paintPill]);

  useLayoutEffect(() => {
    const s = stateRef.current;
    const prevIdx = prevActiveIndexRef.current;
    prevActiveIndexRef.current = activeTabIndex;
    if (s.dragging) return;
    if (reducedMotion || (prevIdx < 0 && activeTabIndex >= 0)) {
      if (s.rafId !== null) {
        cancelAnimationFrame(s.rafId);
        s.rafId = null;
      }
      s.pos = safeActive;
      s.target = safeActive;
      s.from = safeActive;
      s.vel = 0;
      s.travelSign = 0;
      s.travelSignEased = 0;
      s.squash = 0;
      s.lifted = false;
      s.liftX = 0;
      s.liftY = 0;
      squashModelRef.current?.stop();
      paintPill();
      return;
    }
    if (s.target !== safeActive) {
      s.from = s.pos;
      s.target = safeActive;
      s.travelSign = Math.sign(safeActive - s.pos);
      s.lifted = true;
      startLoop();
    } else {
      paintPill();
    }
  }, [activeTabIndex, safeActive, reducedMotion, paintPill, startLoop]);

  useEffect(() => {
    const state = stateRef.current;
    return () => {
      if (state.rafId !== null) {
        cancelAnimationFrame(state.rafId);
      }
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || e.button !== 0) return;
    suppressClickRef.current = false;
    const s = stateRef.current;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTab: safeActive,
      moved: false,
      lastHapticTab: safeActive,
    };
    if (!reducedMotion) {
      s.lifted = true;
      startLoop();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const track = trackRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !track) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    // Require deliberate horizontal swipe (>= 22px & horizontally dominant) so mobile taps never hijack Settings/other tabs
    if (!drag.moved) {
      if (Math.abs(dx) < 22 || Math.abs(dx) <= Math.abs(dy) * 1.4) return;
      drag.moved = true;
      suppressClickRef.current = true;
      try {
        track.setPointerCapture(e.pointerId);
      } catch {}
      const s = stateRef.current;
      s.dragging = true;
      s.dragFollow = s.pos;
      s.dragTarget = s.pos;
      s.lifted = !reducedMotion;
      startLoop();
    }

    const rect = track.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const rel = dir === "rtl" ? (rect.right - e.clientX) / width : (e.clientX - rect.left) / width;
    const clamped = Math.max(0, Math.min(n - 1, rel * n - 0.5));
    stateRef.current.dragTarget = clamped;

    const approx = Math.round(clamped);
    if (approx !== drag.lastHapticTab) {
      drag.lastHapticTab = approx;
      void triggerHapticFeedback("selection");
    }
  };

  const finishPointer = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    const track = trackRef.current;
    if (track && track.hasPointerCapture(e.pointerId)) {
      try {
        track.releasePointerCapture(e.pointerId);
      } catch {}
    }

    const s = stateRef.current;
    if (drag.moved) {
      const targetIdx = cancelled
        ? safeActive
        : Math.max(0, Math.min(n - 1, Math.round(s.dragTarget)));
      s.dragging = false;
      s.from = s.dragFollow;
      s.pos = s.dragFollow;
      s.target = targetIdx;
      s.lifted = !reducedMotion;
      startLoop();
      if (!cancelled && targetIdx !== safeActive) {
        onSelectIndex(targetIdx);
      }
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 60);
    } else {
      s.lifted = false;
      startLoop();
    }
  };

  return (
    <nav
      aria-label="Mobile Navigation"
      className="lg:hidden fixed inset-x-[19px] bottom-[max(15px,calc(var(--sab,env(safe-area-inset-bottom,0px))+6px))] z-40 select-none touch-manipulation"
    >
      <div className="bc-pill-glass mx-auto max-w-md rounded-full p-1">
        <div
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => finishPointer(e, false)}
          onPointerCancel={(e) => finishPointer(e, true)}
          onClickCapture={(e) => {
            if (suppressClickRef.current) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          className="relative touch-pan-y"
        >
          {activeTabIndex >= 0 && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <div
                ref={pillRef}
                data-lifted="false"
                className="bc-tab-lens-pill h-full w-1/5 rounded-full will-change-transform"
              />
            </div>
          )}

          <div className="relative z-10 grid grid-cols-5 items-center">
            {navItems.map((item, idx) => {
              const active = idx === activeTabIndex;
              return (
                <Link
                  key={item.value}
                  href={item.href}
                  draggable={false}
                  onClick={() => {
                    void triggerHapticFeedback("selection");
                    if (active && typeof window !== "undefined") {
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }
                  }}
                  aria-label={item.label}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-col items-center justify-center min-h-[52px] py-1.5 px-1 rounded-full cursor-pointer outline-none select-none transition-colors duration-200 ${
                    active
                      ? "text-slate-950 dark:text-white font-bold"
                      : "text-slate-600 dark:text-white/65 hover:text-slate-900 dark:hover:text-white/90"
                  }`}
                >
                  <span
                    className="transition-transform duration-300 ease-[cubic-bezier(0.34,1.48,0.64,1)]"
                    style={{
                      transform: active && !reducedMotion ? "scale3d(1.08, 1.08, 1)" : "scale3d(1, 1, 1)",
                    }}
                  >
                    {item.icon(active, 23)}
                  </span>
                  <span className="text-[10px] tracking-[0.02em] leading-tight mt-0.5 truncate max-w-full px-0.5">
                    {item.mobileLabel}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
});

const MemoBitChordBackdrop = React.memo(BitChordBackdrop);

function BitChordSleepTimerSync() {
  const { isPlaying, currentTrack, volume, togglePlay, setVolume } = usePlayer();
  const stateRef = useRef({ isPlaying, volume, togglePlay, setVolume });

  useEffect(() => {
    stateRef.current = { isPlaying, volume, togglePlay, setVolume };
  }, [isPlaying, volume, togglePlay, setVolume]);

  useEffect(() => {
    notifySleepTimerTrackChanged(currentTrack?.id);
  }, [currentTrack?.id]);

  useEffect(() => {
    let fadeTimer: number | null = null;
    registerSleepTimerExpireHandler((shouldFadeOut) => {
      const { isPlaying: playingNow, volume: startVol, togglePlay: toggleNow, setVolume: setVolNow } = stateRef.current;
      if (!playingNow) return;
      if (!shouldFadeOut) {
        toggleNow();
        return;
      }
      const steps = 12;
      let step = 0;
      if (fadeTimer) window.clearInterval(fadeTimer);
      fadeTimer = window.setInterval(() => {
        step += 1;
        const nextVol = Math.max(0.02, startVol * (1 - step / steps));
        setVolNow(nextVol);
        if (step >= steps) {
          if (fadeTimer) window.clearInterval(fadeTimer);
          fadeTimer = null;
          stateRef.current.togglePlay();
          window.setTimeout(() => stateRef.current.setVolume(startVol), 250);
        }
      }, 220);
    });
    return () => {
      if (fadeTimer) window.clearInterval(fadeTimer);
      registerSleepTimerExpireHandler(null);
    };
  }, []);

  return null;
}

export function BitChordShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, openAuthDialog, logout } = useAuth();
  const { lang, dir, toggleLang, t } = useI18n();
  const { isOffline, currentTrack } = usePlayer();
  const [quickQuery, setQuickQuery] = useState("");
  const [artistView, setArtistView] = useState<{ name: string; seedTrack: Track | null } | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean>(true);
  const [connectivityStatus, setConnectivityStatus] = useState<ServerConnectivityStatus>("online");
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Wire global Artist Profile overlay for New UI
  useEffect(() => {
    const onOpenArtist = (e: Event) => {
      const detail = (e as CustomEvent<OpenArtistDetail>).detail;
      if (detail?.artistName) {
        setArtistView({ name: detail.artistName, seedTrack: detail.seedTrack ?? null });
      }
    };
    window.addEventListener(OPEN_ARTIST_PROFILE_EVENT, onOpenArtist);
    return () => window.removeEventListener(OPEN_ARTIST_PROFILE_EVENT, onOpenArtist);
  }, []);

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
      <MemoBitChordBackdrop />
      <BitChordSleepTimerSync />

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
                  {lang === "fa" ? "شیشه مایع" : "Liquid Glass"}
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
        <header className="lg:hidden sticky top-0 z-30 pt-[max(0.6rem,var(--sat,env(safe-area-inset-top,0px)))] px-4 pb-4 flex items-center justify-between gap-2 pointer-events-none bg-gradient-to-b from-[#f4f4f6]/95 via-[#f4f4f6]/68 to-transparent dark:from-[#09090b]/95 dark:via-[#09090b]/68">
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
          <div key={pathname} className="bc-page-enter mx-auto w-full max-w-[1600px]">
            {children}
          </div>
        </main>
      </div>

      {/* BitChord BottomFadeScrim behind floating bottom bars */}
      <div
        aria-hidden="true"
        className={`lg:hidden pointer-events-none fixed inset-x-0 bottom-0 z-[35] bc-bottom-fade-scrim transition-[height] duration-200 ease-out ${
          currentTrack
            ? "h-[calc(8.5rem+max(15px,calc(var(--sab,env(safe-area-inset-bottom,0px))+6px)))]"
            : "h-[calc(5.2rem+max(15px,calc(var(--sab,env(safe-area-inset-bottom,0px))+6px)))]"
        }`}
      />

      {/* Mobile Floating Pill Bottom Nav (FloatingBottomBar.kt + GlassSelectionPill.kt physics) */}
      <FloatingLiquidTabBar
        navItems={navItems}
        activeTabIndex={activeTabIndex}
        dir={dir}
        onSelectIndex={(idx) => {
          const item = navItems[idx];
          if (item && idx !== activeTabIndex) {
            void triggerHapticFeedback("selection");
            router.push(item.href);
          }
        }}
      />

      <BitChordMiniPlayer />
      <LazyBitChordNowPlaying />
      <BitChordArtistSheet
        artistName={artistView?.name ?? null}
        seedTrack={artistView?.seedTrack ?? null}
        onClose={() => setArtistView(null)}
      />
      <LazyAuthDialog />
      <DevicePickerPopover />
      <PlaylistPickerSheet />
      <AppUpdateDialog />
      <AppLaunchSplash />
    </div>
  );
}
