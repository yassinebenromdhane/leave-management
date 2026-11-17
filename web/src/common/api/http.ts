// Response handling shared by every API hook: success bodies are typed from the hono client,
// failures become an ApiError carrying the server's i18n code and params.

/** Error carrying the server's i18n code (e.g. "auth.errors.invalidCredentials"). */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly params?: Record<string, unknown>,
    readonly body?: Record<string, unknown>,
  ) {
    super(code);
  }
}

/** The JSON body type of the 200/201 variants of a typed client response. */
export type OkBody<R> = R extends { status: 200 | 201; json(): Promise<infer T> } ? T : never;

export async function unwrap<R extends Response>(input: R | Promise<R>): Promise<OkBody<R>> {
  const res = await input;
  if (res.ok) return (await res.json()) as OkBody<R>;
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    // non-JSON error body
  }
  const code = typeof body.code === "string" ? body.code : "errors.generic";
  const params = body.params && typeof body.params === "object" ? (body.params as Record<string, unknown>) : undefined;
  throw new ApiError(code, res.status, params, body);
}

export const errorCode = (err: unknown): string => (err instanceof ApiError ? err.code : "errors.generic");

/** Same as unwrap, for callers that state the body type themselves (session hooks). */
export const unwrapAs = <T,>(res: Response): Promise<T> => unwrap(res) as unknown as Promise<T>;
