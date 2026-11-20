/**
 * Touch Gestures & Physics Engine for Soundify Mobile
 *
 * Provides:
 * - Directional swipe resolution (RTL vs LTR aware without inverted behavior)
 * - Spring physics damping for full-screen sheet pull-down dismiss
 * - Elastic horizontal drag resistance for track artwork and player dock
 * - Velocity flick detection for quick swipe gestures
 */

import { triggerHapticFeedback } from "./hapticFeedback";

export type SwipeAction = "next" | "prev" | "dismiss" | null;

export interface SwipeResolutionParams {
  deltaX: number;
  deltaY: number;
  dir?: "ltr" | "rtl";
  horizontalThreshold?: number;
  verticalThreshold?: number;
  invertRtl?: boolean;
}

/**
 * Calculates gesture swipe action based on delta coordinates and layout direction.
 *
 * Directional Behavior:
 * - In LTR (English):
 *   Swiping Left (deltaX < 0) advances forward to Next track.
 *   Swiping Right (deltaX > 0) goes back to Previous track.
 * - In RTL (Persian):
 *   Reading and layout progress Right-to-Left.
 *   Swiping Left (deltaX < 0) advances forward in reading flow to Next track.
 *   Swiping Right (deltaX > 0) goes back to Previous track.
 *   By default (invertRtl = false), gestures are natural and aligned with user expectations,
 *   preventing inverted behavior bugs. If invertRtl is explicitly set, the directions mirror.
 * - Vertical Downward Swipe (deltaY > verticalThreshold && deltaY > |deltaX| * 1.2):
 *   Returns "dismiss" for minimizing overlays back to dock.
 */
export function resolveSwipeAction({
  deltaX,
  deltaY,
  dir = "ltr",
  horizontalThreshold = 40,
  verticalThreshold = 80,
  invertRtl = false,
}: SwipeResolutionParams): SwipeAction {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  // Vertical downward dismiss
  if (deltaY >= verticalThreshold && absY > absX * 1.15) {
    return "dismiss";
  }

  // Horizontal skip gesture
  if (absX >= horizontalThreshold && absX > absY) {
    const isRtl = dir === "rtl";
    if (invertRtl && isRtl) {
      return deltaX > 0 ? "next" : "prev";
    }
    return deltaX < 0 ? "next" : "prev";
  }

  return null;
}

/**
 * Calculates damped spring displacement for drag pull-down gestures (sheet minimization).
 * Applies non-linear progressive damping for physical Apple/Spotify sheet feel.
 */
export function calculateDampedDrag(deltaY: number, resistance = 0.88): number {
  if (deltaY <= 0) return 0;
  return (deltaY / (1 + deltaY * 0.0012)) * resistance;
}

/**
 * Calculates horizontal elastic displacement for card/dock swipe feedback.
 */
export function calculateElasticDrag(deltaX: number, maxStretch = 52): number {
  if (deltaX === 0) return 0;
  const sign = Math.sign(deltaX);
  const abs = Math.abs(deltaX);
  const damped = (abs / (1 + abs * 0.015)) * 0.45;
  return sign * Math.min(maxStretch, damped);
}

/**
 * Calculates gesture swipe velocity (pixels per millisecond).
 */
export function calculateVelocity(distance: number, deltaTimeMs: number): number {
  if (deltaTimeMs <= 0) return 0;
  return distance / deltaTimeMs;
}

export interface TouchHandlersConfig {
  onSwipeNext?: () => void;
  onSwipePrev?: () => void;
  onSwipeDismiss?: () => void;
  onDragMove?: (deltaX: number, deltaY: number) => void;
  onDragEnd?: () => void;
  dir?: "ltr" | "rtl";
  enableHorizontal?: boolean;
  enableVerticalDismiss?: boolean;
  horizontalThreshold?: number;
  verticalThreshold?: number;
  velocityThreshold?: number; // e.g. 0.35 px/ms
  triggerHaptics?: boolean;
  invertRtl?: boolean;
  ignoreSelector?: string;
}

/**
 * Creates touch event handlers for touch-enabled swipe gestures.
 */
export function createSwipeTouchHandlers(config: TouchHandlersConfig) {
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let isTracking = false;

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      if (isTracking) {
        isTracking = false;
        config.onDragEnd?.();
      }
      return;
    }

    const targetEl = e.target as HTMLElement | null;
    const ignoreSel = config.ignoreSelector ?? '[role="slider"], input, select, textarea, [data-prevent-swipe]';
    if (typeof targetEl?.closest === "function" && targetEl.closest(ignoreSel)) {
      return;
    }

    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    startTime = Date.now();
    isTracking = true;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!isTracking) return;
    if (e.touches.length !== 1) {
      // Abort swipe immediately if user places a second finger (pinch/multi-touch)
      isTracking = false;
      config.onDragEnd?.();
      return;
    }

    const touch = e.touches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    config.onDragMove?.(deltaX, deltaY);
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (!isTracking) return;
    isTracking = false;

    const touch = e.changedTouches[0];
    const deltaX = touch ? touch.clientX - startX : 0;
    const deltaY = touch ? touch.clientY - startY : 0;
    const dt = Math.max(1, Date.now() - startTime);

    const vX = calculateVelocity(Math.abs(deltaX), dt);
    const vY = calculateVelocity(deltaY, dt);
    const velThreshold = config.velocityThreshold ?? 0.32;

    const hThresh = config.horizontalThreshold ?? 40;
    const vThresh = config.verticalThreshold ?? 75;

    // Check vertical dismiss first if enabled
    if (config.enableVerticalDismiss && (deltaY >= vThresh || (deltaY > 35 && vY >= velThreshold))) {
      if (Math.abs(deltaY) > Math.abs(deltaX) * 1.1) {
        if (config.triggerHaptics !== false) {
          void triggerHapticFeedback("dismiss");
        }
        config.onSwipeDismiss?.();
        config.onDragEnd?.();
        return;
      }
    }

    // Check horizontal skip if enabled
    if (config.enableHorizontal !== false) {
      if (Math.abs(deltaX) >= hThresh || (Math.abs(deltaX) > 25 && vX >= velThreshold)) {
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
          const action = resolveSwipeAction({
            deltaX,
            deltaY,
            dir: config.dir ?? "ltr",
            horizontalThreshold: hThresh,
            invertRtl: config.invertRtl ?? false,
          });

          if (action === "next") {
            if (config.triggerHaptics !== false) {
              void triggerHapticFeedback("trackSkip");
            }
            config.onSwipeNext?.();
          } else if (action === "prev") {
            if (config.triggerHaptics !== false) {
              void triggerHapticFeedback("trackSkip");
            }
            config.onSwipePrev?.();
          }
        }
      }
    }

    config.onDragEnd?.();
  };

  const onTouchCancel = () => {
    if (!isTracking) return;
    isTracking = false;
    config.onDragEnd?.();
  };

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  };
}
