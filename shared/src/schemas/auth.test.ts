import { describe, expect, it } from "vitest";
import { changePasswordSchema, forgotPasswordSchema, signInSchema } from "./auth";

describe("auth schemas", () => {
  it("rejects new passwords shorter than 8 characters with an i18n key", () => {
    const r = changePasswordSchema.safeParse({ currentPassword: "x", newPassword: "short7!" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe("auth.errors.passwordTooShort");
  });

  it("accepts an 8-character password with no composition rules", () => {
    expect(changePasswordSchema.safeParse({ currentPassword: "x", newPassword: "abcdefgh" }).success).toBe(true);
  });

  it("defaults rememberMe to false and trims the identifier", () => {
    const r = signInSchema.parse({ identifier: "  EMP-001 ", password: "p" });
    expect(r).toEqual({ identifier: "EMP-001", password: "p", rememberMe: false });
  });

  it("normalises the forgot-password email", () => {
    expect(forgotPasswordSchema.parse({ email: " Ines@Example.COM " }).email).toBe("ines@example.com");
  });
});
