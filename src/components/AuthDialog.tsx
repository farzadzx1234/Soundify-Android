"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button, GlassSegmented, Input } from "@/components/GlassControls";
import { EnvelopeSimpleIcon, LockKeyIcon, SparkleIcon, UserIcon, XIcon } from "@phosphor-icons/react";
import { useAuth } from "@/context/AuthContext";
import { useI18n } from "@/context/I18nContext";

export function AuthDialog() {
  const { authDialogOpen, closeAuthDialog, login, register } = useAuth();
  const { t, pickText } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const [mode, setMode] = useState<"login" | "register">("login");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (authDialogOpen && !dlg.open) {
      dlg.showModal();
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event("resize"));
      });
    } else if (!authDialogOpen && dlg.open) {
      dlg.close();
    }
  }, [authDialogOpen]);

  // Safari fallback for light-dismiss (`closedby="any"`)
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      closeAuthDialog();
    };
    const onClick = (e: MouseEvent) => {
      if ("closedBy" in HTMLDialogElement.prototype) return;
      if (e.target !== dlg) return;
      const rect = dlg.getBoundingClientRect();
      const inside =
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width;
      if (!inside) closeAuthDialog();
    };

    dlg.addEventListener("cancel", onCancel);
    dlg.addEventListener("click", onClick);
    return () => {
      dlg.removeEventListener("cancel", onCancel);
      dlg.removeEventListener("click", onClick);
    };
  }, [closeAuthDialog]);

  const validateRegistration = (): string | null => {
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      return pickText("Please enter a username", "لطفاً نام کاربری را وارد کنید");
    }
    if (trimmedUsername.length < 3) {
      return pickText("Username must be at least 3 characters", "نام کاربری باید حداقل ۳ کاراکتر باشد");
    }
    if (trimmedUsername.length > 32) {
      return pickText("Username must be at most 32 characters", "نام کاربری حداکثر ۳۲ کاراکتر است");
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmedUsername)) {
      return pickText(
        "Username may only contain letters, numbers, _, -, and .",
        "نام کاربری فقط می‌تواند شامل حروف انگلیسی، اعداد، زیرخط، خط تیره و نقطه باشد",
      );
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return pickText("Please enter your email", "لطفاً ایمیل خود را وارد کنید");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return pickText("Invalid email format", "فرمت ایمیل نامعتبر است");
    }

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      return pickText("Please enter your display name", "لطفاً نام نمایشی را وارد کنید");
    }
    if (trimmedName.length < 2) {
      return pickText("Display name must be at least 2 characters", "نام نمایشی باید حداقل ۲ کاراکتر باشد");
    }

    if (!password) {
      return pickText("Please enter a password", "لطفاً رمز عبور را وارد کنید");
    }
    if (password.length < 6) {
      return pickText("Password must be at least 6 characters", "رمز عبور باید حداقل ۶ کاراکتر باشد");
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "register") {
      const validationError = validateRegistration();
      if (validationError) {
        setError(validationError);
        return;
      }
    } else {
      if (!identifier.trim()) {
        setError(pickText("Username or email is required", "نام کاربری یا ایمیل الزامی است"));
        return;
      }
      if (!password) {
        setError(pickText("Password is required", "رمز عبور الزامی است"));
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === "login") {
        await login(identifier.trim(), password);
      } else {
        await register({
          username: username.trim(),
          email: email.trim().toLowerCase(),
          displayName: displayName.trim(),
          password,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : pickText("Authentication failed", "احراز هویت ناموفق بود"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: "any" } as Record<string, string>)}
      aria-labelledby="auth-dialog-title"
      className="sf-dialog"
      onClose={closeAuthDialog}
    >
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="auth-dialog-title" className="text-xl font-bold">
            {mode === "login" ? t("signIn") : pickText("Create Account", "ثبت‌نام")}
          </h2>
          <Button
            type="button"
            variant="glass"
            aria-label={t("close")}
            icon={<XIcon size={18} aria-hidden="true" />}
            onClick={closeAuthDialog}
          />
        </div>

        <GlassSegmented
          key={authDialogOpen ? "auth-open" : "auth-closed"}
          aria-label="Auth mode"
          fullWidth
          value={mode}
          onValueChange={(v) => {
            setError("");
            setMode(v as "login" | "register");
          }}
          items={[
            { value: "login", label: t("signIn") },
            { value: "register", label: pickText("Register", "ثبت‌نام") },
          ]}
        />

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {mode === "login" ? (
            <label className="block space-y-1 text-sm">
              <span className="block font-medium opacity-80">{t("usernameOrEmail")}</span>
              <Input
                autoFocus
                icon={<UserIcon size={18} aria-hidden="true" />}
                value={identifier}
                onValueChange={(v) => {
                  setIdentifier(v);
                  if (error) setError("");
                }}
                placeholder={pickText("username or email", "نام کاربری یا ایمیل")}
                autoComplete="username"
                required
              />
            </label>
          ) : (
            <>
              <label className="block space-y-1 text-sm">
                <span className="block font-medium opacity-80">{t("username")}</span>
                <Input
                  autoFocus
                  icon={<UserIcon size={18} aria-hidden="true" />}
                  value={username}
                  onValueChange={(v) => {
                    setUsername(v);
                    if (error) setError("");
                  }}
                  placeholder={pickText("e.g. arya_music", "مثلاً arya_music")}
                  autoComplete="username"
                  required
                />
                <span className="block text-[11px] text-[var(--sf-muted)]">
                  {pickText("Min 3 chars, alphanumeric, _, -, .", "حداقل ۳ کاراکتر، حروف انگلیسی و اعداد")}
                </span>
              </label>

              <label className="block space-y-1 text-sm">
                <span className="block font-medium opacity-80">{t("email")}</span>
                <Input
                  type="email"
                  icon={<EnvelopeSimpleIcon size={18} aria-hidden="true" />}
                  value={email}
                  onValueChange={(v) => {
                    setEmail(v);
                    if (error) setError("");
                  }}
                  placeholder="name@example.com"
                  autoComplete="email"
                  required
                />
              </label>

              <label className="block space-y-1 text-sm">
                <span className="block font-medium opacity-80">{t("displayName")}</span>
                <Input
                  icon={<SparkleIcon size={18} aria-hidden="true" />}
                  value={displayName}
                  onValueChange={(v) => {
                    setDisplayName(v);
                    if (error) setError("");
                  }}
                  placeholder={pickText("Arya", "آریا")}
                  autoComplete="name"
                  required
                />
              </label>
            </>
          )}

          <label className="block space-y-1 text-sm">
            <span className="block font-medium opacity-80">{t("password")}</span>
            <Input
              type="password"
              icon={<LockKeyIcon size={18} aria-hidden="true" />}
              value={password}
              onValueChange={(v) => {
                setPassword(v);
                if (error) setError("");
              }}
              placeholder={pickText("Enter password", "رمز عبور را وارد کنید")}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
            {mode === "register" && (
              <span className="block text-[11px] text-[var(--sf-muted)]">
                {pickText("At least 6 characters", "حداقل ۶ کاراکتر برای امنیت بیشتر")}
              </span>
            )}
          </label>

          {error && (
            <div
              role="alert"
              className="rounded-xl bg-rose-500/10 border border-rose-500/20 px-3.5 py-2.5 text-xs text-rose-600 dark:text-rose-400 font-medium"
            >
              {error}
            </div>
          )}

          <div className="pt-2">
            <Button
              type="submit"
              variant="filled"
              disabled={busy}
              className="w-full justify-center text-sm font-semibold py-2.5"
            >
              {busy ? (
                <span>{pickText("Processing...", "در حال پردازش...")}</span>
              ) : mode === "login" ? (
                t("signIn")
              ) : (
                pickText("Create Account", "ثبت‌نام و ایجاد حساب")
              )}
            </Button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
