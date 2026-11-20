/**
 * Cold Startup & Idle Cooperative Scheduler.
 *
 * Accelerates mobile cold startup by deferring non-essential initializations
 * (such as background sync, device telemetry, SSE event streams, and cryptographic key vaults)
 * until after the initial paint is rendered and the main thread is idle.
 */

export type TaskPriority = "immediate" | "idle" | "background";

let initialPaintCompleted = false;
let postPaintCallbacks: Array<() => void> = [];

function triggerPostPaintCallbacks(): void {
  while (postPaintCallbacks.length > 0) {
    const cb = postPaintCallbacks.shift();
    try {
      cb?.();
    } catch {}
  }
}

if (typeof window !== "undefined") {
  // Mark paint completed after double requestAnimationFrame or load event
  const markPaint = () => {
    if (initialPaintCompleted) return;
    initialPaintCompleted = true;
    triggerPostPaintCallbacks();
  };

  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        markPaint();
      });
    });
  } else if (typeof document !== "undefined" && document.readyState === "complete") {
    markPaint();
  } else {
    window.addEventListener("load", markPaint, { once: true });
  }

  // Safe timeout for headless or backgrounded contexts where rAF or load do not fire
  setTimeout(markPaint, 2500);
}

/**
 * Resets scheduler state (primarily used in tests and isolated lifecycles).
 */
export function resetStartupScheduler(): void {
  initialPaintCompleted = false;
  postPaintCallbacks = [];
}

/**
 * For testing or manual override: forces marking initial paint as complete.
 */
export function markInitialPaintComplete(): void {
  initialPaintCompleted = true;
  triggerPostPaintCallbacks();
}

/**
 * Checks if the browser has completed the initial paint.
 */
export function isInitialPaintComplete(): boolean {
  return initialPaintCompleted;
}

/**
 * Defers execution of a non-critical task until after the initial paint and browser is idle.
 * Returns a cancellation function.
 */
export function runAfterInitialPaint(
  callback: () => void | Promise<void>,
  fallbackDelayMs = 1000,
): () => void {
  let cancelled = false;
  let executed = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let idleId: number | null = null;

  const execute = () => {
    if (cancelled || executed) return;
    executed = true;
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = (window as unknown as { requestIdleCallback: (cb: () => void, opts: { timeout: number }) => number }).requestIdleCallback(
        () => {
          if (!cancelled) {
            try {
              void callback();
            } catch {}
          }
        },
        { timeout: 1000 },
      );
    } else {
      try {
        void callback();
      } catch {}
    }
  };

  if (initialPaintCompleted) {
    timerId = setTimeout(execute, fallbackDelayMs);
  } else {
    postPaintCallbacks.push(execute);
    // Safety timer ensures task runs after fallback delay even if load event was missed
    timerId = setTimeout(() => {
      execute();
    }, fallbackDelayMs);
  }

  return () => {
    cancelled = true;
    if (timerId !== null) clearTimeout(timerId);
    if (idleId !== null && "cancelIdleCallback" in window) {
      (window as unknown as { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(idleId);
    }
  };
}

/**
 * Schedules a recurring background sync task that starts strictly after initial paint.
 */
export function scheduleDeferredInterval(
  task: () => void | Promise<void>,
  intervalMs = 30000,
  initialDelayMs = 1500,
): () => void {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let isCancelled = false;

  const cancelStartup = runAfterInitialPaint(() => {
    if (isCancelled) return;
    void task();
    intervalId = setInterval(() => {
      if (!isCancelled) {
        void task();
      }
    }, intervalMs);
  }, initialDelayMs);

  return () => {
    isCancelled = true;
    cancelStartup();
    if (intervalId !== null) {
      clearInterval(intervalId);
    }
  };
}
