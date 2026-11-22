import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, ApiError } from "@/lib/api";

describe("Global Search Access Permissions & Admin API", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("ApiError correctly stores status, code, and custom payload", () => {
    const err = new ApiError("Forbidden", 403, "GLOBAL_SEARCH_ACCESS_REQUIRED", { reason: "admin_required" });
    expect(err.name).toBe("ApiError");
    expect(err.status).toBe(403);
    expect(err.code).toBe("GLOBAL_SEARCH_ACCESS_REQUIRED");
    expect(err.data).toEqual({ reason: "admin_required" });
    expect(err.message).toBe("Forbidden");
  });

  it("api.adminUpdateUserPermissions sends PATCH to /api/admin/users/:id/permissions with bearer token", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody = "";

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method || "GET";
      capturedBody = typeof init?.body === "string" ? init.body : "";

      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          user: {
            id: "usr_test123",
            username: "farzad",
            displayName: "Farzad",
            role: "user",
            avatarColor: "#6366F1",
            createdAt: new Date().toISOString(),
            isActive: true,
            canAccessGlobalSearch: true,
            likedTracksCount: 5,
            playlistsCount: 2,
            commentsCount: 0,
          },
        }),
      } as unknown as Response;
    });

    const res = await api.adminUpdateUserPermissions("usr_test123", { canAccessGlobalSearch: true });

    expect(capturedUrl).toContain("/api/admin/users/usr_test123/permissions");
    expect(capturedMethod).toBe("PATCH");
    expect(JSON.parse(capturedBody)).toEqual({ canAccessGlobalSearch: true });
    expect(res.user.canAccessGlobalSearch).toBe(true);
  });

  it("api.searchExternal intercepts GLOBAL_SEARCH_ACCESS_REQUIRED and returns structured error payload", async () => {
    global.fetch = vi.fn().mockImplementation(async () => {
      return {
        ok: false,
        status: 403,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          statusCode: 403,
          error: "Forbidden",
          code: "GLOBAL_SEARCH_ACCESS_REQUIRED",
          message: "دسترسی به جستجوی شبکه‌های جهانی نیازمند تایید مدیر است.",
        }),
      } as unknown as Response;
    });

    const res = await api.searchExternal("shajarian", "youtube");

    expect(res.code).toBe("GLOBAL_SEARCH_ACCESS_REQUIRED");
    expect(res.results).toEqual([]);
    expect(res.error).toBe("دسترسی به جستجوی شبکه‌های جهانی نیازمند تایید مدیر است.");
  });
});
