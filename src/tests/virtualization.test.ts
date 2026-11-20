import { describe, it, expect } from "vitest";
import type { Track } from "@/lib/types";

function createMockTracks(count: number): Track[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `track-${i + 1}`,
    title: `Track ${i + 1}`,
    titleFa: `آهنگ ${i + 1}`,
    artistId: `artist-${(i % 5) + 1}`,
    artistName: `Artist ${(i % 5) + 1}`,
    artistNameFa: `خواننده ${(i % 5) + 1}`,
    artistAvatarColor: "#6366f1",
    album: "Album Test",
    albumFa: "آلبوم آزمایشی",
    genre: "Pop",
    mood: "Chill",
    durationSec: 180 + (i % 60),
    audioUrl: `/api/tracks/track-${i + 1}/stream`,
    coverUrl: `/api/tracks/track-${i + 1}/cover`,
    accentColor: "#6366f1",
    waveform: [0.1, 0.4, 0.7],
    hasLyrics: true,
    lyricsSource: "lrclib",
    playsCount: 100 * (i + 1),
    likesCount: 10 * (i + 1),
    repostsCount: i,
    likedByMe: false,
    repostedByMe: false,
    uploadedBy: "admin",
    createdAt: "2026-01-01T00:00:00Z",
  }));
}

describe("List Virtualization Performance Calculations", () => {
  it("calculates accurate windowing slice for 100 tracks on mobile (1 column)", () => {
    const tracks = createMockTracks(100);
    const itemsPerRow = 1; // Mobile portrait
    const rowHeight = 350;
    const overscanRows = 2;
    const viewportHeight = 800; // e.g. mobile screen height
    const scrollTop = 1400; // Scrolled down 4 rows

    const totalRows = Math.ceil(tracks.length / itemsPerRow);
    expect(totalRows).toBe(100);

    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
    const visibleRowCount = Math.ceil(viewportHeight / rowHeight) + overscanRows * 2;
    const endRow = Math.min(totalRows, startRow + visibleRowCount);

    // startRow = floor(1400/350) - 2 = 4 - 2 = 2
    expect(startRow).toBe(2);
    // visibleRowCount = ceil(800/350) + 4 = 3 + 4 = 7
    // endRow = min(100, 2 + 7) = 9
    expect(endRow).toBe(9);

    const startIndex = startRow * itemsPerRow;
    const endIndex = Math.min(tracks.length, endRow * itemsPerRow);
    const visibleSlice = tracks.slice(startIndex, endIndex);

    // Only 7 items rendered in DOM out of 100!
    expect(visibleSlice.length).toBe(7);
    expect(visibleSlice[0].id).toBe("track-3"); // index 2
    expect(visibleSlice[visibleSlice.length - 1].id).toBe("track-9"); // index 8

    // Spacers preserve exact total height
    const topSpacer = startRow * rowHeight;
    const bottomSpacer = (totalRows - endRow) * rowHeight;
    expect(topSpacer).toBe(2 * 350); // 700px
    expect(bottomSpacer).toBe(91 * 350); // 31850px
    expect(topSpacer + visibleSlice.length * rowHeight + bottomSpacer).toBe(100 * 350); // Exact 35000px!
  });

  it("calculates windowing slice for 120 tracks on desktop (4 columns)", () => {
    const tracks = createMockTracks(120);
    const itemsPerRow = 4;
    const rowHeight = 340;
    const overscanRows = 1;
    const viewportHeight = 1000;
    const scrollTop = 680; // row index 2

    const totalRows = Math.ceil(tracks.length / itemsPerRow);
    expect(totalRows).toBe(30);

    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
    const visibleRowCount = Math.ceil(viewportHeight / rowHeight) + overscanRows * 2;
    const endRow = Math.min(totalRows, startRow + visibleRowCount);

    // startRow = floor(680/340) - 1 = 2 - 1 = 1
    expect(startRow).toBe(1);
    // visibleRowCount = ceil(1000/340) + 2 = 3 + 2 = 5
    // endRow = 1 + 5 = 6
    expect(endRow).toBe(6);

    const startIndex = startRow * itemsPerRow; // 4
    const endIndex = Math.min(tracks.length, endRow * itemsPerRow); // 24
    const visibleSlice = tracks.slice(startIndex, endIndex);

    expect(visibleSlice.length).toBe(20); // 5 rows * 4 columns = 20 items in DOM instead of 120!
    expect(startIndex).toBe(4);
    expect(endIndex).toBe(24);
  });

  it("handles boundary scroll at top and bottom without out-of-bounds error", () => {
    const tracks = createMockTracks(50);
    const rowHeight = 60;
    const overscan = 3;
    const viewportHeight = 600;

    // Top boundary (scrollTop = 0)
    let startIdx = Math.max(0, Math.floor(0 / rowHeight) - overscan);
    let endIdx = Math.min(tracks.length, startIdx + Math.ceil(viewportHeight / rowHeight) + overscan * 2);
    expect(startIdx).toBe(0);
    expect(endIdx).toBe(16); // 10 visible + 6 overscan

    // Bottom boundary (scrollTop = 3000)
    startIdx = Math.max(0, Math.floor(3000 / rowHeight) - overscan);
    endIdx = Math.min(tracks.length, startIdx + Math.ceil(viewportHeight / rowHeight) + overscan * 2);
    expect(startIdx).toBe(47);
    expect(endIdx).toBe(50);
  });

  it("handles empty track list safely", () => {
    const tracks = createMockTracks(0);
    const rowHeight = 60;
    const overscan = 3;
    const viewportHeight = 600;

    const startIdx = Math.max(0, Math.floor(0 / rowHeight) - overscan);
    const endIdx = Math.min(tracks.length, startIdx + Math.ceil(viewportHeight / rowHeight) + overscan * 2);
    expect(startIdx).toBe(0);
    expect(endIdx).toBe(0);

    const slice = tracks.slice(startIdx, endIdx);
    expect(slice).toHaveLength(0);
  });

  it("handles extreme overscroll beyond list end without negative or overflow index errors", () => {
    const tracks = createMockTracks(30);
    const rowHeight = 60;
    const overscan = 2;
    const viewportHeight = 600;
    const extremeScrollTop = 50000;

    const totalRows = tracks.length;
    const rawStartIdx = Math.floor(extremeScrollTop / rowHeight) - overscan;
    const startIdx = Math.min(tracks.length, Math.max(0, rawStartIdx));
    const endIdx = Math.min(tracks.length, startIdx + Math.ceil(viewportHeight / rowHeight) + overscan * 2);

    expect(startIdx).toBe(totalRows);
    expect(endIdx).toBe(totalRows);
    expect(tracks.slice(startIdx, endIdx)).toHaveLength(0);

    // Spacers must never exceed totalHeight
    const totalHeight = tracks.length * rowHeight;
    const topSpacer = Math.min(totalHeight, startIdx * rowHeight);
    const bottomSpacer = Math.max(0, (tracks.length - endIdx) * rowHeight);
    expect(topSpacer).toBe(totalHeight);
    expect(bottomSpacer).toBe(0);
    expect(topSpacer + bottomSpacer).toBeLessThanOrEqual(totalHeight);
  });

  it("calculates clamped grid rows during rapid fling overscroll past bottom", () => {
    const tracks = createMockTracks(40);
    const itemsPerRow = 2; // mobile landscape / tablet
    const estimatedRowHeight = 350;
    const overscanRows = 2;
    const viewportHeight = 800;
    const extremeScrollTop = 200000;

    const totalRows = Math.ceil(tracks.length / itemsPerRow); // 20 rows
    const totalHeight = totalRows * estimatedRowHeight; // 7000px

    const rawStartRow = Math.floor(extremeScrollTop / estimatedRowHeight) - overscanRows;
    const startRow = Math.min(totalRows, Math.max(0, rawStartRow));
    const visibleRowCount = Math.ceil(viewportHeight / estimatedRowHeight) + overscanRows * 2;
    const endRow = Math.min(totalRows, startRow + visibleRowCount);

    const startIndex = Math.min(tracks.length, startRow * itemsPerRow);
    const endIndex = Math.min(tracks.length, endRow * itemsPerRow);

    expect(startRow).toBe(totalRows);
    expect(endRow).toBe(totalRows);
    expect(startIndex).toBe(tracks.length);
    expect(endIndex).toBe(tracks.length);

    const topSpacer = Math.min(totalHeight, startRow * estimatedRowHeight);
    const bottomSpacer = Math.max(0, (totalRows - endRow) * estimatedRowHeight);

    expect(topSpacer).toBe(totalHeight);
    expect(bottomSpacer).toBe(0);
  });
});
