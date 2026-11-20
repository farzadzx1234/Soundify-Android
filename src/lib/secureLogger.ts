/**
 * Frontend & Android Log Sanitizer & Anti-Leakage Guard
 *
 * Automatically redacts sensitive tokens, passwords, private keys,
 * and authorization headers before they can be printed to the
 * developer console or Android system logcat.
 */

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Bearer JWT tokens
  {
    pattern: /Bearer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/gi,
    replacement: "Bearer [REDACTED_JWT]",
  },
  // JWT tokens standalone
  {
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replacement: "[REDACTED_JWT]",
  },
  // Passwords in JSON
  {
    pattern: /("password"\s*:\s*)"([^"]+)"/gi,
    replacement: '$1"[REDACTED_PASSWORD]"',
  },
  {
    pattern: /("currentPassword"\s*:\s*)"([^"]+)"/gi,
    replacement: '$1"[REDACTED_PASSWORD]"',
  },
  {
    pattern: /("newPassword"\s*:\s*)"([^"]+)"/gi,
    replacement: '$1"[REDACTED_PASSWORD]"',
  },
  // Private keys and secrets
  {
    pattern: /("privateKey"\s*:\s*)"([^"]+)"/gi,
    replacement: '$1"[REDACTED_KEY]"',
  },
  {
    pattern: /("serverNonce"\s*:\s*)"([^"]+)"/gi,
    replacement: '$1"[REDACTED_NONCE]"',
  },
  {
    pattern: /("clientNonce"\s*:\s*)"([^"]+)"/gi,
    replacement: '$1"[REDACTED_NONCE]"',
  },
];

export function sanitizeLogMessage(message: unknown): string {
  if (message === null || message === undefined) return String(message);

  let str: string;
  if (typeof message === "string") {
    str = message;
  } else if (typeof message === "object") {
    try {
      str = JSON.stringify(message);
    } catch {
      str = String(message);
    }
  } else {
    str = String(message);
  }

  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    str = str.replace(pattern, replacement);
  }

  return str;
}

let isSanitizerInstalled = false;

/**
 * Intercepts console logging in Android/Production to prevent logcat credential leaks.
 */
export function installLogSanitizer(): void {
  if (isSanitizerInstalled || typeof window === "undefined" || !window.console) return;
  isSanitizerInstalled = true;

  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args: unknown[]) => originalLog(...args.map(sanitizeLogMessage));
  console.info = (...args: unknown[]) => originalInfo(...args.map(sanitizeLogMessage));
  console.warn = (...args: unknown[]) => originalWarn(...args.map(sanitizeLogMessage));
  console.error = (...args: unknown[]) => originalError(...args.map(sanitizeLogMessage));
}

export const secureLog = {
  info(...args: unknown[]): void {
    const sanitized = args.map(sanitizeLogMessage);
    console.info(...sanitized);
  },
  warn(...args: unknown[]): void {
    const sanitized = args.map(sanitizeLogMessage);
    console.warn(...sanitized);
  },
  error(...args: unknown[]): void {
    const sanitized = args.map(sanitizeLogMessage);
    console.error(...sanitized);
  },
  debug(...args: unknown[]): void {
    if (process.env.NODE_ENV !== "production") {
      const sanitized = args.map(sanitizeLogMessage);
      console.debug(...sanitized);
    }
  },
};
