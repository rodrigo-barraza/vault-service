// ============================================================
// Vault — Centralized Secrets Server
// ============================================================
// Reads the master .env file and serves secrets over HTTP.
// Services on the LAN fetch their config at boot time.
//
// Auth: Bearer token from vault.key file.
// Fallback: Services can read the .env file directly if Vault
//           is unreachable.
//
// Usage:
//   npm run dev          (hot reload via --watch)
//   npm start            (production)
//   npm run generate-key (create a new vault.key)
// ============================================================

import express from "express";
import { readFileSync, watchFile, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ──────────────────────────────────────────────
// Container mount: ./env/.env + ./env/vault.key  (Docker)
// Local fallback:  ../.env    + ./vault.key      (development)
const ENV_FILE_PATH = existsSync(resolve(__dirname, "env/.env"))
  ? resolve(__dirname, "env/.env")
  : resolve(__dirname, "../.env");

const KEY_FILE_PATH = existsSync(resolve(__dirname, "env/vault.key"))
  ? resolve(__dirname, "env/vault.key")
  : resolve(__dirname, "vault.key");

const PORT = parseInt(process.env.VAULT_PORT || "5599", 10);
const RELOAD_INTERVAL_MS = 5_000;

// ── Load Bearer Token ──────────────────────────────────────────
let BEARER_TOKEN = "";

function loadBearerToken() {
  if (existsSync(KEY_FILE_PATH)) {
    BEARER_TOKEN = readFileSync(KEY_FILE_PATH, "utf-8").trim();
  }

  if (!BEARER_TOKEN) {
    console.error("╔══════════════════════════════════════════════════════════╗");
    console.error("║  ❌  vault.key not found or empty.                      ║");
    console.error("║                                                          ║");
    console.error("║  Generate one with:                                      ║");
    console.error("║    npm run generate-key > vault.key                      ║");
    console.error("║                                                          ║");
    console.error("║  The vault.key file is gitignored.                       ║");
    console.error("╚══════════════════════════════════════════════════════════╝");
    process.exit(1);
  }
}

loadBearerToken();

// ── Parse .env ─────────────────────────────────────────────────
let secrets = {};
let lastLoadedAt = null;

/**
 * Parse a .env file into a key-value object.
 * Supports quoted values, comments, blank lines, and inline comments.
 */
function parseEnvFile(content) {
  const parsed = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function loadSecrets() {
  try {
    const content = readFileSync(ENV_FILE_PATH, "utf-8");
    const parsed = parseEnvFile(content);

    // Never expose the vault's own bearer token
    delete parsed.VAULT_TOKEN;

    secrets = parsed;
    lastLoadedAt = new Date().toISOString();

    console.log(`✅ Loaded ${Object.keys(secrets).length} secrets from .env`);
  } catch (err) {
    console.error(`❌ Failed to load .env: ${err.message}`);
  }
}

loadSecrets();

// Watch for file changes and auto-reload
watchFile(ENV_FILE_PATH, { interval: RELOAD_INTERVAL_MS }, () => {
  console.log("🔄 .env changed — reloading secrets");
  loadSecrets();
});

// ── Express App ────────────────────────────────────────────────
const app = express();

// ── Auth Middleware ────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }

  if (header.slice(7) !== BEARER_TOKEN) {
    return res.status(403).json({ error: "Invalid bearer token" });
  }

  next();
}

// ── Routes ─────────────────────────────────────────────────────

/**
 * GET /health
 * Public — no auth required.
 */
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "vault",
    secretCount: Object.keys(secrets).length,
    lastLoadedAt,
    uptime: Math.floor(process.uptime()),
  });
});

/**
 * GET /secrets
 *
 * Query params (all optional, combinable):
 *   ?keys=KEY1,KEY2      — return only these specific keys
 *   ?prefix=PRISM_       — return keys starting with this prefix
 *   ?exclude=VAULT_,CI_  — exclude keys matching these prefixes
 *
 * Returns: JSON object of { KEY: "value" } pairs.
 */
app.get("/secrets", requireAuth, (req, res) => {
  const { keys, prefix, exclude } = req.query;

  let result = { ...secrets };

  // Filter by specific keys
  if (keys) {
    const keyList = keys.split(",").map((k) => k.trim());
    const filtered = {};

    for (const key of keyList) {
      if (result[key] !== undefined) {
        filtered[key] = result[key];
      }
    }

    result = filtered;
  }

  // Filter by prefix
  if (prefix) {
    const prefixes = prefix.split(",").map((p) => p.trim());
    const filtered = {};

    for (const [key, value] of Object.entries(result)) {
      if (prefixes.some((p) => key.startsWith(p))) {
        filtered[key] = value;
      }
    }

    result = filtered;
  }

  // Exclude by prefix
  if (exclude) {
    const excludePrefixes = exclude.split(",").map((p) => p.trim());

    for (const key of Object.keys(result)) {
      if (excludePrefixes.some((p) => key.startsWith(p))) {
        delete result[key];
      }
    }
  }

  res.json(result);
});

/**
 * POST /reload
 * Force-reload the .env file without waiting for the watcher.
 */
app.post("/reload", requireAuth, (_req, res) => {
  loadSecrets();
  res.json({
    status: "reloaded",
    secretCount: Object.keys(secrets).length,
    lastLoadedAt,
  });
});

/**
 * GET /keys
 * Returns the list of available secret key names (not values).
 * Useful for debugging and client bootstrapping.
 */
app.get("/keys", requireAuth, (_req, res) => {
  res.json(Object.keys(secrets));
});

// ── Start Server ───────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║                                                          ║");
  console.log(`║  🔐  Vault listening on port ${String(PORT).padEnd(28)}║`);
  console.log(`║  📄  Serving ${String(Object.keys(secrets).length).padEnd(3)} secrets from master .env             ║`);
  console.log("║  🔑  Bearer token loaded from vault.key                  ║");
  console.log("║  👁️   Watching .env for live changes                      ║");
  console.log("║                                                          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("");
});
