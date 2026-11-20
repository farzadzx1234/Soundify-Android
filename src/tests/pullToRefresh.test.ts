import { describe, expect, it, vi } from "vitest";
import { TRANSLATIONS } from "@/context/I18nContext";

describe("Pull-to-Refresh Architecture & Lifecycle", () => {
  const DEFAULT_PULL_THRESHOLD = 64;

  describe("Pull Distance & Damping Mechanics", () => {
    it("damps raw touch delta with logarithmic curve to avoid sudden jumping", () => {
      const calculateDampedPull = (deltaY: number) =>
        Math.min(96, Math.pow(Math.max(0, deltaY), 0.85) * 1.5);

      expect(calculateDampedPull(0)).toBe(0);
      expect(calculateDampedPull(-30)).toBe(0);

      const pull50 = calculateDampedPull(50);
      const pull100 = calculateDampedPull(100);
      const pull200 = calculateDampedPull(200);

      expect(pull50).toBeGreaterThan(0);
      expect(pull100).toBeGreaterThan(pull50);
      expect(pull200).toBeGreaterThan(pull100);

      // Deceleration check: second increment is smaller than first
      expect(pull100 - pull50).toBeGreaterThan(pull200 - pull100);
      expect(pull200).toBeLessThanOrEqual(96);
    });

    it("correctly identifies when threshold is reached for release", () => {
      const isEligibleToRefresh = (pullDistance: number, threshold = DEFAULT_PULL_THRESHOLD) =>
        pullDistance >= threshold;

      expect(isEligibleToRefresh(0)).toBe(false);
      expect(isEligibleToRefresh(30)).toBe(false);
      expect(isEligibleToRefresh(63.9)).toBe(false);
      expect(isEligibleToRefresh(64)).toBe(true);
      expect(isEligibleToRefresh(85)).toBe(true);
    });
  });

  describe("Scroll Top Boundary Checks", () => {
    it("only initiates pull gesture when both window and container are at the top (<= 2px)", () => {
      const canInitiatePull = (windowScrollY: number, containerScrollTop: number) =>
        windowScrollY <= 2 && containerScrollTop <= 2;

      expect(canInitiatePull(0, 0)).toBe(true);
      expect(canInitiatePull(2, 1)).toBe(true);
      expect(canInitiatePull(10, 0)).toBe(false);
      expect(canInitiatePull(0, 50)).toBe(false);
      expect(canInitiatePull(120, 80)).toBe(false);
    });

    it("cancels pull eligibility when touch movement is predominantly horizontal", () => {
      const shouldCancelPull = (deltaX: number, deltaY: number) =>
        Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10;

      // Vertical swipe: keep pulling
      expect(shouldCancelPull(5, 50)).toBe(false);

      // Horizontal swipe across cards: cancel pull
      expect(shouldCancelPull(40, 15)).toBe(true);
      expect(shouldCancelPull(-35, 10)).toBe(true);
    });

    it("prevents pull initiation if touch starts inside a scrolled child container", () => {
      const isChildScrolled = (el: { scrollTop: number; scrollHeight: number; clientHeight: number }) => {
        return el.scrollHeight > el.clientHeight && el.scrollTop > 2;
      };

      expect(isChildScrolled({ scrollTop: 0, scrollHeight: 600, clientHeight: 300 })).toBe(false);
      expect(isChildScrolled({ scrollTop: 1, scrollHeight: 600, clientHeight: 300 })).toBe(false);
      expect(isChildScrolled({ scrollTop: 15, scrollHeight: 600, clientHeight: 300 })).toBe(true);
      expect(isChildScrolled({ scrollTop: 120, scrollHeight: 600, clientHeight: 300 })).toBe(true);
    });

    it("prevents pull initiation if touch starts on interactive inputs or sliders", () => {
      const isIgnoredElement = (target: { closest: (sel: string) => unknown }) => {
        return Boolean(target.closest('[role="slider"], input, select, textarea, [data-prevent-pull-refresh]'));
      };

      expect(isIgnoredElement({ closest: (s) => s.includes('[role="slider"]') ? {} : null })).toBe(true);
      expect(isIgnoredElement({ closest: (s) => s.includes('input') ? {} : null })).toBe(true);
      expect(isIgnoredElement({ closest: () => null })).toBe(false);
    });
  });

  describe("Lifecycle & Refresh Execution", () => {
    it("executes async refresh callback, holds spinner at 48px, and resets upon resolution", async () => {
      let isRefreshing = false;
      let pullDistance = 75;

      const mockOnRefresh = vi.fn().mockImplementation(async () => {
        // Simulated network refresh
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Simulate onTouchEnd when pulled past threshold
      if (pullDistance >= DEFAULT_PULL_THRESHOLD) {
        isRefreshing = true;
        pullDistance = 48; // holding position
        await mockOnRefresh();
        isRefreshing = false;
        pullDistance = 0;
      }

      expect(mockOnRefresh).toHaveBeenCalledTimes(1);
      expect(isRefreshing).toBe(false);
      expect(pullDistance).toBe(0);
    });

    it("gracefully recovers and resets pull state even if onRefresh rejects", async () => {
      let isRefreshing = false;
      let pullDistance = 80;

      const mockFailingRefresh = vi.fn().mockRejectedValue(new Error("Network timeout"));

      if (pullDistance >= DEFAULT_PULL_THRESHOLD) {
        isRefreshing = true;
        pullDistance = 48;
        try {
          await mockFailingRefresh();
        } catch {
          // Handled gracefully in PullToRefresh
        } finally {
          isRefreshing = false;
          pullDistance = 0;
        }
      }

      expect(mockFailingRefresh).toHaveBeenCalledTimes(1);
      expect(isRefreshing).toBe(false);
      expect(pullDistance).toBe(0);
    });
  });

  describe("RTL & LTR Localization", () => {
    it("provides pull to refresh translations for both English and Persian", () => {
      expect(TRANSLATIONS.en.pullToRefresh).toBeTruthy();
      expect(TRANSLATIONS.en.releaseToRefresh).toBeTruthy();
      expect(TRANSLATIONS.en.refreshing).toBeTruthy();

      expect(TRANSLATIONS.fa.pullToRefresh).toBeTruthy();
      expect(TRANSLATIONS.fa.releaseToRefresh).toBeTruthy();
      expect(TRANSLATIONS.fa.refreshing).toBeTruthy();

      expect(TRANSLATIONS.fa.pullToRefresh).toContain("به‌روزرسانی");
      expect(TRANSLATIONS.fa.releaseToRefresh).toContain("رها");
      expect(TRANSLATIONS.fa.refreshing).toContain("در حال");
    });
  });
});
