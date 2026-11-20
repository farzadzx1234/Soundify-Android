import { describe, expect, it } from "vitest";
import { findActiveLyricIndex, formatDuration, formatLrcTimestamp, parseLrc } from "../lib/lrc";

describe("Client LRC & formatting utilities", () => {
  it("finds active lyric line using binary search across boundary values", () => {
    const lines = parseLrc("[00:02.00]Line 1\n[00:08.50]Line 2\n[00:15.00]Line 3");
    expect(findActiveLyricIndex(lines, 0)).toBe(-1);
    expect(findActiveLyricIndex(lines, 1999)).toBe(-1);
    expect(findActiveLyricIndex(lines, 2000)).toBe(0);
    expect(findActiveLyricIndex(lines, 8499)).toBe(0);
    expect(findActiveLyricIndex(lines, 8500)).toBe(1);
    expect(findActiveLyricIndex(lines, 99999)).toBe(2);
    expect(findActiveLyricIndex([], 5000)).toBe(-1);
  });

  it("formats durations cleanly and guards invalid numbers", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(-5)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatDuration(3665)).toBe("61:05");
  });

  it("formats LRC timestamps correctly", () => {
    expect(formatLrcTimestamp(0)).toBe("[00:00.00]");
    expect(formatLrcTimestamp(1500)).toBe("[00:01.50]");
    expect(formatLrcTimestamp(65230)).toBe("[01:05.23]");
    expect(formatLrcTimestamp(-100)).toBe("[00:00.00]");
  });

  it("handles complex and edge-case LRC syntax", () => {
    // Empty or whitespace
    expect(parseLrc("")).toEqual([]);
    expect(parseLrc("   \n\t  ")).toEqual([]);

    // Multi-timestamp line (e.g. repeated chorus)
    const multi = "[00:01.00][00:05.00]Repeated line";
    const parsedMulti = parseLrc(multi);
    expect(parsedMulti).toHaveLength(2);
    expect(parsedMulti[0]).toEqual({ timeMs: 1000, text: "Repeated line" });
    expect(parsedMulti[1]).toEqual({ timeMs: 5000, text: "Repeated line" });

    // Global offset tag
    const withOffset = "[offset:500]\n[00:02.00]Delayed line";
    const parsedOffset = parseLrc(withOffset);
    expect(parsedOffset).toHaveLength(1);
    expect(parsedOffset[0].timeMs).toBe(2500);

    // Negative offset clamp
    const negOffset = "[offset:-3000]\n[00:02.00]Early line";
    const parsedNeg = parseLrc(negOffset);
    expect(parsedNeg[0].timeMs).toBe(0); // clamped to >= 0
  });
});
