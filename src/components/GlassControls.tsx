"use client";

import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  SegmentedControl as GlisseSegmentedControl,
} from "glisse";
import { CircleNotchIcon, DotsThreeIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { triggerHapticFeedback } from "@/lib/hapticFeedback";

export interface GlassProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "surface" | "chrome";
}

export function Glass({
  variant = "surface",
  className = "",
  children,
  ...rest
}: GlassProps) {
  return (
    <div
      className={`${variant === "chrome" ? "sf-glass-chrome" : "sf-content-surface"} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface GlassButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  type?: "button" | "submit" | "reset";
  variant?: "filled" | "glass" | "ghost";
  tint?: string;
  destructive?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  type = "button",
  variant = "glass",
  tint,
  destructive = false,
  icon,
  children,
  className = "",
  style,
  ...rest
}: GlassButtonProps) {
  const iconOnly = Boolean(icon) && (children === undefined || children === null || children === false);

  if (variant === "ghost") {
    return (
      <button
        type={type}
        style={style}
        className={`sf-btn inline-flex items-center justify-center gap-2 rounded-full font-semibold select-none cursor-pointer bg-transparent text-[var(--sf-text)] border border-transparent hover:bg-black/[0.05] dark:hover:bg-white/[0.07] active:scale-[0.96] transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
          iconOnly ? "h-11 w-11 min-h-[44px] min-w-[44px] p-0" : "min-h-[44px] px-4 py-2 text-sm"
        } ${destructive ? "text-rose-600 dark:text-rose-400" : ""} ${className}`}
        {...rest}
      >
        {icon && <span className="inline-flex shrink-0 items-center justify-center">{icon}</span>}
        {!iconOnly && <span className="truncate">{children}</span>}
      </button>
    );
  }

  if (variant === "filled") {
    const fillBg = destructive ? "#ef4444" : tint || "var(--sf-accent)";
    return (
      <button
        type={type}
        style={{ backgroundColor: fillBg, ...style }}
        className={`sf-btn inline-flex items-center justify-center gap-2 rounded-full font-semibold text-white select-none cursor-pointer border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_4px_16px_rgba(0,0,0,0.25)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_6px_22px_rgba(0,0,0,0.35)] hover:brightness-105 active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed ${
          iconOnly ? "h-11 w-11 min-h-[44px] min-w-[44px] p-0" : "min-h-[44px] px-5 py-2 text-sm"
        } ${className}`}
        {...rest}
      >
        {icon && <span className="inline-flex shrink-0 items-center justify-center">{icon}</span>}
        {!iconOnly && <span className="truncate">{children}</span>}
      </button>
    );
  }

  return (
    <button
      type={type}
      style={tint ? { color: tint, ...style } : style}
      className={`sf-btn inline-flex items-center justify-center gap-2 rounded-full font-medium select-none cursor-pointer bg-white/85 hover:bg-white dark:bg-white/[0.08] dark:hover:bg-white/[0.14] text-[var(--sf-text)] border border-black/[0.08] dark:border-white/[0.1] sm:backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_2px_8px_rgba(0,0,0,0.1)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_4px_14px_rgba(0,0,0,0.18)] active:scale-[0.96] disabled:opacity-40 disabled:cursor-not-allowed ${
        iconOnly ? "h-11 w-11 min-h-[44px] min-w-[44px] p-0" : "min-h-[44px] px-4 py-2 text-sm"
      } ${destructive ? "!text-rose-600 dark:!text-rose-400" : ""} ${className}`}
      {...rest}
    >
      {icon && <span className="inline-flex shrink-0 items-center justify-center">{icon}</span>}
      {!iconOnly && <span className="truncate">{children}</span>}
    </button>
  );
}

export interface GlassInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue"> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  icon?: React.ReactNode;
}

export function Input({
  value,
  defaultValue,
  onValueChange,
  onChange,
  icon,
  className = "",
  ...rest
}: GlassInputProps) {
  return (
    <div
      className={`flex h-10 w-full items-center gap-2.5 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] sm:backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] px-3.5 text-sm text-[var(--sf-text)] transition-colors focus-within:bg-black/[0.06] dark:focus-within:bg-white/[0.09] focus-within:border-indigo-400/50 focus-within:ring-2 focus-within:ring-[var(--sf-accent)]/40 ${className}`}
    >
      {icon && <span className="inline-flex shrink-0 text-[var(--sf-muted)]">{icon}</span>}
      <input
        value={value}
        defaultValue={defaultValue}
        onChange={(e) => {
          onValueChange?.(e.target.value);
          onChange?.(e);
        }}
        style={{ outline: "none", border: "none", boxShadow: "none" }}
        className="min-w-0 flex-1 bg-transparent text-sm text-inherit placeholder:text-[var(--sf-muted)] outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 shadow-none border-0 ring-0 [appearance:none] [-webkit-appearance:none]"
        {...rest}
      />
    </div>
  );
}

export interface GlassSearchFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
  onClear?: () => void;
  loading?: boolean;
}

export const SearchField = React.forwardRef<HTMLInputElement, GlassSearchFieldProps>(
  function SearchField(
    {
      value,
      onValueChange,
      placeholder,
      "aria-label": ariaLabel,
      className = "",
      onClear,
      loading = false,
      ...rest
    },
    forwardedRef,
  ) {
    const internalInputRef = useRef<HTMLInputElement>(null);

    // Keep internal ref and forwarded ref unified and immediately accessible
    const setRefs = useCallback(
      (node: HTMLInputElement | null) => {
        internalInputRef.current = node;
        if (typeof forwardedRef === "function") {
          forwardedRef(node);
        } else if (forwardedRef) {
          (forwardedRef as React.MutableRefObject<HTMLInputElement | null>).current = node;
        }
      },
      [forwardedRef],
    );

    const handleClear = useCallback(
      (e: React.SyntheticEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onValueChange("");
        onClear?.();
        // Keep focus on input after clearing
        internalInputRef.current?.focus();
      },
      [onValueChange, onClear],
    );

    return (
      <div
        onClick={() => internalInputRef.current?.focus()}
        className={`group relative flex h-10 w-full items-center gap-2.5 rounded-full bg-black/[0.04] dark:bg-white/[0.07] border border-black/[0.06] dark:border-white/[0.08] sm:backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_2px_8px_rgba(0,0,0,0.04)] px-3.5 text-sm text-[var(--sf-text)] transition-colors duration-200 focus-within:bg-white dark:focus-within:bg-white/[0.12] focus-within:border-indigo-500/40 focus-within:ring-2 focus-within:ring-indigo-500/30 ${className}`}
      >
        <span className="shrink-0 text-[var(--sf-muted)] transition-colors group-focus-within:text-indigo-600 dark:group-focus-within:text-indigo-400">
          {loading ? (
            <CircleNotchIcon size={17} className="animate-spin text-indigo-500" aria-hidden="true" />
          ) : (
            <MagnifyingGlassIcon size={17} aria-hidden="true" />
          )}
        </span>
        <input
          ref={setRefs}
          type="search"
          dir="auto"
          inputMode="search"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="search"
          style={{ outline: "none", border: "none", boxShadow: "none" }}
          className="min-w-0 flex-1 bg-transparent text-base sm:text-sm text-inherit placeholder:text-[var(--sf-muted)]/70 placeholder:text-xs sm:placeholder:text-sm outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 shadow-none border-0 ring-0 [appearance:none] [-webkit-appearance:none] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:[-webkit-appearance:none] [&::-webkit-search-decoration]:hidden"
          {...rest}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={handleClear}
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
          aria-label="Clear search"
          aria-hidden={!value}
          className={`inline-flex h-8 w-8 min-h-[36px] min-w-[36px] -me-1.5 shrink-0 items-center justify-center rounded-full text-[var(--sf-muted)] hover:text-[var(--sf-text)] cursor-pointer transition-opacity duration-150 ${
            value ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
          }`}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/[0.1] dark:bg-white/[0.16] text-[var(--sf-muted)] hover:bg-black/[0.18] dark:hover:bg-white/[0.25] hover:text-[var(--sf-text)]">
            <XIcon size={11} weight="bold" aria-hidden="true" />
          </span>
        </button>
      </div>
    );
  },
);

SearchField.displayName = "SearchField";

export interface GlassSliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  defaultValue?: number;
  onValueChange: (value: number) => void;
  "aria-label"?: string;
  className?: string;
  style?: React.CSSProperties;
  onPointerDown?: (e: React.PointerEvent<HTMLInputElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLInputElement>) => void;
}

export function Slider({
  min,
  max,
  step = 1,
  value,
  defaultValue,
  onValueChange,
  "aria-label": ariaLabel,
  className = "",
  style,
  onPointerDown,
  onPointerUp,
}: GlassSliderProps) {
  const currentVal = value !== undefined ? value : (defaultValue ?? min);
  const clamped = Math.min(max, Math.max(min, currentVal));
  const span = Math.max(0.0001, max - min);
  const progressPct = Math.round(((clamped - min) / span) * 1000) / 10;

  return (
    <div dir="ltr" className={`w-full flex items-center ${className}`} style={style}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamped}
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onChange={(e) => onValueChange(parseFloat(e.target.value))}
        style={{ "--slider-progress": `${progressPct}%` } as React.CSSProperties}
        className="sf-apple-slider w-full cursor-pointer"
      />
    </div>
  );
}

export interface GlassSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  "aria-label"?: string;
  disabled?: boolean;
}

const SWITCH_TRAVEL_PX = 20;

export function Switch({
  checked,
  onCheckedChange,
  "aria-label": ariaLabel,
  disabled = false,
}: GlassSwitchProps) {
  const [lifted, setLifted] = useState(false);
  const [dragProgress, setDragProgress] = useState<number | null>(null);
  const gestureRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    from: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const resetGesture = () => {
      gestureRef.current = null;
      setLifted(false);
      setDragProgress(null);
    };
    window.addEventListener("blur", resetGesture);
    return () => window.removeEventListener("blur", resetGesture);
  }, []);

  const currentProgress = dragProgress !== null ? dragProgress : checked ? 1 : 0;
  // Strictly bounded travel so the Liquid Glass thumb can never escape the 60x26px track bounds
  // Even at lifted scale(1.08), thumb (36x22 -> 38.88x23.76) adds 1.44px per horizontal edge;
  // clamping lifted translateX to [0.8, 19.2] preserves >=1.3px clearance inside both track ends.
  const rawTranslateX = currentProgress * SWITCH_TRAVEL_PX;
  const translateX = lifted
    ? Math.max(0.8, Math.min(SWITCH_TRAVEL_PX - 0.8, rawTranslateX))
    : Math.max(0, Math.min(SWITCH_TRAVEL_PX, rawTranslateX));
  const fillVisible = dragProgress !== null ? currentProgress >= 0.5 : checked;

  const finishGesture = (nextChecked?: boolean) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    setLifted(false);
    setDragProgress(null);
    if (g && btnRef.current?.hasPointerCapture(g.id)) {
      try {
        btnRef.current.releasePointerCapture(g.id);
      } catch {
        // ignore if capture already released
      }
    }
    if (nextChecked !== undefined && nextChecked !== checked) {
      onCheckedChange(nextChecked);
    }
  };

  return (
    <span dir="ltr" className="inline-flex shrink-0 items-center py-2">
      <button
        ref={btnRef}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onPointerDown={(e) => {
          if (disabled || !e.isPrimary || e.button !== 0) return;
          e.preventDefault();
          suppressClickRef.current = false;
          gestureRef.current = {
            id: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            from: checked ? 1 : 0,
            moved: false,
          };
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          setLifted(true);
        }}
        onPointerMove={(e) => {
          const g = gestureRef.current;
          if (!g || g.id !== e.pointerId) return;
          const dx = e.clientX - g.startX;
          const dy = Math.abs(e.clientY - g.startY);
          if (!g.moved && dy > 10 && dy > Math.abs(dx) + 4) {
            suppressClickRef.current = true;
            finishGesture(undefined);
            return;
          }
          if (!g.moved && Math.abs(dx) < 3) return;
          g.moved = true;
          const raw = g.from + dx / SWITCH_TRAVEL_PX;
          // Gentle magnetic resistance at edges, strictly bounded inside the rail
          const bounded =
            raw < 0 ? Math.max(-0.04, raw * 0.15) : raw > 1 ? Math.min(1.04, 1 + (raw - 1) * 0.15) : raw;
          setDragProgress(bounded);
        }}
        onPointerUp={(e) => {
          const g = gestureRef.current;
          if (!g || g.id !== e.pointerId) return;
          suppressClickRef.current = true;
          const dx = e.clientX - g.startX;
          const finalProgress = g.from + dx / SWITCH_TRAVEL_PX;
          const rect = e.currentTarget.getBoundingClientRect();
          const near = e.clientY >= rect.top - 24 && e.clientY <= rect.bottom + 24;
          const nextVal = g.moved ? finalProgress >= 0.5 : near ? !checked : checked;
          finishGesture(nextVal);
        }}
        onPointerCancel={() => {
          suppressClickRef.current = true;
          finishGesture(undefined);
        }}
        onLostPointerCapture={() => {
          finishGesture(undefined);
        }}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (!disabled) onCheckedChange(!checked);
        }}
        style={{ WebkitTapHighlightColor: "transparent", touchAction: "pan-y" }}
        className="relative inline-flex h-[26px] w-[60px] shrink-0 items-center rounded-full border-0 p-0 cursor-pointer select-none after:absolute after:-inset-y-2.5 after:-inset-x-1 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-accent)] disabled:opacity-35 disabled:cursor-default"
      >
        {/* Track Base */}
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full transition-colors duration-200 ease-out"
          style={{
            backgroundColor: fillVisible
              ? "var(--lg-on, #34c759)"
              : "var(--lg-track, rgba(120, 120, 128, 0.34))",
            boxShadow: "inset 0 1px 2px rgba(0, 0, 0, 0.16)",
          }}
        />

        {/* Strictly Contained iOS 26 Liquid Glass Pill Thumb */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-[2px] left-[2px] h-[22px] w-[36px] rounded-full"
          style={{
            transform: `translate3d(${translateX}px, 0, 0) scale(${lifted ? 1.08 : 1})`,
            transition: dragProgress !== null
              ? "background-color 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease"
              : "transform 0.24s cubic-bezier(0.22, 1, 0.36, 1), background-color 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease",
            background: lifted
              ? "rgba(255, 255, 255, 0.38)"
              : "#ffffff",
            backdropFilter: lifted ? "blur(3px) saturate(1.7)" : "none",
            WebkitBackdropFilter: lifted ? "blur(3px) saturate(1.7)" : "none",
            border: lifted
              ? "1.5px solid rgba(255, 255, 255, 0.94)"
              : "0.5px solid rgba(0, 0, 0, 0.08)",
            boxShadow: lifted
              ? "inset 0 1.5px 2px rgba(255, 255, 255, 0.75), 0 3px 10px rgba(0, 0, 0, 0.26)"
              : "0 2px 6px rgba(0, 0, 0, 0.22), 0 0 1px rgba(0, 0, 0, 0.12)",
          }}
        />
      </button>
    </span>
  );
}

export type GlassMenuItem =
  | "separator"
  | {
      label: string;
      icon?: React.ReactNode;
      onSelect: () => void;
    };

export interface GlassMenuProps {
  items: GlassMenuItem[];
  align?: "start" | "end";
  "aria-label"?: string;
}

export function Menu({
  items,
  align = "end",
  "aria-label": ariaLabel = "Options",
}: GlassMenuProps) {
  const [open, setOpen] = useState(false);
  const [openUpwards, setOpenUpwards] = useState(true);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next && wrapRef.current) {
        const rect = wrapRef.current.getBoundingClientRect();
        setOpenUpwards(rect.top > 230);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={handleToggle}
        className="sf-btn inline-flex h-11 w-11 sm:h-9 sm:w-9 min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] items-center justify-center rounded-full text-[var(--sf-muted)] hover:text-[var(--sf-text)] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] cursor-pointer transition-colors"
      >
        <DotsThreeIcon size={18} weight="bold" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className={`sf-glass-chrome sf-popover-in absolute ${
            openUpwards ? "bottom-full mb-2" : "top-full mt-2"
          } ${
            align === "end" ? "end-0" : "start-0"
          } z-40 min-w-[205px] max-w-[260px] rounded-2xl p-1.5 shadow-2xl dark:bg-[#0e101c]/95 dark:border dark:border-white/10 dark:shadow-[0_16px_40px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl`}
        >
          {items.map((item, idx) =>
            item === "separator" ? (
              <div key={`sep-${idx}`} role="separator" className="my-1 h-px bg-[var(--sf-hairline)] dark:bg-white/[0.08]" />
            ) : (
              <button
                key={`${item.label}-${idx}`}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-xs font-semibold text-[var(--sf-text)] dark:text-white/90 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] active:scale-[0.98] transition-colors cursor-pointer"
              >
                {item.icon && <span className="shrink-0 opacity-80">{item.icon}</span>}
                <span className="truncate">{item.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export interface GlassSegmentedItem {
  value: string;
  label: React.ReactNode;
}

export interface GlassSegmentedProps {
  items: GlassSegmentedItem[];
  value: string;
  onValueChange: (value: string) => void;
  "aria-label"?: string;
  className?: string;
  fullWidth?: boolean;
  useGlisseFixedLtr?: boolean;
  size?: "xs" | "sm" | "md";
  darkSurface?: boolean;
  whiteActivePill?: boolean;
}

export function GlassSegmented({
  items,
  value,
  onValueChange,
  "aria-label": ariaLabel,
  className = "",
  fullWidth = false,
  useGlisseFixedLtr = false,
  size = "md",
  darkSurface = false,
  whiteActivePill = false,
}: GlassSegmentedProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicator, setIndicator] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false,
  });
  const [animated, setAnimated] = useState(false);

  const measure = useCallback(() => {
    const activeBtn = btnRefs.current.get(value);
    const track = trackRef.current;
    if (!activeBtn || !track) {
      setIndicator((prev) => (prev.ready ? { ...prev, ready: false } : prev));
      return;
    }
    // Use offsetLeft & offsetWidth so CSS transforms (scale/translate) on dialogs or cards don't distort measurements
    let nextLeft = activeBtn.offsetLeft;
    let nextWidth = activeBtn.offsetWidth;

    // Eliminate subpixel gaps and edge clipping when fullWidth is active across RTL and LTR
    if (fullWidth && track.offsetWidth > 0 && items.length > 1) {
      const isRtl = typeof document !== "undefined" && document.documentElement.dir === "rtl";
      const activeIndex = items.findIndex((it) => it.value === value);
      if (isRtl) {
        if (activeIndex === items.length - 1) {
          nextLeft = 0;
        } else if (activeIndex === 0) {
          nextWidth = Math.max(0, track.offsetWidth - nextLeft);
        }
      } else {
        if (activeIndex === 0) {
          nextLeft = 0;
        } else if (activeIndex === items.length - 1) {
          nextWidth = Math.max(0, track.offsetWidth - nextLeft);
        }
      }
    }

    setIndicator((prev) =>
      prev.left === nextLeft && prev.width === nextWidth && prev.ready
        ? prev
        : { left: nextLeft, width: nextWidth, ready: nextWidth > 0 },
    );
  }, [value, fullWidth, items]);

  useEffect(() => {
    if (indicator.ready && !animated) {
      const raf = requestAnimationFrame(() => setAnimated(true));
      return () => cancelAnimationFrame(raf);
    }
  }, [indicator.ready, animated]);

  useLayoutEffect(() => {
    if (useGlisseFixedLtr) return;
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(track);
    for (const btn of btnRefs.current.values()) {
      ro.observe(btn);
    }
    let active = true;
    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      mo = new MutationObserver(() => measure());
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["dir"] });
    }
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (active) measure();
      });
    }
    return () => {
      active = false;
      mo?.disconnect();
      ro.disconnect();
    };
  }, [measure, items, useGlisseFixedLtr]);

  if (useGlisseFixedLtr) {
    return (
      <div dir="ltr" className={`inline-flex ${className}`}>
        <GlisseSegmentedControl
          aria-label={ariaLabel}
          items={items}
          value={value}
          onValueChange={onValueChange}
        />
      </div>
    );
  }

  const isExtraSmall = size === "xs";
  const isSmall = size === "sm" || isExtraSmall;

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`relative max-w-full select-none rounded-full ${
        fullWidth ? "overflow-hidden" : "overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      } ${
        darkSurface
          ? "bg-white/[0.09] border border-white/[0.16] backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_4px_16px_rgba(0,0,0,0.32)]"
          : "bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.04] dark:border-white/[0.04] backdrop-blur-xl shadow-[inset_0_1px_2px_rgba(0,0,0,0.12)]"
      } ${isExtraSmall ? "p-[3px]" : isSmall ? "p-[3px] sm:p-1" : "p-1"} ${
        fullWidth ? "flex w-full" : "inline-flex"
      } ${className}`}
    >
      <div
        ref={trackRef}
        className={`relative flex items-center ${isExtraSmall ? "gap-0.5" : isSmall ? "gap-0.5" : "gap-1"} ${fullWidth ? "w-full flex-1" : "min-w-max shrink-0"}`}
      >
        {indicator.ready && (
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute top-0 left-0 h-full rounded-full ${
              darkSurface && whiteActivePill
                ? "bg-white shadow-[0_2px_12px_rgba(255,255,255,0.28),0_3px_10px_rgba(0,0,0,0.35)]"
                : darkSurface
                  ? "bg-white/20 dark:bg-white/[0.22] text-white shadow-[0_2px_10px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.4)] backdrop-blur-xl border border-white/25"
                  : "bg-white dark:bg-white/[0.16] shadow-[0_2px_10px_rgba(0,0,0,0.14),inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-md border border-black/[0.04] dark:border-white/[0.1]"
            } ${
              animated
                ? "transition-[transform,width] duration-280 ease-[cubic-bezier(0.22,1,0.36,1)]"
                : "transition-none"
            }`}
            style={{
              width: `${indicator.width}px`,
              transform: `translate3d(${indicator.left}px, 0, 0)`,
            }}
          />
        )}
        {items.map((item) => {
          const active = item.value === value;
          const activeText =
            darkSurface && whiteActivePill
              ? "!text-slate-950 font-bold"
              : darkSurface
                ? "text-white font-semibold drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
                : "text-slate-900 dark:text-white font-semibold";
          const inactiveText = darkSurface
            ? "text-white/70 hover:text-white font-semibold"
            : "text-slate-600 dark:text-white/70 hover:text-slate-950 dark:hover:text-white font-semibold";

          return (
            <button
              key={item.value}
              ref={(el) => {
                if (el) btnRefs.current.set(item.value, el);
                else btnRefs.current.delete(item.value);
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onValueChange(item.value)}
              className={`relative z-10 cursor-pointer whitespace-nowrap rounded-full transition-colors outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40 ${
                isExtraSmall
                  ? "min-h-[24px] px-1.5 min-[360px]:px-2 py-0.5 text-[10px] min-[360px]:text-[10.5px] font-mono tabular-nums"
                  : isSmall
                    ? "min-h-[28px] px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs"
                    : "min-h-[34px] px-3.5 py-1.5 text-xs sm:text-sm"
              } ${fullWidth ? "flex-1 text-center" : ""} ${active ? activeText : inactiveText}`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface GlassMobileNavItem {
  value: string;
  href: string;
  label: string;
  icon: React.ReactNode;
}

interface GlassMobileNavProps {
  items: GlassMobileNavItem[];
  value: string;
  "aria-label"?: string;
}

export function GlassMobileNav({ items, value, "aria-label": ariaLabel }: GlassMobileNavProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const [indicator, setIndicator] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false,
  });

  const measure = useCallback(() => {
    const activeEl = itemRefs.current.get(value);
    if (!activeEl) {
      setIndicator((prev) => (prev.ready ? { ...prev, ready: false } : prev));
      return;
    }
    const nextLeft = activeEl.offsetLeft;
    const nextWidth = activeEl.offsetWidth;
    setIndicator((prev) =>
      prev.left === nextLeft && prev.width === nextWidth && prev.ready
        ? prev
        : { left: nextLeft, width: nextWidth, ready: nextWidth > 0 },
    );
  }, [value]);

  useLayoutEffect(() => {
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(track);
    for (const el of itemRefs.current.values()) {
      ro.observe(el);
    }
    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      mo = new MutationObserver(() => measure());
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["dir"] });
    }
    return () => {
      mo?.disconnect();
      ro.disconnect();
    };
  }, [measure, items]);

  return (
    <nav
      aria-label={ariaLabel}
      className="sf-glass-chrome relative flex w-full items-center rounded-[28px] p-1.5"
    >
      <div
        ref={trackRef}
        className="relative grid w-full items-center"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }}
      >
        {indicator.ready && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-0 left-0 h-full rounded-[22px] bg-black/[0.06] dark:bg-white/[0.14] border border-black/[0.04] dark:border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_2px_8px_rgba(0,0,0,0.3)] backdrop-blur-md transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{
              width: `${indicator.width}px`,
              transform: `translate3d(${indicator.left}px, 0, 0)`,
            }}
          />
        )}
        {items.map((item) => {
          const active = item.value === value;
          return (
            <Link
              key={item.value}
              ref={(el) => {
                if (el) itemRefs.current.set(item.value, el);
                else itemRefs.current.delete(item.value);
              }}
              href={item.href}
              onClick={() => void triggerHapticFeedback("selection")}
              aria-current={active ? "page" : undefined}
              className={`relative z-10 flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-[22px] px-1 py-1.5 text-center transition-colors ${
                active
                  ? "text-indigo-600 dark:text-white"
                  : "text-[var(--sf-muted)] hover:text-[var(--sf-text)]"
              }`}
            >
              <span className="flex items-center justify-center">{item.icon}</span>
              <span className="max-w-full truncate text-[11px] font-semibold leading-tight">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
