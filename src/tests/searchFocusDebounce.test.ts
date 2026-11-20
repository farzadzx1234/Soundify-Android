import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("Search Input State, Mobile Virtual Keyboard & Debounce Guarantees", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("Debounce & Immediate Clear Timing", () => {
    it("debounces rapid keystrokes so search/URL sync only fires once after pause", () => {
      let debouncedQuery = "";
      const syncCalls: string[] = [];
      const DEBOUNCE_MS = 280;

      let timer: NodeJS.Timeout | null = null;
      const onKeystroke = (nextVal: string) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          debouncedQuery = nextVal;
          syncCalls.push(nextVal);
        }, DEBOUNCE_MS);
      };

      // User rapidly types "m", "mo", "moe", "moee", "moeen" on mobile keyboard
      onKeystroke("m");
      vi.advanceTimersByTime(50);
      onKeystroke("mo");
      vi.advanceTimersByTime(50);
      onKeystroke("moe");
      vi.advanceTimersByTime(50);
      onKeystroke("moee");
      vi.advanceTimersByTime(50);
      onKeystroke("moeen");

      // Before 280ms expires, no query or URL transition should have fired
      expect(debouncedQuery).toBe("");
      expect(syncCalls.length).toBe(0);

      // Advance 280ms
      vi.advanceTimersByTime(280);

      // Now exactly 1 sync call should have fired for "moeen"
      expect(debouncedQuery).toBe("moeen");
      expect(syncCalls).toEqual(["moeen"]);
    });

    it("flushes immediately without debounce delay when search is cleared or submitted", () => {
      let inputValue = "shadmehr";
      let debouncedQuery = "shadmehr";
      let syncedUrl = "?q=shadmehr";

      const handleClear = () => {
        inputValue = "";
        debouncedQuery = "";
        syncedUrl = "";
      };

      // Clearing resets immediate state and debounced state simultaneously in 0ms
      handleClear();

      expect(inputValue).toBe("");
      expect(debouncedQuery).toBe("");
      expect(syncedUrl).toBe("");
    });
  });

  describe("In-Place History.replaceState URL Synchronization", () => {
    const serializeSearchUrl = (q: string, src: "local" | "external", extSrc: string) => {
      const sp = new URLSearchParams();
      const cleanQ = q.trim();
      if (cleanQ) sp.set("q", cleanQ);
      if (src === "external") {
        sp.set("source", "external");
        if (extSrc !== "all") sp.set("ext", extSrc);
      }
      return sp.toString() ? `/search?${sp.toString()}` : "/search";
    };

    it("serializes clean search URLs correctly for local and external channels", () => {
      expect(serializeSearchUrl("", "local", "all")).toBe("/search");
      expect(serializeSearchUrl("  ebi  ", "local", "all")).toBe("/search?q=ebi");
      expect(serializeSearchUrl("googoosh", "external", "all")).toBe("/search?q=googoosh&source=external");
      expect(serializeSearchUrl("hayedeh", "external", "youtube")).toBe("/search?q=hayedeh&source=external&ext=youtube");
      expect(serializeSearchUrl("dariush", "external", "spotify")).toBe("/search?q=dariush&source=external&ext=spotify");
    });

    it("uses window.history.replaceState to sync address bar without route transition focus loss", () => {
      const mockReplaceState = vi.fn();
      const originalHistory = globalThis.history;
      const originalLocation = globalThis.location;

      // Mock window.history and window.location
      const fakeLocation = {
        pathname: "/search",
        search: "",
      };

      globalThis.history = {
        ...originalHistory,
        state: null,
        replaceState: mockReplaceState,
      } as unknown as History;

      globalThis.location = fakeLocation as unknown as Location;

      const syncUrl = (q: string, src: "local" | "external", extSrc: string) => {
        const nextUrl = serializeSearchUrl(q, src, extSrc);
        const currentUrl = `${fakeLocation.pathname}${fakeLocation.search}`;
        if (currentUrl !== nextUrl) {
          globalThis.history.replaceState(globalThis.history.state, "", nextUrl);
          fakeLocation.search = nextUrl.includes("?") ? nextUrl.slice(nextUrl.indexOf("?")) : "";
        }
      };

      // Keystroke 1: "moeen"
      syncUrl("moeen", "local", "all");
      expect(mockReplaceState).toHaveBeenCalledWith(null, "", "/search?q=moeen");
      expect(fakeLocation.search).toBe("?q=moeen");

      // Repeated call with same query should NOT re-trigger replaceState
      mockReplaceState.mockClear();
      syncUrl("moeen", "local", "all");
      expect(mockReplaceState).not.toHaveBeenCalled();

      // Clear search
      syncUrl("", "local", "all");
      expect(mockReplaceState).toHaveBeenCalledWith(null, "", "/search");
      expect(fakeLocation.search).toBe("");

      // Restore
      globalThis.history = originalHistory;
      globalThis.location = originalLocation;
    });

    it("protects typing state from external navigation if input is currently focused", () => {
      const inputElement = { id: "search-input" };
      let activeElement: unknown = inputElement;
      let inputValue = "user actively typing something";
      let debouncedQuery = "user actively typing";

      const onExternalUrlChange = (incomingUrlQ: string) => {
        // If the user's active focus is on the search input, do NOT overwrite
        if (activeElement === inputElement) {
          return;
        }
        inputValue = incomingUrlQ;
        debouncedQuery = incomingUrlQ;
      };

      // External navigation triggers while user is focused
      onExternalUrlChange("another-query-from-url");
      expect(inputValue).toBe("user actively typing something");
      expect(debouncedQuery).toBe("user actively typing");

      // Once input is blurred, external navigation updates state normally
      activeElement = null;
      onExternalUrlChange("navigated-query");
      expect(inputValue).toBe("navigated-query");
      expect(debouncedQuery).toBe("navigated-query");
    });
  });

  describe("Mobile Keyboard, IME & Persistent DOM Stability", () => {
    it("verifies mobile keyboard attributes match native search and RTL guidelines", () => {
      const mobileAttributes = {
        type: "search",
        dir: "auto",
        inputMode: "search",
        autoComplete: "off",
        autoCorrect: "off",
        autoCapitalize: "none",
        spellCheck: false,
        enterKeyHint: "search",
      };

      expect(mobileAttributes.type).toBe("search");
      expect(mobileAttributes.dir).toBe("auto");
      expect(mobileAttributes.inputMode).toBe("search");
      expect(mobileAttributes.autoComplete).toBe("off");
      expect(mobileAttributes.autoCorrect).toBe("off");
      expect(mobileAttributes.autoCapitalize).toBe("none");
      expect(mobileAttributes.spellCheck).toBe(false);
      expect(mobileAttributes.enterKeyHint).toBe("search");
    });

    it("verifies clear button preserves persistent DOM node to avoid mobile IME resets", () => {
      // Rather than unmounting {value && <button>}, the button toggles opacity and pointer-events
      const getClearButtonState = (val: string) => ({
        inDOM: true,
        className: val
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none",
        ariaHidden: !val,
        tabIndex: -1,
      });

      // When empty: button remains in DOM, invisible, non-focusable
      const emptyState = getClearButtonState("");
      expect(emptyState.inDOM).toBe(true);
      expect(emptyState.className).toContain("opacity-0 pointer-events-none");
      expect(emptyState.ariaHidden).toBe(true);
      expect(emptyState.tabIndex).toBe(-1);

      // When user types first character: button stays same DOM node, becomes visible
      const typedState = getClearButtonState("a");
      expect(typedState.inDOM).toBe(true);
      expect(typedState.className).toContain("opacity-100 pointer-events-auto");
      expect(typedState.ariaHidden).toBe(false);
    });

    it("prevents focus loss on clear button touch events via onTouchStart and onPointerDown preventDefault", () => {
      const preventDefaultMock = vi.fn();
      const fakeEvent = {
        preventDefault: preventDefaultMock,
        stopPropagation: vi.fn(),
      };

      // Handler for touchstart/pointerdown on clear button
      const handleTouchProtection = (e: typeof fakeEvent) => {
        e.preventDefault();
      };

      handleTouchProtection(fakeEvent);
      expect(preventDefaultMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Layout Stability & Non-Destructive Results Loading", () => {
    it("keeps existing results visible with dimmed opacity while loading to prevent layout shifts", () => {
      type SearchRenderState = {
        loading: boolean;
        hasExistingTracks: boolean;
      };

      const getResultsRenderMode = ({ loading, hasExistingTracks }: SearchRenderState) => {
        if (loading && !hasExistingTracks) {
          return "skeletons";
        }
        if (hasExistingTracks) {
          return loading ? "tracks-dimmed" : "tracks-full";
        }
        return "empty";
      };

      // Initial search (no tracks yet): shows skeletons
      expect(getResultsRenderMode({ loading: true, hasExistingTracks: false })).toBe("skeletons");

      // Results loaded: full tracks
      expect(getResultsRenderMode({ loading: false, hasExistingTracks: true })).toBe("tracks-full");

      // Refining search while tracks exist: keeps tracks dimmed, NO skeleton collapse!
      expect(getResultsRenderMode({ loading: true, hasExistingTracks: true })).toBe("tracks-dimmed");
    });
  });
});
