import { describe, expect, it, vi } from "vitest";
import React from "react";
import {
  calculateDampedDrag,
  calculateElasticDrag,
  calculateVelocity,
  createSwipeTouchHandlers,
  resolveSwipeAction,
} from "@/lib/touchGestures";

function makeTouchEvent(opts: {
  touches?: Array<{ clientX: number; clientY: number }>;
  changedTouches?: Array<{ clientX: number; clientY: number }>;
  target?: unknown;
}): React.TouchEvent {
  return {
    touches: opts.touches ?? [],
    changedTouches: opts.changedTouches ?? [],
    target: (opts.target ?? { closest: () => null }) as unknown as EventTarget,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.TouchEvent;
}

describe("Touch Gestures & Physics Engine", () => {
  describe("Directional Swipe Resolution (RTL & LTR)", () => {
    it("resolves LTR swipe left as next track", () => {
      const action = resolveSwipeAction({
        deltaX: -55,
        deltaY: 10,
        dir: "ltr",
        horizontalThreshold: 40,
      });
      expect(action).toBe("next");
    });

    it("resolves LTR swipe right as previous track", () => {
      const action = resolveSwipeAction({
        deltaX: 60,
        deltaY: -5,
        dir: "ltr",
        horizontalThreshold: 40,
      });
      expect(action).toBe("prev");
    });

    it("resolves RTL swipe left as next track without inverted behavior", () => {
      // In RTL (Persian), reading and list flow progress right-to-left.
      // Leftward swipe advances forward to next track.
      const action = resolveSwipeAction({
        deltaX: -50,
        deltaY: 5,
        dir: "rtl",
        horizontalThreshold: 40,
      });
      expect(action).toBe("next");
    });

    it("resolves RTL swipe right as previous track without inverted behavior", () => {
      const action = resolveSwipeAction({
        deltaX: 55,
        deltaY: 0,
        dir: "rtl",
        horizontalThreshold: 40,
      });
      expect(action).toBe("prev");
    });

    it("supports optional invertRtl flag if explicit mirroring is requested", () => {
      const actionNext = resolveSwipeAction({
        deltaX: 55,
        deltaY: 0,
        dir: "rtl",
        horizontalThreshold: 40,
        invertRtl: true,
      });
      expect(actionNext).toBe("next");

      const actionPrev = resolveSwipeAction({
        deltaX: -55,
        deltaY: 0,
        dir: "rtl",
        horizontalThreshold: 40,
        invertRtl: true,
      });
      expect(actionPrev).toBe("prev");
    });

    it("returns null when gesture movement is below horizontal threshold", () => {
      const action = resolveSwipeAction({
        deltaX: -25,
        deltaY: 5,
        dir: "ltr",
        horizontalThreshold: 40,
      });
      expect(action).toBeNull();
    });

    it("resolves dominant downward vertical swipe as dismiss", () => {
      const action = resolveSwipeAction({
        deltaX: 12,
        deltaY: 95,
        dir: "ltr",
        verticalThreshold: 80,
      });
      expect(action).toBe("dismiss");
    });

    it("does not dismiss on upward swipe (negative deltaY)", () => {
      const action = resolveSwipeAction({
        deltaX: 0,
        deltaY: -95,
        dir: "ltr",
        verticalThreshold: 80,
      });
      expect(action).toBeNull();
    });

    it("prioritizes horizontal skip over slight vertical drift", () => {
      const action = resolveSwipeAction({
        deltaX: -70,
        deltaY: 20,
        dir: "ltr",
        horizontalThreshold: 40,
        verticalThreshold: 80,
      });
      expect(action).toBe("next");
    });
  });

  describe("Spring Physics & Damping Calculations", () => {
    it("calculates damped drag with smooth diminishing returns", () => {
      expect(calculateDampedDrag(0)).toBe(0);
      expect(calculateDampedDrag(-50)).toBe(0);

      const d50 = calculateDampedDrag(50);
      const d100 = calculateDampedDrag(100);
      const d150 = calculateDampedDrag(150);

      expect(d50).toBeGreaterThan(0);
      expect(d100).toBeGreaterThan(d50);
      expect(d150).toBeGreaterThan(d100);
      // Damped rate of increase must decelerate across equal step intervals (0->50 vs 50->100 vs 100->150)
      expect(d50).toBeGreaterThan(d100 - d50);
      expect(d100 - d50).toBeGreaterThan(d150 - d100);
    });

    it("calculates elastic horizontal drag while preserving directional sign", () => {
      expect(calculateElasticDrag(0)).toBe(0);

      const pos = calculateElasticDrag(80);
      const neg = calculateElasticDrag(-80);

      expect(pos).toBeGreaterThan(0);
      expect(neg).toBeLessThan(0);
      expect(Math.abs(pos)).toBeCloseTo(Math.abs(neg), 4);
    });

    it("caps elastic drag at specified max stretch limit", () => {
      const maxStretch = 40;
      const stretch = calculateElasticDrag(1200, maxStretch);
      expect(Math.abs(stretch)).toBeLessThanOrEqual(maxStretch);
    });

    it("calculates velocity correctly in pixels per millisecond", () => {
      expect(calculateVelocity(100, 200)).toBeCloseTo(0.5, 4);
      expect(calculateVelocity(0, 100)).toBe(0);
      expect(calculateVelocity(100, 0)).toBe(0);
      expect(calculateVelocity(100, -10)).toBe(0);
    });
  });

  describe("createSwipeTouchHandlers Event Lifecycle", () => {
    it("detects horizontal next swipe and invokes callback", () => {
      const onSwipeNext = vi.fn();
      const onSwipePrev = vi.fn();
      const onDragEnd = vi.fn();

      const handlers = createSwipeTouchHandlers({
        dir: "ltr",
        onSwipeNext,
        onSwipePrev,
        onDragEnd,
        horizontalThreshold: 35,
        triggerHaptics: false,
      });

      handlers.onTouchStart(makeTouchEvent({
        touches: [{ clientX: 200, clientY: 300 }],
      }));

      handlers.onTouchMove(makeTouchEvent({
        touches: [{ clientX: 140, clientY: 300 }],
      }));

      handlers.onTouchEnd(makeTouchEvent({
        changedTouches: [{ clientX: 140, clientY: 300 }],
      }));

      expect(onSwipeNext).toHaveBeenCalledTimes(1);
      expect(onSwipePrev).not.toHaveBeenCalled();
      expect(onDragEnd).toHaveBeenCalledTimes(1);
    });

    it("detects horizontal prev swipe and invokes callback", () => {
      const onSwipeNext = vi.fn();
      const onSwipePrev = vi.fn();

      const handlers = createSwipeTouchHandlers({
        dir: "ltr",
        onSwipeNext,
        onSwipePrev,
        horizontalThreshold: 35,
        triggerHaptics: false,
      });

      handlers.onTouchStart(makeTouchEvent({
        touches: [{ clientX: 100, clientY: 200 }],
      }));

      handlers.onTouchEnd(makeTouchEvent({
        changedTouches: [{ clientX: 170, clientY: 200 }],
      }));

      expect(onSwipePrev).toHaveBeenCalledTimes(1);
      expect(onSwipeNext).not.toHaveBeenCalled();
    });

    it("detects vertical downward dismiss swipe when enabled", () => {
      const onSwipeDismiss = vi.fn();

      const handlers = createSwipeTouchHandlers({
        enableVerticalDismiss: true,
        onSwipeDismiss,
        verticalThreshold: 60,
        triggerHaptics: false,
      });

      handlers.onTouchStart(makeTouchEvent({
        touches: [{ clientX: 150, clientY: 100 }],
      }));

      handlers.onTouchEnd(makeTouchEvent({
        changedTouches: [{ clientX: 150, clientY: 210 }],
      }));

      expect(onSwipeDismiss).toHaveBeenCalledTimes(1);
    });

    it("handles touch cancel cleanly without invoking swipe actions", () => {
      const onSwipeNext = vi.fn();
      const onDragEnd = vi.fn();

      const handlers = createSwipeTouchHandlers({
        onSwipeNext,
        onDragEnd,
        triggerHaptics: false,
      });

      handlers.onTouchStart(makeTouchEvent({
        touches: [{ clientX: 100, clientY: 100 }],
      }));

      handlers.onTouchCancel();

      expect(onSwipeNext).not.toHaveBeenCalled();
      expect(onDragEnd).toHaveBeenCalledTimes(1);
    });

    it("ignores touch gestures originating on sliders and interactive controls", () => {
      const onSwipeNext = vi.fn();
      const onDragMove = vi.fn();

      const handlers = createSwipeTouchHandlers({
        onSwipeNext,
        onDragMove,
        triggerHaptics: false,
      });

      const mockSliderEl = {
        closest: (sel: string) => sel.includes('[role="slider"]') ? {} : null,
      };

      handlers.onTouchStart(makeTouchEvent({
        touches: [{ clientX: 100, clientY: 100 }],
        target: mockSliderEl,
      }));

      handlers.onTouchMove(makeTouchEvent({
        touches: [{ clientX: 20, clientY: 100 }],
      }));

      handlers.onTouchEnd(makeTouchEvent({
        changedTouches: [{ clientX: 20, clientY: 100 }],
      }));

      expect(onDragMove).not.toHaveBeenCalled();
      expect(onSwipeNext).not.toHaveBeenCalled();
    });

    it("aborts swipe tracking if multi-touch gesture occurs during drag move", () => {
      const onSwipeNext = vi.fn();
      const onDragEnd = vi.fn();

      const handlers = createSwipeTouchHandlers({
        onSwipeNext,
        onDragEnd,
        triggerHaptics: false,
      });

      handlers.onTouchStart(makeTouchEvent({
        touches: [{ clientX: 100, clientY: 100 }],
      }));

      handlers.onTouchMove(makeTouchEvent({
        touches: [
          { clientX: 80, clientY: 100 },
          { clientX: 180, clientY: 120 },
        ],
      }));

      expect(onDragEnd).toHaveBeenCalledTimes(1);

      handlers.onTouchEnd(makeTouchEvent({
        changedTouches: [{ clientX: 20, clientY: 100 }],
      }));

      expect(onSwipeNext).not.toHaveBeenCalled();
    });

    it("propagates invertRtl configuration to mirror swipe skip actions when requested", () => {
      const onSwipeNext = vi.fn();
      const onSwipePrev = vi.fn();

      const handlers = createSwipeTouchHandlers({
        dir: "rtl",
        invertRtl: true,
        onSwipeNext,
        onSwipePrev,
        horizontalThreshold: 35,
        triggerHaptics: false,
      });

      // Swipe right with invertRtl in RTL -> should trigger next
      handlers.onTouchStart(makeTouchEvent({
        touches: [{ clientX: 100, clientY: 100 }],
      }));

      handlers.onTouchEnd(makeTouchEvent({
        changedTouches: [{ clientX: 160, clientY: 100 }],
      }));

      expect(onSwipeNext).toHaveBeenCalledTimes(1);
      expect(onSwipePrev).not.toHaveBeenCalled();
    });
  });
});
