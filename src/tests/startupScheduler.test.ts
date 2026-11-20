import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isInitialPaintComplete,
  markInitialPaintComplete,
  resetStartupScheduler,
  runAfterInitialPaint,
  scheduleDeferredInterval,
} from "@/lib/startupScheduler";

describe("Cold Startup Cooperative Scheduler", () => {
  beforeEach(() => {
    resetStartupScheduler();
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetStartupScheduler();
    vi.useRealTimers();
  });

  it("checks initial paint status", () => {
    const status = isInitialPaintComplete();
    expect(typeof status).toBe("boolean");
  });

  it("executes deferred task after delay and allows cancellation", () => {
    const task = vi.fn();
    const cancel = runAfterInitialPaint(task, 500);

    expect(task).not.toHaveBeenCalled();

    // Cancel before time advances
    cancel();
    vi.advanceTimersByTime(1000);
    expect(task).not.toHaveBeenCalled();
  });

  it("executes deferred task when timer advances", () => {
    const task = vi.fn();
    runAfterInitialPaint(task, 500);

    expect(task).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1600);
    expect(task).toHaveBeenCalled();
  });

  it("schedules recurring task deferred after initial paint", () => {
    const task = vi.fn();
    const cancel = scheduleDeferredInterval(task, 5000, 1000);

    expect(task).not.toHaveBeenCalled();

    // Advance to initial execution
    vi.advanceTimersByTime(1200);
    expect(task).toHaveBeenCalledTimes(1);

    // Advance to next interval
    vi.advanceTimersByTime(5000);
    expect(task).toHaveBeenCalledTimes(2);

    // Cancel stops subsequent intervals
    cancel();
    vi.advanceTimersByTime(10000);
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("handles markInitialPaintComplete and triggers queued callbacks immediately", () => {
    const callbackOrder: number[] = [];
    const cb1 = vi.fn(() => {
      callbackOrder.push(1);
    });
    const cb2 = vi.fn(() => {
      callbackOrder.push(2);
    });

    runAfterInitialPaint(cb1, 500);
    runAfterInitialPaint(cb2, 500);

    markInitialPaintComplete();
    expect(isInitialPaintComplete()).toBe(true);

    vi.advanceTimersByTime(600);
    expect(cb1).toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
    expect(callbackOrder).toEqual([1, 2]);
  });

  it("isolates errors in deferred tasks so subsequent tasks still execute", () => {
    const faultyTask = vi.fn(() => {
      throw new Error("Boom in deferred task");
    });
    const normalTask = vi.fn();

    runAfterInitialPaint(faultyTask, 200);
    runAfterInitialPaint(normalTask, 200);

    vi.advanceTimersByTime(500);

    expect(faultyTask).toHaveBeenCalled();
    expect(normalTask).toHaveBeenCalled();
  });

  it("resets startup scheduler cleanly via resetStartupScheduler", () => {
    markInitialPaintComplete();
    expect(isInitialPaintComplete()).toBe(true);

    resetStartupScheduler();
    expect(isInitialPaintComplete()).toBe(false);

    const task = vi.fn();
    runAfterInitialPaint(task, 400);

    // Should not run before timer or paint
    expect(task).not.toHaveBeenCalled();

    markInitialPaintComplete();
    vi.advanceTimersByTime(500);
    expect(task).toHaveBeenCalled();
  });
});
