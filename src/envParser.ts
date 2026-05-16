// ─── .env File Parser ────────────────────────────────────────

import type { SecretsMap } from "./types.ts";

/**
 * Parse a .env file contents into a key-value object.
 * Supports quoted values, comments, blank lines, and values
 * containing `=` signs (e.g. connection strings).
 */
export function parseEnvFile(content: string): SecretsMap {
  const parsed: SecretsMap = {};

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

/**
 * Derive the env var prefix from a service ID.
 * E.g. "prism-service" → "PRISM_SERVICE", "lupos-bot" → "LUPOS_BOT"
 */
export function envPrefix(id: string): string {
  return id.toUpperCase().replace(/-/g, "_");
}
