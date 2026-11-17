// Auth payloads shared by the login screens and the server (spec 2.5).
// Error messages are i18n keys.
import { z } from "zod";

/** Spec 2.5: minimum 8 characters, no composition or rotation rules. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { message: "auth.errors.passwordTooShort" })
  .max(PASSWORD_MAX_LENGTH, { message: "auth.errors.passwordTooLong" });

/** Login accepts an email address or, for accounts without email, an employee code. */
export const signInSchema = z.object({
  identifier: z.string().trim().min(1, { message: "auth.errors.identifierRequired" }).max(254),
  password: z.string().min(1, { message: "auth.errors.passwordRequired" }).max(PASSWORD_MAX_LENGTH),
  rememberMe: z.boolean().default(false),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, { message: "auth.errors.passwordRequired" }).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(256),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: "auth.errors.emailInvalid" }),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** Returned by GET /api/session/me. */
export const sessionUserSchema = z
  .object({
    userId: z.string(),
    role: z.enum(["operator", "employee"]),
    name: z.string(),
    employeeId: z.string().nullable(),
    mustChangePassword: z.boolean(),
  })
  .strict();
export type SessionUser = z.infer<typeof sessionUserSchema>;

/** Stable error codes returned by auth routes. */
export const AUTH_ERRORS = {
  invalidCredentials: "auth.errors.invalidCredentials",
  unauthenticated: "auth.errors.unauthenticated",
  forbidden: "auth.errors.forbidden",
  mustChangePassword: "auth.errors.mustChangePassword",
  commonPassword: "auth.errors.commonPassword",
  currentPasswordWrong: "auth.errors.currentPasswordWrong",
  invalidToken: "auth.errors.invalidToken",
} as const;
