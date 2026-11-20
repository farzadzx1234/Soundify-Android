import { describe, expect, it } from "vitest";
import {
  filterSensitiveTracks,
  isPoliticallySensitive,
  isSearchQuerySensitive,
} from "@/lib/contentFilter";
import type { Track } from "@/lib/types";

describe("Content Moderation & Political Search Filter", () => {
  it("detects sensitive Persian political keywords and slogans", () => {
    expect(isPoliticallySensitive("زن زندگی آزادی")).toBe(true);
    expect(isPoliticallySensitive("آهنگ مهسا امینی")).toBe(true);
    expect(isPoliticallySensitive("رضا پهلوی سرنگونی")).toBe(true);
    expect(isPoliticallySensitive("مرگ بر خامنه ای")).toBe(true);
    expect(isPoliticallySensitive("توماج صالحی جدید")).toBe(true);
    expect(isPoliticallySensitive("شاهین نجفی")).toBe(true);
  });

  it("detects English equivalents and transliterations", () => {
    expect(isPoliticallySensitive("woman life freedom")).toBe(true);
    expect(isPoliticallySensitive("protest song for mahsa amini")).toBe(true);
    expect(isPoliticallySensitive("shahin najafi new track")).toBe(true);
    expect(isPoliticallySensitive("toomaj salehi rap")).toBe(true);
    expect(isSearchQuerySensitive("down with khamenei")).toBe(true);
  });

  it("permits standard non-political Persian and English tracks", () => {
    expect(isPoliticallySensitive("محسن یگانه بهت قول میدم")).toBe(false);
    expect(isPoliticallySensitive("Shadmehr Aghili - Taghdir")).toBe(false);
    expect(isPoliticallySensitive("هلیا از پوتک")).toBe(false);
    expect(isPoliticallySensitive("به مولا حصین")).toBe(false);
    expect(isPoliticallySensitive("Coldplay - Yellow")).toBe(false);
    expect(isSearchQuerySensitive("آهنگ شاد پاپ")).toBe(false);
  });

  it("filters sensitive tracks from music catalog arrays", () => {
    const mixedTracks: Partial<Track>[] = [
      { id: "1", title: "بهت قول میدم", artistName: "محسن یگانه" },
      { id: "2", title: "برای...", artistName: "زن زندگی آزادی" },
      { id: "3", title: "Helia", artistName: "Putak" },
      { id: "4", title: "سرنگونی", artistName: "اعتراضات" },
      { id: "5", title: "Be Mola", artistName: "Hoosein" },
    ];

    const filtered = filterSensitiveTracks(mixedTracks);
    expect(filtered).toHaveLength(3);
    expect(filtered.map((t) => t.id)).toEqual(["1", "3", "5"]);
  });
});
