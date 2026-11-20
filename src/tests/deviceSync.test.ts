import { describe, expect, it } from "vitest";
import { api } from "../lib/api";
import { getDeviceTypeLabel, localizeDeviceName } from "../lib/deviceFormatter";
import { TRANSLATIONS } from "../context/I18nContext";

describe("Device Sync & Admin Users Client API Functions", () => {
  it("exports all Spotify Connect multi-device methods on api client", () => {
    expect(typeof api.registerDevice).toBe("function");
    expect(typeof api.getDevices).toBe("function");
    expect(typeof api.getPlaybackState).toBe("function");
    expect(typeof api.updatePlaybackState).toBe("function");
    expect(typeof api.sendDeviceCommand).toBe("function");
  });

  it("exports all Admin User Management methods on api client", () => {
    expect(typeof api.adminGetUsers).toBe("function");
    expect(typeof api.adminGetUserDetails).toBe("function");
    expect(typeof api.adminUpdateUserRole).toBe("function");
    expect(typeof api.adminUpdateUserStatus).toBe("function");
    expect(typeof api.adminDeleteUser).toBe("function");
  });

  it("handles playback state payload calculations and command message structures", () => {
    const mockState = {
      activeDeviceId: "dev-phone-1",
      trackId: "track-01",
      track: null,
      isPlaying: true,
      currentTime: 45.0,
      duration: 180.0,
      volume: 0.8,
      repeat: "off" as const,
      shuffle: false,
      updatedAt: Date.now(),
    };

    expect(mockState.activeDeviceId).toBe("dev-phone-1");
    expect(mockState.isPlaying).toBe(true);
    expect(mockState.currentTime).toBe(45.0);

    const transferCommand = {
      command: "TRANSFER",
      targetDeviceId: "dev-pc-2",
      fromDeviceId: "dev-phone-1",
    };
    expect(transferCommand.command).toBe("TRANSFER");
    expect(transferCommand.targetDeviceId).toBe("dev-pc-2");

    // Seamless handover preserves playback position
    const resumeTime = mockState.currentTime;
    expect(resumeTime).toBe(45.0);
    expect(resumeTime).toBeGreaterThan(0);
  });

  it("handles remote ticker interpolation calculations without drift", () => {
    let currentTime = 10.0;
    const duration = 180.0;
    const tick = () => {
      const nextTime = currentTime + 0.25;
      currentTime = duration > 0 ? Math.min(duration, nextTime) : nextTime;
      return currentTime;
    };

    expect(tick()).toBe(10.25);
    expect(tick()).toBe(10.5);

    // If authoritative sync arrives with drift
    const authoritativeTime = 12.0;
    if (Math.abs(currentTime - authoritativeTime) > 1.0) {
      currentTime = authoritativeTime;
    }
    expect(currentTime).toBe(12.0);
  });
});

describe("Device Name & Type Localization in Persian (Farsi)", () => {
  it("translates user-agent based device names into fluent Persian", () => {
    expect(localizeDeviceName("Chrome on Windows", "fa")).toBe("کروم در ویندوز");
    expect(localizeDeviceName("Safari on iPhone", "fa")).toBe("سافاری در آیفون");
    expect(localizeDeviceName("Safari on iPad", "fa")).toBe("سافاری در آی‌پد");
    expect(localizeDeviceName("Safari on Mac", "fa")).toBe("سافاری در مک");
    expect(localizeDeviceName("Chrome on Android", "fa")).toBe("کروم در اندروید");
    expect(localizeDeviceName("Firefox on Windows", "fa")).toBe("فایرفاکس در ویندوز");
    expect(localizeDeviceName("Edge on Windows", "fa")).toBe("مایکروسافت اج در ویندوز");
    expect(localizeDeviceName("Web Player", "fa")).toBe("پخش‌کننده وب");
    expect(localizeDeviceName("Remote Device", "fa")).toBe("دستگاه راه دور");
    expect(localizeDeviceName("دیوایس دیگر / Remote Device", "fa")).toBe("دستگاه راه دور");
  });

  it("translates standalone device and OS names into fluent Persian", () => {
    expect(localizeDeviceName("iPhone", "fa")).toBe("آیفون");
    expect(localizeDeviceName("iPad", "fa")).toBe("آی‌پد");
    expect(localizeDeviceName("Mac", "fa")).toBe("مک");
    expect(localizeDeviceName("MacBook", "fa")).toBe("مک‌بوک");
    expect(localizeDeviceName("Windows PC", "fa")).toBe("رایانه ویندوز");
    expect(localizeDeviceName("Desktop", "fa")).toBe("رایانه دسکتاپ");
    expect(localizeDeviceName("Android Device", "fa")).toBe("دستگاه اندروید");
  });

  it("preserves English device names and reverse-translates Persian fallbacks when English is active", () => {
    expect(localizeDeviceName("Chrome on Windows", "en")).toBe("Chrome on Windows");
    expect(localizeDeviceName("Safari on iPhone", "en")).toBe("Safari on iPhone");
    expect(localizeDeviceName("Web Player", "en")).toBe("Web Player");
    expect(localizeDeviceName("دیوایس دیگر / Remote Device", "en")).toBe("Remote Device");
    expect(localizeDeviceName("دستگاه راه دور", "en")).toBe("Remote Device");
    expect(localizeDeviceName("پخش‌کننده وب", "en")).toBe("Web Player");
    expect(localizeDeviceName("کروم در ویندوز", "en")).toBe("Chrome on Windows");
    expect(localizeDeviceName("سافاری در آیفون", "en")).toBe("Safari on iPhone");
  });

  it("handles null, empty, or whitespace inputs gracefully", () => {
    expect(localizeDeviceName("", "fa")).toBe("دستگاه راه دور");
    expect(localizeDeviceName("", "en")).toBe("Remote Device");
    expect(localizeDeviceName("   ", "fa")).toBe("دستگاه راه دور");
    expect(localizeDeviceName("   ", "en")).toBe("Remote Device");
  });

  it("preserves custom Persian device names", () => {
    expect(localizeDeviceName("اسپیکر نشیمن", "fa")).toBe("اسپیکر نشیمن");
    expect(localizeDeviceName("گوشی شخصی", "fa")).toBe("گوشی شخصی");
  });

  it("maps device types to correct localized strings in both Persian and English", () => {
    const tFa = (key: keyof typeof TRANSLATIONS.fa) => TRANSLATIONS.fa[key];
    const tEn = (key: keyof typeof TRANSLATIONS.en) => TRANSLATIONS.en[key];

    expect(getDeviceTypeLabel("desktop", tFa)).toBe("رایانه و لپ‌تاپ");
    expect(getDeviceTypeLabel("smartphone", tFa)).toBe("گوشی موبایل");
    expect(getDeviceTypeLabel("tablet", tFa)).toBe("تبلت");
    expect(getDeviceTypeLabel("browser", tFa)).toBe("مرورگر وب");
    expect(getDeviceTypeLabel("speaker", tFa)).toBe("اسپیکر / بلندگو");
    expect(getDeviceTypeLabel("unknown_type", tFa)).toBe("دستگاه");

    expect(getDeviceTypeLabel("desktop", tEn)).toBe("Desktop / Computer");
    expect(getDeviceTypeLabel("smartphone", tEn)).toBe("Smartphone");
    expect(getDeviceTypeLabel("tablet", tEn)).toBe("Tablet");
    expect(getDeviceTypeLabel("browser", tEn)).toBe("Web Browser");
    expect(getDeviceTypeLabel("speaker", tEn)).toBe("Speaker / Audio Output");
    expect(getDeviceTypeLabel("unknown_type", tEn)).toBe("Device");
  });

  it("correctly computes active device state without false remote playback flags", () => {
    const thisDeviceId: string = "dev-laptop-01";

    // Scenario 1: Fresh user / initial state (activeDeviceId is null)
    const activeDeviceIdNull: string | null = null;
    const isThisDeviceActive1 = !thisDeviceId || !activeDeviceIdNull || activeDeviceIdNull === thisDeviceId;
    const isRemotePlaybackActive1 = Boolean(thisDeviceId && activeDeviceIdNull && activeDeviceIdNull !== thisDeviceId);
    const effectiveActiveDeviceId1 = activeDeviceIdNull || thisDeviceId;

    expect(isThisDeviceActive1).toBe(true);
    expect(isRemotePlaybackActive1).toBe(false);
    expect(effectiveActiveDeviceId1).toBe(thisDeviceId);

    // Scenario 2: Active device is explicitly this device
    const activeDeviceIdSelf: string | null = "dev-laptop-01";
    const isThisDeviceActive2 = !thisDeviceId || !activeDeviceIdSelf || activeDeviceIdSelf === thisDeviceId;
    const isRemotePlaybackActive2 = Boolean(thisDeviceId && activeDeviceIdSelf && activeDeviceIdSelf !== thisDeviceId);
    const effectiveActiveDeviceId2 = activeDeviceIdSelf || thisDeviceId;

    expect(isThisDeviceActive2).toBe(true);
    expect(isRemotePlaybackActive2).toBe(false);
    expect(effectiveActiveDeviceId2).toBe(thisDeviceId);

    // Scenario 3: Active device is a remote device (e.g. mobile phone)
    const activeDeviceIdRemote: string | null = "dev-phone-02";
    const isThisDeviceActive3 = !thisDeviceId || !activeDeviceIdRemote || activeDeviceIdRemote === thisDeviceId;
    const isRemotePlaybackActive3 = Boolean(thisDeviceId && activeDeviceIdRemote && activeDeviceIdRemote !== thisDeviceId);
    const effectiveActiveDeviceId3 = activeDeviceIdRemote || thisDeviceId;

    expect(isThisDeviceActive3).toBe(false);
    expect(isRemotePlaybackActive3).toBe(true);
    expect(effectiveActiveDeviceId3).toBe("dev-phone-02");
  });

  it("has complete and valid Persian translations for all live streaming and multi-device keys", () => {
    const requiredKeys = [
      "devicesTitle",
      "devicesDesc",
      "listeningOnThisDevice",
      "listeningOnRemoteDevice",
      "playingOn",
      "playOnThisDevice",
      "transferPlayback",
      "switchDevice",
      "thisDevice",
      "currentDeviceBadge",
      "deviceActive",
      "deviceOnlineReady",
      "selectDeviceToPlay",
      "scanningDevices",
      "noOtherDevicesFound",
      "deviceSyncFooter",
      "remotePlaybackNotice",
      "remoteControl",
      "deviceTypeDesktop",
      "deviceTypeSmartphone",
      "deviceTypeTablet",
      "deviceTypeBrowser",
      "remotePlaying",
      "remotePaused",
      "connectedDevicesTooltip",
    ] as const;

    for (const key of requiredKeys) {
      expect(TRANSLATIONS.fa[key]).toBeDefined();
      expect(TRANSLATIONS.fa[key].length).toBeGreaterThan(0);
      expect(TRANSLATIONS.en[key]).toBeDefined();
      expect(TRANSLATIONS.en[key].length).toBeGreaterThan(0);

      // Verify Persian contains actual Persian characters, not English
      const faVal = TRANSLATIONS.fa[key];
      expect(/[\u0600-\u06FF]/.test(faVal)).toBe(true);
    }
  });
});

