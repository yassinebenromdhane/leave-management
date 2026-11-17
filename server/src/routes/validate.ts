// zValidator with the API's error shape: 400 { code: "errors.validation", params: { issues } },
// where each issue message is an i18n key from the shared schema.
import { zValidator } from "@hono/zod-validator";
import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";

export const validate = <T extends keyof ValidationTargets, S extends ZodType>(target: T, schema: S) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      return c.json({ code: "errors.validation", params: { issues } }, 400);
    }
  });
