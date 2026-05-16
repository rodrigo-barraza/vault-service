// ─── Vault — Centralized Secrets Server + Project Registry ───

import express from "express";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createLogger } from "@rodrigo-barraza/utilities-library/node";
import { createSecretsStore, loadBearerToken } from "./secretsStore.ts";
import { createRegistryStore } from "./registryStore.ts";
import { createAuthMiddleware } from "./authMiddleware.ts";
import { mountRoutes } from "./routes.ts";

const logger = createLogger("vault");
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────
const ENV_FILE_PATH = existsSync(resolve(__dirname, "../env/.env"))
  ? resolve(__dirname, "../env/.env")
  : resolve(__dirname, "../.env");

const KEY_FILE_PATH = existsSync(resolve(__dirname, "../env/vault.key"))
  ? resolve(__dirname, "../env/vault.key")
  : resolve(__dirname, "../vault.key");

const PROJECTS_FILE_PATH = resolve(__dirname, "../projects.json");
const PORT = parseInt(process.env.VAULT_SERVICE_PORT || "5599", 10);
const RELOAD_INTERVAL_MS = 5_000;

// ── Bootstrap ──────────────────────────────────────────────────
const bearerToken = loadBearerToken(KEY_FILE_PATH);

const secretsStore = createSecretsStore({
  envFilePath: ENV_FILE_PATH,
  reloadIntervalMs: RELOAD_INTERVAL_MS,
});

const registryStore = createRegistryStore({
  filePath: PROJECTS_FILE_PATH,
  reloadIntervalMs: RELOAD_INTERVAL_MS,
});

// Start file watchers
secretsStore.startWatching();
registryStore.startWatching();

// ── Express App ────────────────────────────────────────────────
const app = express();
const requireAuth = createAuthMiddleware(() => bearerToken);

mountRoutes({
  router: app,
  secretsStore,
  registryStore,
  requireAuth,
});

// ── Start Server ───────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  const reg = registryStore.registry;
  logger.info("");
  logger.info("╔══════════════════════════════════════════════════════════╗");
  logger.info("║                                                          ║");
  logger.info(`║  🔐  Vault listening on port ${String(PORT).padEnd(28)}║`);
  logger.info(`║  📄  Serving ${String(Object.keys(secretsStore.secrets).length).padEnd(3)} secrets from master .env             ║`);
  logger.info(`║  📋  Registry: ${String((reg.projects || []).length).padEnd(3)} projects, ${String((reg.infrastructure || []).length).padEnd(1)} infrastructure, ${String((reg.devices || []).length).padEnd(1)} devices  ║`);
  logger.info("║  🔑  Bearer token loaded from vault.key                  ║");
  logger.info("║  👁️   Watching .env + projects.json for live changes      ║");
  logger.info("║                                                          ║");
  logger.info("╚══════════════════════════════════════════════════════════╝");
  logger.info("");
});
