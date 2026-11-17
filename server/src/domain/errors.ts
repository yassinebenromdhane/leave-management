// Business errors carry an i18n key and the HTTP status the route returns.
// app.onError turns them into `{ code, params? }` JSON (plus any extra body fields).
export type DomainStatus = 400 | 403 | 404 | 409 | 413 | 415 | 422;

export class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly status: DomainStatus,
    readonly params?: Record<string, unknown>,
    readonly extra?: Record<string, unknown>,
  ) {
    super(code);
  }
}

export const notFound = () => new DomainError("errors.notFound", 404);

/** PostgreSQL error code and constraint name, unwrapping Drizzle's DrizzleQueryError. */
export function pgError(err: unknown): { code: string; constraint: string | undefined } | null {
  let cur: unknown = err;
  for (let i = 0; i < 3 && cur && typeof cur === "object"; i++) {
    const e = cur as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) {
      return { code: e.code, constraint: typeof e.constraint_name === "string" ? e.constraint_name : undefined };
    }
    cur = e.cause;
  }
  return null;
}

export const isUniqueViolation = (err: unknown, constraint?: string): boolean => {
  const pg = pgError(err);
  return pg?.code === "23505" && (constraint === undefined || pg.constraint === constraint);
};

export const isForeignKeyViolation = (err: unknown): boolean => pgError(err)?.code === "23503";
