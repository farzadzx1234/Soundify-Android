import { describe, expect, it } from "vitest";

describe("Client-side Registration Validation Logic", () => {
  const usernameRegex = /^[a-zA-Z0-9_.-]+$/;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  it("validates username rules strictly", () => {
    // Valid usernames
    expect(usernameRegex.test("parsa")).toBe(true);
    expect(usernameRegex.test("arya_music")).toBe(true);
    expect(usernameRegex.test("user-123.test")).toBe(true);

    // Invalid usernames
    expect(usernameRegex.test("parsa music")).toBe(false); // contains space
    expect(usernameRegex.test("user@name")).toBe(false); // contains @
    expect(usernameRegex.test("علی")).toBe(false); // non-latin in username
    expect(usernameRegex.test("user#1")).toBe(false); // invalid symbol
  });

  it("validates email patterns properly", () => {
    // Valid emails
    expect(emailRegex.test("user@soundify.ir")).toBe(true);
    expect(emailRegex.test("test.person@domain.com")).toBe(true);
    expect(emailRegex.test("a+b@c.org")).toBe(true);

    // Invalid emails
    expect(emailRegex.test("not-an-email")).toBe(false);
    expect(emailRegex.test("missing-domain@")).toBe(false);
    expect(emailRegex.test("@missing-user.com")).toBe(false);
    expect(emailRegex.test("spaces in@email.com")).toBe(false);
  });

  it("enforces password length boundary of at least 6 characters", () => {
    const isPasswordValid = (p: string) => Boolean(p && p.length >= 6);
    expect(isPasswordValid("")).toBe(false);
    expect(isPasswordValid("12345")).toBe(false);
    expect(isPasswordValid("123456")).toBe(true);
    expect(isPasswordValid("SuperSecurePassword2026!")).toBe(true);
  });
});
