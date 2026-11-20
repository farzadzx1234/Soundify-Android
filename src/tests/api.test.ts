import { beforeEach, describe, expect, it } from "vitest";
import { api, getApiToken, getCachedCatalogArtists, getCachedCatalogPlaylists, getCachedCatalogTracks, setApiToken } from "../lib/api";

describe("Client API utilities", () => {
  beforeEach(() => {
    setApiToken(null);
  });

  it("stores and retrieves auth token properly", () => {
    expect(getApiToken()).toBeNull();
    setApiToken("test-token-xyz");
    expect(getApiToken()).toBe("test-token-xyz");
    setApiToken(null);
    expect(getApiToken()).toBeNull();
  });

  it("exposes adminDeleteTrack and deleteTrack API methods", () => {
    expect(typeof api.adminDeleteTrack).toBe("function");
    expect(typeof api.deleteTrack).toBe("function");
  });

  it("exposes SWR catalog cache readers cleanly", () => {
    expect(typeof getCachedCatalogTracks).toBe("function");
    expect(typeof getCachedCatalogPlaylists).toBe("function");
    expect(typeof getCachedCatalogArtists).toBe("function");
    expect(getCachedCatalogTracks()).toBeNull();
    expect(getCachedCatalogPlaylists()).toBeNull();
    expect(getCachedCatalogArtists()).toBeNull();
  });
});
