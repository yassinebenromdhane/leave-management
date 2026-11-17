import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests run against a real PostgreSQL, in a separate database named
// "<your database>_test" on the same server, so development data is never touched.
const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const devUrl = new URL(process.env.DATABASE_URL ?? "postgres://leave:leave@127.0.0.1:5432/leave");
const testUrl = new URL(devUrl);
testUrl.pathname = `${devUrl.pathname.replace(/^\//, "").replace(/_test$/, "")}_test`;

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      TZ: "UTC",
      DATABASE_URL: testUrl.toString(),
      APP_URL: "http://localhost:5173",
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
      SMTP_HOST: "",
      OPERATOR_EMAIL: "",
      OPERATOR_INITIAL_PASSWORD: "",
      // Attachments written by tests never land in the real uploads volume.
      UPLOAD_DIR: join(tmpdir(), "leave-app-test-uploads"),
    },
    globalSetup: ["./test/globalSetup.ts"],
    fileParallelism: false, // one shared test database
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
