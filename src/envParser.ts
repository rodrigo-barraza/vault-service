// ─── Env Prefix Utility ──────────────────────────────────────

/**
 * Derive the env var prefix from a service ID.
 * E.g. "prism-service" → "PRISM_SERVICE", "lupos-bot" → "LUPOS_BOT"
 */
export function envPrefix(id: string): string {
  return id.toUpperCase().replace(/-/g, "_");
}
