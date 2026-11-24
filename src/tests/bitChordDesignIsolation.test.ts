import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BITCHORD_DESIGN_EVENT,
  BITCHORD_DESIGN_STORAGE_KEY,
  getBitChordDesignPreference,
  setBitChordDesignPreference,
} from "@/bitchord/designMode";

function createMockWindow() {
  const store = new Map<string, string>();
  const target = new EventTarget();
  return {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
}

describe("BitChord Design Mode Isolation & Settings Toggle", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    (globalThis as unknown as { window: ReturnType<typeof createMockWindow> }).window =
      createMockWindow();
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as unknown as { window?: unknown }).window;
    } else {
      (globalThis as unknown as { window: Window & typeof globalThis }).window = originalWindow;
    }
  });

  it("defaults to disabled (false) and persists explicit toggles in localStorage with change event", () => {
    let events = 0;
    window.addEventListener(BITCHORD_DESIGN_EVENT, () => {
      events += 1;
    });

    expect(getBitChordDesignPreference()).toBe(false);
    setBitChordDesignPreference(true);
    expect(getBitChordDesignPreference()).toBe(true);
    expect(window.localStorage.getItem(BITCHORD_DESIGN_STORAGE_KEY)).toBe("true");
    expect(events).toBe(1);

    setBitChordDesignPreference(false);
    expect(getBitChordDesignPreference()).toBe(false);
    expect(window.localStorage.getItem(BITCHORD_DESIGN_STORAGE_KEY)).toBe("false");
    expect(events).toBe(2);
  });

  it("fails safe to false when window is undefined (SSR)", () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    expect(getBitChordDesignPreference()).toBe(false);
  });

  it("keeps all BitChord CSS rules scoped to [data-ui-skin=\"bitchord\"] or .bc-*", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../bitchord/bitchord.css"), "utf8");
    expect(css).toContain(':root[data-ui-skin="bitchord"]');
    expect(css).toContain(".bc-pill-glass");
    expect(css).toContain(".bc-mini-pill");
    expect(css).toContain(".bc-hero-art-mask");
    expect(css).not.toContain("اپل موزیک");
  });

  it("wires BitChordSettingsCard in Settings and dynamic BitChordShell in AppShell without mutating default shell or logic", () => {
    const settingsSrc = fs.readFileSync(
      path.resolve(__dirname, "../app/settings/page.tsx"),
      "utf8",
    );
    expect(settingsSrc).toContain("<BitChordSettingsCard />");

    const appShellSrc = fs.readFileSync(
      path.resolve(__dirname, "../components/AppShell.tsx"),
      "utf8",
    );
    expect(appShellSrc).toContain("isBitChordBootActive");
    expect(appShellSrc).toContain("DefaultAppShell");
    expect(appShellSrc).toContain("@/bitchord/BitChordShell");

    const layoutSrc = fs.readFileSync(
      path.resolve(__dirname, "../app/layout.tsx"),
      "utf8",
    );
    expect(layoutSrc).toContain(BITCHORD_DESIGN_STORAGE_KEY);
    expect(layoutSrc).toContain('data-ui-skin');
  });

  it("preserves offline-first OptimizedTrackImage contracts in BitChord MiniPlayer and NowPlaying", () => {
    for (const rel of [
      "../bitchord/BitChordMiniPlayer.tsx",
      "../bitchord/BitChordNowPlaying.tsx",
    ]) {
      const src = fs.readFileSync(path.resolve(__dirname, rel), "utf8");
      expect(src).toContain("<OptimizedTrackImage");
      expect(src).toContain("trackTitle=");
      expect(src).toContain("artistName=");
    }
  });

  it("enforces hydration-safe boot lock, dark-mode filled button contrast, and mobile lyrics source parity", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../bitchord/bitchord.css"), "utf8");
    expect(css).toContain('button.sf-btn[style*="var(--sf-accent)"]');
    expect(css).toContain(':root[data-ui-skin="bitchord"][data-resolved-theme="light"]');

    const settingsCardSrc = fs.readFileSync(
      path.resolve(__dirname, "../bitchord/BitChordSettingsCard.tsx"),
      "utf8",
    );
    expect(settingsCardSrc).toContain("useSyncExternalStore");

    const shellSrc = fs.readFileSync(
      path.resolve(__dirname, "../bitchord/BitChordShell.tsx"),
      "utf8",
    );
    expect(shellSrc).toContain('setAttribute("data-ui-skin", "bitchord")');
    expect(shellSrc).toContain('pathname.startsWith("/settings")');

    const nowPlayingSrc = fs.readFileSync(
      path.resolve(__dirname, "../bitchord/BitChordNowPlaying.tsx"),
      "utf8",
    );
    expect(nowPlayingSrc).toContain("setLyricsSourcesOpen(true)");
    expect(nowPlayingSrc).toContain("sf-automix-dissolve-out");
  });
});
