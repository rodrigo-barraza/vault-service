// ─── Bearer Token Loader ─────────────────────────────────────

import { readFileSync, existsSync } from "fs";
import { createLogger } from "@rodrigo-barraza/utilities-library/node";

export function loadBearerToken(keyFilePath: string): string {
  let token = "";

  if (existsSync(keyFilePath)) {
    token = readFileSync(keyFilePath, "utf-8").trim();
  }

  if (!token) {
    const logError = createLogger("vault:auth");
    logError.error(
      "╔══════════════════════════════════════════════════════════╗",
    );
    logError.error(
      "║  ❌  vault.key not found or empty.                      ║",
    );
    logError.error(
      "║                                                          ║",
    );
    logError.error(
      "║  Generate one with:                                      ║",
    );
    logError.error(
      "║    npm run generate-key > vault.key                      ║",
    );
    logError.error(
      "║                                                          ║",
    );
    logError.error(
      "║  The vault.key file is gitignored.                       ║",
    );
    logError.error(
      "╚══════════════════════════════════════════════════════════╝",
    );
    process.exit(1);
  }

  return token;
}
