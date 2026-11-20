import { describe, expect, it } from "vitest";
import { api } from "../lib/api";

describe("Frontend External Search Client", () => {
  it("has searchExternal function exposed on api object", () => {
    expect(typeof api.searchExternal).toBe("function");
  });
});
