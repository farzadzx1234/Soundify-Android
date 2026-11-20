import { describe, expect, it } from "vitest";
import { TRANSLATIONS } from "../context/I18nContext";

describe("Bilingual FA/EN dictionary parity", () => {
  it("has identical translation keys and non-empty strings in both English and Persian", () => {
    const enKeys = Object.keys(TRANSLATIONS.en).sort();
    const faKeys = Object.keys(TRANSLATIONS.fa).sort();
    expect(faKeys).toEqual(enKeys);

    for (const key of enKeys) {
      const k = key as keyof typeof TRANSLATIONS.en;
      expect(TRANSLATIONS.en[k].trim().length).toBeGreaterThan(0);
      expect(TRANSLATIONS.fa[k].trim().length).toBeGreaterThan(0);
    }
  });
});
