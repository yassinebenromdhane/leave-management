// Maps any thrown error to a translated sentence. Server errors carry `{ code, params? }`; 400
// validation errors carry Zod issue messages that are themselves i18n keys.
import i18n from "i18next";
import type { TFunction } from "i18next";
import { ApiError } from "@/common/api/http";
import { issueMessage, type IssueLike } from "./issueMessage";

export function errorMessage(t: TFunction, err: unknown): string {
  if (!(err instanceof ApiError)) return t("errors.generic");

  if (err.code === "errors.validation") {
    const issues = (err.params?.issues ?? []) as Array<{ path: string; message: string }>;
    const known = [...new Set(issues.map((i) => i.message).filter((m) => i18n.exists(m)))];
    return known.length > 0 ? known.map((m) => t(m)).join(" ") : t("errors.validation");
  }

  if (err.code === "leave.errors.blocked") {
    const conflicts = err.body?.conflicts as { blocking?: IssueLike[] } | undefined;
    const first = conflicts?.blocking?.[0];
    return first ? `${t("leave.errors.blocked")} ${issueMessage(t, first, i18n.language)}` : t("leave.errors.blocked");
  }

  return i18n.exists(err.code) ? t(err.code, (err.params ?? {}) as Record<string, string>) : t("errors.generic");
}
