// ── Smoke tests — validates core vault logic ──────────────────

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { envPrefix } from "../src/envParser.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("vault-service smoke", () => {
  // ── envPrefix ────────────────────────────────────────────────

  it("should convert service IDs to env var prefixes", () => {
    expect(envPrefix("prism-service")).toBe("PRISM_SERVICE");
    expect(envPrefix("lupos-bot")).toBe("LUPOS_BOT");
    expect(envPrefix("vault-service")).toBe("VAULT_SERVICE");
    expect(envPrefix("clock-crew-service")).toBe("CLOCK_CREW_SERVICE");
  });

  // ── Package structure ────────────────────────────────────────

  it("package.json should have required fields", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, "../package.json"), "utf-8"),
    );

    expect(pkg.name).toBe("vault-service");
    expect(pkg.type).toBe("module");
    expect(pkg.scripts.start).toBe("node src/server.ts");
    expect(pkg.scripts.deploy).toBe("bash deploy.sh");
    expect(pkg.dependencies.express).toBeTruthy();
  });
});
