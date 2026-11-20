"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, onAuthTokensChanged, setApiTokens } from "@/lib/api";
import { clearCachedUserSync, getCachedUserSync, syncUserData } from "@/lib/mobileSync";
import type { ChangePasswordPayload, User, UserProfileUpdatePayload, UserSyncData } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  userSyncData: UserSyncData | null;
  loading: boolean;
  authDialogOpen: boolean;
  openAuthDialog: () => void;
  closeAuthDialog: () => void;
  login: (identifier: string, password: string) => Promise<void>;
  register: (payload: {
    username: string;
    email: string;
    displayName: string;
    displayNameFa?: string;
    password: string;
  }) => Promise<void>;
  loginDemo: () => Promise<void>;
  logout: () => Promise<void>;
  syncUser: () => Promise<UserSyncData | null>;
  updateProfile: (payload: UserProfileUpdatePayload) => Promise<void>;
  changePassword: (payload: ChangePasswordPayload) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userSyncData, setUserSyncData] = useState<UserSyncData | null>(null);
  const [loading, setLoading] = useState(true);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);

  const syncUser = useCallback(async (): Promise<UserSyncData | null> => {
    try {
      const { data } = await syncUserData();
      if (data) {
        setUserSyncData(data);
        if (data.user) setUser(data.user);
      }
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    // Prime cached data immediately for instant offline render
    const cached = getCachedUserSync();
    if (cached) {
      queueMicrotask(() => {
        setUserSyncData(cached);
        if (cached.user) setUser(cached.user);
      });
    }

    const unsubscribeTokens = onAuthTokensChanged((hasToken) => {
      if (!hasToken) {
        if (typeof window !== "undefined") {
          try {
            localStorage.removeItem("soundify_player_state");
            window.dispatchEvent(new CustomEvent("soundify:account-reset"));
          } catch {}
        }
        setUser(null);
        setUserSyncData(null);
        clearCachedUserSync();
      }
    });

    api
      .me()
      .then((res) => {
        setUser(res.user);
        if (res.user) {
          void syncUser();
        } else {
          setUserSyncData(null);
          clearCachedUserSync();
        }
      })
      .catch((err) => {
        const msg = String(err?.message || "");
        if (msg.includes("401") || msg.includes("Authentication") || msg.includes("expired")) {
          if (typeof window !== "undefined") {
            try {
              localStorage.removeItem("soundify_player_state");
              window.dispatchEvent(new CustomEvent("soundify:account-reset"));
            } catch {}
          }
          setUser(null);
          setUserSyncData(null);
          clearCachedUserSync();
        } else if (!cached) {
          setUser(null);
        }
      })
      .finally(() => setLoading(false));

    const onOnline = () => {
      void syncUser();
    };
    window.addEventListener("online", onOnline);
    return () => {
      unsubscribeTokens();
      window.removeEventListener("online", onOnline);
    };
  }, [syncUser]);

  const openAuthDialog = useCallback(() => setAuthDialogOpen(true), []);
  const closeAuthDialog = useCallback(() => setAuthDialogOpen(false), []);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const res = await api.login(identifier, password);
      setApiTokens(res.token, res.refreshToken);
      setUser(res.user);
      setAuthDialogOpen(false);
      void syncUser();
    },
    [syncUser],
  );

  const register = useCallback(
    async (payload: {
      username: string;
      email: string;
      displayName: string;
      displayNameFa?: string;
      password: string;
    }) => {
      const res = await api.register(payload);
      setApiTokens(res.token, res.refreshToken);
      setUser(res.user);
      setAuthDialogOpen(false);
      void syncUser();
    },
    [syncUser],
  );

  const loginDemo = useCallback(async () => {
    await login("demo", "demo1234");
  }, [login]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem("soundify_player_state");
          window.dispatchEvent(new CustomEvent("soundify:account-reset"));
        } catch {}
      }
      setApiTokens(null, null);
      setUser(null);
      setUserSyncData(null);
      clearCachedUserSync();
    }
  }, []);

  const updateProfile = useCallback(
    async (payload: UserProfileUpdatePayload) => {
      const res = await api.updateUserProfile(payload);
      setUser(res.user);
      void syncUser();
    },
    [syncUser],
  );

  const changePassword = useCallback(async (payload: ChangePasswordPayload) => {
    await api.changePassword(payload);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      userSyncData,
      loading,
      authDialogOpen,
      openAuthDialog,
      closeAuthDialog,
      login,
      register,
      loginDemo,
      logout,
      syncUser,
      updateProfile,
      changePassword,
    }),
    [
      user,
      userSyncData,
      loading,
      authDialogOpen,
      openAuthDialog,
      closeAuthDialog,
      login,
      register,
      loginDemo,
      logout,
      syncUser,
      updateProfile,
      changePassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
