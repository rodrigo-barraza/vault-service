// ─── Secrets Store — In-Memory .env Secret Manager ───────────

import { readFileSync, existsSync, watchFile } from "fs";
import { createLogger } from "@rodrigo-barraza/utilities-library/node";
import { parseEnvFile } from "./envParser.ts";
import type { SecretsMap } from "./types.ts";

const logger = createLogger("vault:secrets");

export interface SecretsStoreOptions {
  envFilePath: string;
  reloadIntervalMs: number;
}

export interface SecretsStore {
  /** Current secrets map (excludes VAULT_SERVICE_TOKEN) */
  readonly secrets: SecretsMap;
  /** ISO timestamp of the last successful load */
  readonly lastLoadedAt: string | null;
  /** Force-reload from disk */
  reload(): void;
  /** Start watching the file for changes */
  startWatching(): void;
}

export function createSecretsStore(options: SecretsStoreOptions): SecretsStore {
  const { envFilePath, reloadIntervalMs } = options;

  let secrets: SecretsMap = {};
  let lastLoadedAt: string | null = null;

  function reload(): void {
    try {
      const content = readFileSync(envFilePath, "utf-8");
      const parsed = parseEnvFile(content);

      // Never expose the vault's own bearer token
      delete parsed.VAULT_SERVICE_TOKEN;

      secrets = parsed;
      lastLoadedAt = new Date().toISOString();

      logger.success(`Loaded ${Object.keys(secrets).length} secrets from .env`);
    } catch (error) {
      logger.error(
        `Failed to load .env: ${(error as Error).message}`,
      );
    }
  }

  function startWatching(): void {
    watchFile(envFilePath, { interval: reloadIntervalMs }, () => {
      logger.info(".env changed — reloading secrets");
      reload();
    });
  }

  // Initial load
  reload();

  return {
    get secrets() {
      return secrets;
    },
    get lastLoadedAt() {
      return lastLoadedAt;
    },
    reload,
    startWatching,
  };
}

// ── Bearer Token Loader ───────────────────────────────────────

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
