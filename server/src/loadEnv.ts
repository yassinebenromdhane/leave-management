import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Loads the repo-root .env in development (Node's built-in loader, no dotenv).
 * In Docker the variables come from compose's env_file, and no file is read.
 */
export function loadRootEnv(): void {
  const candidates = [
    new URL("../../.env", import.meta.url), // server/src → repo root
    new URL("../.env", import.meta.url),
  ];
  for (const url of candidates) {
    const path = fileURLToPath(url);
    if (existsSync(path)) {
      process.loadEnvFile(path);
      return;
    }
  }
}
