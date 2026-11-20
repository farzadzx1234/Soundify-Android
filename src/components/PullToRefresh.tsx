"use client";

import React, { useCallback, useRef, useState } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react";
import { useI18n } from "@/context/I18nContext";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";

export interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  pullThreshold?: number; // default: 64px
}

/**
 * Mobile-First Liquid Glass Pull-To-Refresh Component
 *
 * Provides smooth spring-loaded pull-to-refresh with:
 * - Top edge boundary detection (only pulls when window/container is at top)
 * - Damped logarithmic drag resistance
 * - Tactile haptic feedback on threshold cross and release
 * - Subtle liquid glass spinner indicator centered for both RTL and LTR
 */
export function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
  className = "",
  pullThreshold = 64,
}: PullToRefreshProps) {
  const { t } = useI18n();
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const isEligibleRef = useRef(false);
  const hasTriggeredThresholdHaptic = useRef(false);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (disabled || isRefreshing || e.touches.length !== 1) return;

      const target = e.target as HTMLElement | null;
      if (target?.closest('[role="slider"], input, select, textarea, [data-prevent-pull-refresh]')) {
        isEligibleRef.current = false;
        return;
      }

      // Check if touch originated inside a scrolled child container
      let el: HTMLElement | null = target;
      while (el && el !== containerRef.current) {
        if (el.scrollHeight > el.clientHeight) {
          const overflowY = typeof window !== "undefined" ? window.getComputedStyle(el).overflowY : "";
          if ((overflowY === "auto" || overflowY === "scroll") && el.scrollTop > 2) {
            isEligibleRef.current = false;
            return;
          }
        }
        el = el.parentElement;
      }

      // Only initiate pull-to-refresh when at the very top of the scroll container
      const container = containerRef.current;
      const scrollY = typeof window !== "undefined" ? window.scrollY : 0;
      const containerTop = container ? container.scrollTop : 0;

      if (scrollY <= 2 && containerTop <= 2) {
        startYRef.current = e.touches[0].clientY;
        startXRef.current = e.touches[0].clientX;
        isEligibleRef.current = true;
        hasTriggeredThresholdHaptic.current = false;
      } else {
        isEligibleRef.current = false;
      }
    },
    [disabled, isRefreshing],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isEligibleRef.current || disabled || isRefreshing) return;
      if (e.touches.length !== 1) {
        isEligibleRef.current = false;
        setIsPulling(false);
        setPullDistance(0);
        return;
      }

      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const deltaY = currentY - startYRef.current;
      const deltaX = currentX - startXRef.current;

      // If user is swiping horizontally or scrolling up, cancel eligibility
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        isEligibleRef.current = false;
        setIsPulling(false);
        setPullDistance(0);
        return;
      }

      if (deltaY > 0) {
        // Damped pull distance
        const damped = Math.min(96, Math.pow(deltaY, 0.85) * 1.5);
        setPullDistance(damped);
        setIsPulling(true);

        // Tactile selection tick when reaching pull threshold
        if (damped >= pullThreshold && !hasTriggeredThresholdHaptic.current) {
          hasTriggeredThresholdHaptic.current = true;
          void triggerHapticFeedback("selection");
        } else if (damped < pullThreshold && hasTriggeredThresholdHaptic.current) {
          hasTriggeredThresholdHaptic.current = false;
        }

        if (e.cancelable && damped > 8) {
          try {
            e.preventDefault();
          } catch {
            // Ignored if passive
          }
        }
      } else {
        setPullDistance(0);
        setIsPulling(false);
      }
    },
    [disabled, isRefreshing, pullThreshold],
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isEligibleRef.current || disabled || isRefreshing) return;
    isEligibleRef.current = false;
    setIsPulling(false);

    if (pullDistance >= pullThreshold) {
      setIsRefreshing(true);
      setPullDistance(48); // Hold spinner in view while refreshing
      void triggerHapticFeedback("refresh");

      try {
        await Promise.resolve(onRefresh());
      } catch {
        // Non-fatal
      } finally {
        setIsRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [disabled, isRefreshing, onRefresh, pullDistance, pullThreshold]);

  const handleTouchCancel = useCallback(() => {
    isEligibleRef.current = false;
    setIsPulling(false);
    if (!isRefreshing) {
      setPullDistance(0);
    }
  }, [isRefreshing]);

  const rotationDeg = Math.min(360, (pullDistance / pullThreshold) * 360);
  const opacity = isRefreshing ? 1 : Math.min(1, Math.max(0, (pullDistance - 10) / 36));

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      className={`relative sf-no-bounce ${className}`}
    >
      {/* Liquid Glass Pull Indicator */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-1.5 flex justify-center z-30 transition-transform duration-200 ease-out"
        style={{
          transform: `translate3d(0, ${pullDistance}px, 0)`,
          opacity,
        }}
      >
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#0a0d14]/92 dark:bg-[#0c0e18]/94 border border-white/18 shadow-[0_12px_28px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur-2xl text-white text-xs font-semibold">
          <CircleNotchIcon
            size={16}
            className={`shrink-0 ${isRefreshing ? "animate-spin text-indigo-400" : "text-white/85"}`}
            style={{
              transform: isRefreshing ? undefined : `rotate(${rotationDeg}deg)`,
              transition: isPulling ? "none" : "transform 0.25s ease-out",
            }}
          />
          <span className="tabular-nums">
            {isRefreshing
              ? t("refreshing")
              : pullDistance >= pullThreshold
              ? t("releaseToRefresh")
              : t("pullToRefresh")}
          </span>
        </div>
      </div>

      {/* Content wrapper with rubber-band elastic displacement */}
      <div
        style={{
          transform: pullDistance > 0 ? `translate3d(0, ${pullDistance * 0.55}px, 0)` : undefined,
          transition: isPulling ? "none" : "transform 0.32s cubic-bezier(0.18, 0.89, 0.32, 1)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
