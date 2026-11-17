// Minimal cookie-jar client over app.request() for integration tests.
import app from "../src/app";

export const ORIGIN = "http://localhost:5173";

export class TestClient {
  private cookies = new Map<string, string>();

  async request(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { origin: ORIGIN };
    const isForm = body instanceof FormData;
    if (body !== undefined && !isForm) headers["content-type"] = "application/json";
    const cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    if (cookie) headers.cookie = cookie;
    const res = await app.request(path, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(";");
      const eq = pair!.indexOf("=");
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim())) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  get = (path: string) => this.request("GET", path);
  post = (path: string, body?: unknown) => this.request("POST", path, body ?? {});
  put = (path: string, body?: unknown) => this.request("PUT", path, body ?? {});
  patch = (path: string, body?: unknown) => this.request("PATCH", path, body ?? {});
  del = (path: string) => this.request("DELETE", path);
  upload = (path: string, form: FormData) => this.request("POST", path, form);

  signIn(identifier: string, password: string, rememberMe = false) {
    return this.post("/api/session/sign-in", { identifier, password, rememberMe });
  }

  cookieNames(): string[] {
    return [...this.cookies.keys()];
  }
}
