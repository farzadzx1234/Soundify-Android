"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BroadcastIcon,
  CarIcon,
  CircleNotchIcon,
  HeadphonesIcon,
  SpeakerHifiIcon,
} from "@phosphor-icons/react";
import type { AudioOutputDeviceInfo } from "@/lib/nativeAudioBridge";
import {
  BC_MOTION,
  dampingFromRatio,
  expandedSymbolAlpha,
  expandedSymbolBlurPx,
  expandedSymbolScale,
  playerSkipPose,
  stepSpring,
  usePrefersReducedMotion,
} from "./motion";

/* ============================================================================
   1. BitChord Play / Pause Animated Glyph
   - Mini variant: PlayerPlayPauseMotion.kt pinch-and-pop spring (dip 0.12 -> bounce 1.05 -> 1.0)
   - Expanded variant: ExpandedPlayPauseMotion.kt (170 stiffness / 0.68 damping cross-scale,
     smoothstep opacity, brief silhouette blur + soft radial press disc)
   ============================================================================ */

interface BitChordPlayPauseGlyphProps {
  isPlaying: boolean;
  isBuffering?: boolean;
  size?: number;
  variant?: "mini" | "expanded";
  pressed?: boolean;
  className?: string;
}

const PLAY_PATH =
  "M8.5 5.45C8.5 4.42 9.64 3.8 10.5 4.36L19.48 10.16C20.27 10.67 20.27 11.83 19.48 12.34L10.5 18.14C9.64 18.7 8.5 18.08 8.5 17.05V5.45Z";

export function BitChordPlayPauseGlyph({
  isPlaying,
  isBuffering = false,
  size = 24,
  variant = "mini",
  pressed = false,
  className = "",
}: BitChordPlayPauseGlyphProps) {
  const reducedMotion = usePrefersReducedMotion();
  const playLayerRef = useRef<SVGSVGElement>(null);
  const pauseLayerRef = useRef<SVGSVGElement>(null);
  const miniWrapRef = useRef<HTMLDivElement>(null);
  const miniPlayRef = useRef<SVGSVGElement>(null);
  const miniPauseRef = useRef<SVGSVGElement>(null);

  const prevPlayingRef = useRef(isPlaying);
  const phaseRef = useRef(isPlaying ? 1 : 0);
  const phaseVelRef = useRef(0);
  const pulseRef = useRef(1);
  const pulseVelRef = useRef(0);
  const dippingRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const paintMiniGlyph = useCallback((showPause: boolean) => {
    if (miniPlayRef.current) {
      miniPlayRef.current.style.opacity = showPause ? "0" : "1";
    }
    if (miniPauseRef.current) {
      miniPauseRef.current.style.opacity = showPause ? "1" : "0";
    }
  }, []);

  const paintExpanded = useCallback(
    (phase: number) => {
      const playEl = playLayerRef.current;
      const pauseEl = pauseLayerRef.current;
      if (!playEl || !pauseEl) return;

      const p = Math.max(0, Math.min(1, phase));
      const playWeight = 1 - p;
      const pauseWeight = p;

      const playAlpha = expandedSymbolAlpha(playWeight);
      const pauseAlpha = expandedSymbolAlpha(pauseWeight);
      const playScale = expandedSymbolScale(playWeight);
      const pauseScale = expandedSymbolScale(pauseWeight);

      const playBlur =
        playAlpha > 0.01 && p > 0.005 && p < 0.995 ? expandedSymbolBlurPx(playWeight, size) : 0;
      const pauseBlur =
        pauseAlpha > 0.01 && p > 0.005 && p < 0.995 ? expandedSymbolBlurPx(pauseWeight, size) : 0;

      playEl.style.opacity = String(playAlpha);
      playEl.style.transform = `scale3d(${playScale}, ${playScale}, 1)`;
      playEl.style.filter = playBlur > 0.15 ? `blur(${playBlur.toFixed(2)}px)` : "";

      pauseEl.style.opacity = String(pauseAlpha);
      pauseEl.style.transform = `scale3d(${pauseScale}, ${pauseScale}, 1)`;
      pauseEl.style.filter = pauseBlur > 0.15 ? `blur(${pauseBlur.toFixed(2)}px)` : "";
    },
    [size],
  );

  useEffect(() => {
    if (isBuffering) return;
    if (variant === "expanded") {
      paintExpanded(isPlaying ? 1 : 0);
    } else {
      paintMiniGlyph(isPlaying);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, isBuffering]);

  useEffect(() => {
    if (isBuffering) return;
    const changed = isPlaying !== prevPlayingRef.current;
    prevPlayingRef.current = isPlaying;

    const target = isPlaying ? 1 : 0;
    if (!changed || reducedMotion) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      phaseRef.current = target;
      phaseVelRef.current = 0;
      pulseRef.current = 1;
      pulseVelRef.current = 0;
      if (variant === "expanded") {
        paintExpanded(target);
      } else {
        paintMiniGlyph(isPlaying);
        if (miniWrapRef.current) miniWrapRef.current.style.transform = "scale3d(1,1,1)";
      }
      return;
    }

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (variant === "expanded") {
      const damping = dampingFromRatio(
        BC_MOTION.EXP_PLAY_STIFFNESS,
        BC_MOTION.EXP_PLAY_DAMPING_RATIO,
      );
      let last = performance.now();
      const loop = (now: number) => {
        const dt = (now - last) / 1000;
        last = now;
        const [np, nv] = stepSpring(
          phaseRef.current,
          phaseVelRef.current,
          target,
          dt,
          BC_MOTION.EXP_PLAY_STIFFNESS,
          damping,
        );
        phaseRef.current = np;
        phaseVelRef.current = nv;
        paintExpanded(np);

        if (Math.abs(np - target) < 0.001 && Math.abs(nv) < 0.005) {
          phaseRef.current = target;
          phaseVelRef.current = 0;
          paintExpanded(target);
          rafRef.current = null;
          return;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } else {
      // MiniPlayer PlayPauseMotion: dip quickly toward 0.12, swap icon near pinch, rebound with 0.68 damping
      dippingRef.current = true;
      let swapped = false;
      const dipDamping = dampingFromRatio(BC_MOTION.MINI_DIP_STIFFNESS, 1.0);
      const retDamping = dampingFromRatio(
        BC_MOTION.MINI_RETURN_STIFFNESS,
        BC_MOTION.MINI_RETURN_DAMPING_RATIO,
      );
      let last = performance.now();
      const loop = (now: number) => {
        const dt = (now - last) / 1000;
        last = now;
        if (dippingRef.current) {
          const [ns, nv] = stepSpring(
            pulseRef.current,
            pulseVelRef.current,
            BC_MOTION.MINI_DIP_SCALE,
            dt,
            BC_MOTION.MINI_DIP_STIFFNESS,
            dipDamping,
          );
          pulseRef.current = ns;
          pulseVelRef.current = nv;
          if (!swapped && ns <= 0.42) {
            swapped = true;
            paintMiniGlyph(isPlaying);
          }
          if (ns <= BC_MOTION.MINI_DIP_SCALE + 0.04) {
            dippingRef.current = false;
            if (!swapped) {
              swapped = true;
              paintMiniGlyph(isPlaying);
            }
          }
        } else {
          const [ns, nv] = stepSpring(
            pulseRef.current,
            pulseVelRef.current,
            1.0,
            dt,
            BC_MOTION.MINI_RETURN_STIFFNESS,
            retDamping,
          );
          pulseRef.current = ns;
          pulseVelRef.current = nv;
          if (Math.abs(ns - 1.0) < 0.002 && Math.abs(nv) < 0.01) {
            pulseRef.current = 1.0;
            pulseVelRef.current = 0;
            if (miniWrapRef.current) miniWrapRef.current.style.transform = "scale3d(1,1,1)";
            rafRef.current = null;
            return;
          }
        }
        if (miniWrapRef.current) {
          const s = Math.max(0.1, pulseRef.current);
          miniWrapRef.current.style.transform = `scale3d(${s}, ${s}, 1)`;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    }

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, isBuffering, variant, reducedMotion, paintExpanded, paintMiniGlyph]);

  if (isBuffering) {
    return (
      <CircleNotchIcon
        size={Math.round(size * 0.78)}
        className={`animate-spin ${className}`}
        aria-hidden="true"
      />
    );
  }

  if (variant === "expanded") {
    return (
      <span
        className={`relative inline-flex items-center justify-center ${className}`}
        style={{
          width: size,
          height: size,
          transform: pressed && !reducedMotion ? `scale3d(${BC_MOTION.EXP_PLAY_PRESS_SCALE}, ${BC_MOTION.EXP_PLAY_PRESS_SCALE}, 1)` : "scale3d(1, 1, 1)",
          transition: "transform 100ms cubic-bezier(0, 0, 0.2, 1)",
        }}
        aria-hidden="true"
      >
        <svg
          ref={playLayerRef}
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="currentColor"
          className="absolute inset-0 will-change-transform"
          style={{
            opacity: isPlaying ? 0 : 1,
            transform: isPlaying
              ? `scale3d(${BC_MOTION.EXP_PLAY_MIN_SCALE}, ${BC_MOTION.EXP_PLAY_MIN_SCALE}, 1)`
              : "scale3d(1, 1, 1)",
          }}
        >
          <path d={PLAY_PATH} />
        </svg>
        <svg
          ref={pauseLayerRef}
          viewBox="0 0 24 24"
          width={size}
          height={size}
          fill="currentColor"
          className="absolute inset-0 will-change-transform"
          style={{
            opacity: isPlaying ? 1 : 0,
            transform: isPlaying
              ? "scale3d(1, 1, 1)"
              : `scale3d(${BC_MOTION.EXP_PLAY_MIN_SCALE}, ${BC_MOTION.EXP_PLAY_MIN_SCALE}, 1)`,
          }}
        >
          <rect x="6" y="4.5" width="4.4" height="15" rx="1.6" />
          <rect x="13.6" y="4.5" width="4.4" height="15" rx="1.6" />
        </svg>
      </span>
    );
  }

  return (
    <div
      ref={miniWrapRef}
      className={`relative inline-flex items-center justify-center will-change-transform ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        ref={miniPauseRef}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
        className="absolute inset-0"
        style={{ opacity: isPlaying ? 1 : 0 }}
      >
        <rect x="6" y="4.5" width="4.4" height="15" rx="1.6" />
        <rect x="13.6" y="4.5" width="4.4" height="15" rx="1.6" />
      </svg>
      <svg
        ref={miniPlayRef}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
        className="absolute inset-0"
        style={{ opacity: isPlaying ? 0 : 1 }}
      >
        <path d={PLAY_PATH} />
      </svg>
    </div>
  );
}

/* ============================================================================
   2. BitChord 3-Arrow Conveyor Skip Glyph (PlayerSkipMotion.kt)
   - Front arrowhead contracts and fades out by 35%
   - Back arrowhead glides smoothly forward along Hermite curve to front slot
   - New trailing arrowhead grows in from 28%..90%
   ============================================================================ */

interface BitChordSkipGlyphProps {
  direction: "next" | "prev";
  isRtl?: boolean;
  tapCount: number;
  size?: number;
  className?: string;
}

const FORWARD_BACK_PATH =
  "M2.6 7.45C2.6 6.45 3.7 5.84 4.55 6.38L12.1 11.23C12.87 11.72 12.87 12.84 12.1 13.33L4.55 18.18C3.7 18.72 2.6 18.11 2.6 17.11V7.45Z";
const FORWARD_FRONT_PATH =
  "M12.5 7.45C12.5 6.45 13.6 5.84 14.45 6.38L22.0 11.23C22.77 11.72 22.77 12.84 22.0 13.33L14.45 18.18C13.6 18.72 12.5 18.11 12.5 17.11V7.45Z";
const ARROW_SHIFT_X = 9.9; // distance between back arrow center and front arrow center in 24x24 box

export function BitChordSkipGlyph({
  direction,
  isRtl = false,
  tapCount,
  size = 34,
  className = "",
}: BitChordSkipGlyphProps) {
  const reducedMotion = usePrefersReducedMotion();
  const frontRef = useRef<SVGGElement>(null);
  const survivorRef = useRef<SVGGElement>(null);
  const newRef = useRef<SVGGElement>(null);
  const prevTapRef = useRef(tapCount);
  const cycleRef = useRef(0);
  const targetCycleRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const applyPose = useCallback((progress: number) => {
    const front = frontRef.current;
    const survivor = survivorRef.current;
    const incoming = newRef.current;
    if (!front || !survivor || !incoming) return;

    const p = progress % 1;
    if (p <= 0 || p >= BC_MOTION.SKIP_SETTLED) {
      front.style.opacity = "1";
      front.style.transform = "scale3d(1, 1, 1)";
      survivor.style.transform = "translate3d(0, 0, 0)";
      incoming.style.opacity = "0";
      incoming.style.transform = "scale3d(0, 0, 1)";
      return;
    }

    const pose = playerSkipPose(p);
    front.style.opacity = String(pose.frontAlpha);
    front.style.transform = `scale3d(${pose.frontScale}, ${pose.frontScale}, 1)`;
    survivor.style.transform = `translate3d(${(ARROW_SHIFT_X * pose.survivorTravel).toFixed(3)}px, 0, 0)`;
    incoming.style.opacity = String(pose.newAlpha);
    incoming.style.transform = `scale3d(${pose.newScale}, ${pose.newScale}, 1)`;
  }, []);

  useEffect(() => {
    if (tapCount === prevTapRef.current) return;
    prevTapRef.current = tapCount;

    if (reducedMotion) {
      applyPose(0);
      return;
    }

    const current = cycleRef.current;
    const boundary = current - (current % 1) + 1;
    targetCycleRef.current =
      current < targetCycleRef.current ? boundary + 1 : boundary;

    if (rafRef.current !== null) return;

    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(50, Math.max(0, now - last));
      last = now;
      const dist = targetCycleRef.current - cycleRef.current;
      if (dist <= 0.002) {
        cycleRef.current = targetCycleRef.current;
        applyPose(0);
        rafRef.current = null;
        return;
      }
      const speed = Math.max(1 / BC_MOTION.SKIP_DURATION_MS, dist / BC_MOTION.SKIP_DURATION_MS);
      cycleRef.current = Math.min(targetCycleRef.current, cycleRef.current + dt * speed);
      applyPose(cycleRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [tapCount, reducedMotion, applyPose]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Visual orientation: Next points forward (right in LTR, left in RTL), Prev points opposite
  const pointsLeft = isRtl ? direction === "next" : direction === "prev";

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className={className}
      style={{
        transform: `scale(${pointsLeft ? -1 : 1}, 0.85)`,
      }}
    >
      <g
        ref={frontRef}
        style={{ transformOrigin: "17.2px 12.28px" }}
      >
        <path d={FORWARD_FRONT_PATH} />
      </g>
      <g ref={survivorRef}>
        <path d={FORWARD_BACK_PATH} />
      </g>
      <g
        ref={newRef}
        style={{
          transformOrigin: "7.3px 12.28px",
          opacity: 0,
          transform: "scale3d(0, 0, 1)",
        }}
      >
        <path d={FORWARD_BACK_PATH} />
      </g>
    </svg>
  );
}

/* ============================================================================
   3. BitChord Tactile Press Circle Wrapper (playerPressCircle from PlayerSkipMotion.kt)
   ============================================================================ */

export function BitChordTransportButton({
  onClick,
  ariaLabel,
  "aria-label": ariaLabelAttr,
  className = "",
  circleDiameter = 60,
  children,
}: {
  onClick: () => void;
  ariaLabel?: string;
  "aria-label"?: string;
  className?: string;
  circleDiameter?: number;
  children: React.ReactNode | ((pressed: boolean) => React.ReactNode);
}) {
  const [pressed, setPressed] = useState(false);
  const [circleVisible, setCircleVisible] = useState(false);
  const holdTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    };
  }, []);

  const showDisc = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    setCircleVisible(true);
  };

  const releaseDisc = () => {
    setPressed(false);
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = window.setTimeout(() => {
      setCircleVisible(false);
      holdTimerRef.current = null;
    }, 150);
  };

  return (
    <button
      type="button"
      onPointerDown={() => {
        setPressed(true);
        showDisc();
      }}
      onPointerUp={releaseDisc}
      onPointerCancel={releaseDisc}
      onPointerLeave={() => {
        if (pressed) releaseDisc();
      }}
      onClick={() => {
        showDisc();
        holdTimerRef.current = window.setTimeout(() => {
          setCircleVisible(false);
          holdTimerRef.current = null;
        }, 210);
        onClick();
      }}
      aria-label={ariaLabel ?? ariaLabelAttr}
      className={`relative inline-flex items-center justify-center cursor-pointer select-none ${className}`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute rounded-full transition-opacity"
        style={{
          width: circleDiameter,
          height: circleDiameter,
          background:
            "radial-gradient(circle, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.09) 76%, transparent 100%)",
          opacity: circleVisible ? 1 : 0,
          transitionDuration: circleVisible ? "45ms" : "120ms",
        }}
      />
      <span
        className="relative z-10 inline-flex items-center justify-center transition-transform duration-150 ease-out"
        style={{
          transform: pressed ? "scale3d(0.91, 0.91, 1)" : undefined,
        }}
      >
        {typeof children === "function" ? children(pressed) : children}
      </span>
    </button>
  );
}

/* ============================================================================
   4. Clean Monochrome Audio Output Glyph (PlayerControls.kt `rememberOutputGlyph`)
   Replaces the jarring blue Bluetooth rune with Apple / BitChord monochrome output glyphs
   ============================================================================ */

const BUDS_RE =
  /\b(buds?|pods?|airpods?|tws|dots|earbuds?|freebuds?|galaxy\s*buds?|liberty|soundcore\s*r\d+|r\d+i|life\s*p|in-?ear|qcy|haylou|redmi\s*buds)\b/i;
const SPEAKER_RE =
  /\b(speaker|boombox|soundbar|homepod|sonos|marshall|charge|flip|pulse|go\s*\d|aura|echo)\b/i;
const CAR_RE = /\b(car|auto|carplay|bluetooth\s*audio|handsfree|my\s*car|bmw|audi|benz|toyota)\b/i;

function AirPlaySvg({ size = 21 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1" />
      <polygon points="12 15 17 21 7 21 12 15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function EarbudsSvg({ size = 23 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
    >
      {/* Left earbud (sleek angled AirPods / wireless buds silhouette) */}
      <path d="M7.2 4.6C5 4.6 3.3 6.2 3.3 8.3C3.3 10.1 4.5 11.55 6.2 11.88V18.1C6.2 18.82 6.78 19.4 7.5 19.4C8.22 19.4 8.8 18.82 8.8 18.1V8.5C8.8 6.35 8.4 4.6 7.2 4.6ZM5.7 9.15C5.1 9.15 4.65 8.7 4.65 8.15C4.65 7.6 5.1 7.15 5.7 7.15C6.3 7.15 6.75 7.6 6.75 8.15C6.75 8.7 6.3 9.15 5.7 9.15Z" />
      {/* Right earbud */}
      <path d="M16.8 4.6C15.6 4.6 15.2 6.35 15.2 8.5V18.1C15.2 18.82 15.78 19.4 16.5 19.4C17.22 19.4 17.8 18.82 17.8 18.1V11.88C19.5 11.55 20.7 10.1 20.7 8.3C20.7 6.2 19 4.6 16.8 4.6ZM18.3 9.15C17.7 9.15 17.25 8.7 17.25 8.15C17.25 7.6 17.7 7.15 18.3 7.15C18.9 7.15 19.35 7.6 19.35 8.15C19.35 8.7 18.9 9.15 18.3 9.15Z" />
    </svg>
  );
}

export function BitChordOutputGlyph({
  device,
  isRemoteActive,
  size = 21,
}: {
  device: AudioOutputDeviceInfo;
  isRemoteActive: boolean;
  size?: number;
}) {
  if (isRemoteActive) {
    return (
      <BroadcastIcon
        size={size}
        weight="fill"
        className="text-emerald-300"
        aria-hidden="true"
      />
    );
  }

  if (device.kind === "bluetooth") {
    const name = device.name || "";
    if (BUDS_RE.test(name)) {
      return (
        <span className="text-white/90 inline-flex items-center justify-center">
          <EarbudsSvg size={size + 2} />
        </span>
      );
    }
    if (SPEAKER_RE.test(name)) {
      return <SpeakerHifiIcon size={size} weight="fill" className="text-white/90" aria-hidden="true" />;
    }
    if (CAR_RE.test(name)) {
      return <CarIcon size={size} weight="fill" className="text-white/90" aria-hidden="true" />;
    }
    return <HeadphonesIcon size={size} weight="fill" className="text-white/90" aria-hidden="true" />;
  }

  if (device.kind === "wired" || device.kind === "usb") {
    return <HeadphonesIcon size={size} weight="fill" className="text-white/90" aria-hidden="true" />;
  }

  return (
    <span className="text-white/85 inline-flex items-center justify-center">
      <AirPlaySvg size={size} />
    </span>
  );
}
