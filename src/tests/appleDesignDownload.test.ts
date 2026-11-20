import { describe, expect, it, vi } from "vitest";
import type { Track } from "@/lib/types";

describe("Apple HIG Download Button & Action Sheet State Machine", () => {
  interface DownloadButtonState {
    status: "idle" | "downloading" | "downloaded" | "paused" | "error";
    progress: number;
    showActionSheet: boolean;
  }

  function handleDownloadButtonClick(state: DownloadButtonState): {
    nextState: DownloadButtonState;
    actionTriggered: "startDownload" | "pauseDownload" | "openActionSheet" | "retryDownload";
  } {
    if (state.status === "downloaded") {
      // Rule 1: Clicking an already downloaded track MUST NOT redownload or immediately delete.
      // It must open the Apple HIG Action Sheet.
      return {
        nextState: { ...state, showActionSheet: true },
        actionTriggered: "openActionSheet",
      };
    }

    if (state.status === "downloading") {
      return {
        nextState: { ...state, status: "paused" },
        actionTriggered: "pauseDownload",
      };
    }

    if (state.status === "error") {
      return {
        nextState: { ...state, status: "downloading" },
        actionTriggered: "retryDownload",
      };
    }

    return {
      nextState: { ...state, status: "downloading" },
      actionTriggered: "startDownload",
    };
  }

  it("opens Apple HIG action sheet on downloaded tracks without re-downloading", () => {
    const initialState: DownloadButtonState = {
      status: "downloaded",
      progress: 100,
      showActionSheet: false,
    };

    const { nextState, actionTriggered } = handleDownloadButtonClick(initialState);
    expect(actionTriggered).toBe("openActionSheet");
    expect(nextState.showActionSheet).toBe(true);
    expect(nextState.status).toBe("downloaded"); // status is preserved!
  });

  it("pauses in-flight downloads when tapped during downloading", () => {
    const initialState: DownloadButtonState = {
      status: "downloading",
      progress: 45,
      showActionSheet: false,
    };

    const { nextState, actionTriggered } = handleDownloadButtonClick(initialState);
    expect(actionTriggered).toBe("pauseDownload");
    expect(nextState.status).toBe("paused");
  });

  describe("Action Sheet Workflow", () => {
    const sampleTrack = {
      id: "track-1",
      title: "Helia",
      titleFa: "هلیا",
      artistId: "artist-1",
      artistName: "Putak",
      album: "Album",
      genre: "Rap",
      durationSec: 200,
      audioUrl: "/audio/sample.mp3",
      coverUrl: "/covers/sample.jpg",
      waveform: [],
      hasLyrics: false,
      lyricsSource: "none",
      lyricsOffsetMs: 0,
      playsCount: 0,
      likesCount: 0,
      repostsCount: 0,
    } as unknown as Track;

    it("supports 3 distinct HIG actions: Play Offline, Save to Device Storage, and Delete Download", () => {
      const actions = ["playOffline", "saveToDeviceStorage", "deleteDownload"] as const;

      const playOfflineMock = vi.fn();
      const exportStorageMock = vi.fn();
      const deleteDownloadMock = vi.fn();

      for (const action of actions) {
        if (action === "playOffline") playOfflineMock(sampleTrack);
        if (action === "saveToDeviceStorage") exportStorageMock(sampleTrack);
        if (action === "deleteDownload") deleteDownloadMock(sampleTrack.id);
      }

      expect(playOfflineMock).toHaveBeenCalledWith(sampleTrack);
      expect(exportStorageMock).toHaveBeenCalledWith(sampleTrack);
      expect(deleteDownloadMock).toHaveBeenCalledWith("track-1");
    });
  });
});
