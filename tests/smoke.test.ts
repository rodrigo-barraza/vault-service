// ── Smoke tests — validates core vault logic ──────────────────

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { parseEnvFile, envPrefix } from "../src/envParser.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("vault-service smoke", () => {
  // ── parseEnvFile ─────────────────────────────────────────────

  it("should parse simple KEY=VALUE pairs", () => {
    const result = parseEnvFile("FOO=bar\nBAZ=qux");
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("should strip double-quoted values", () => {
    const result = parseEnvFile('API_KEY="my-secret-key"');
    expect(result).toEqual({ API_KEY: "my-secret-key" });
  });

  it("should strip single-quoted values", () => {
    const result = parseEnvFile("API_KEY='my-secret-key'");
    expect(result).toEqual({ API_KEY: "my-secret-key" });
  });

  it("should skip comments and blank lines", () => {
    const env = `
# This is a comment
FOO=bar

# Another comment
BAZ=qux
`;
    const result = parseEnvFile(env);
    expect(result).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("should handle values containing = signs", () => {
    const result = parseEnvFile("CONN=mongodb://host:27017/db?auth=true");
    expect(result).toEqual({ CONN: "mongodb://host:27017/db?auth=true" });
  });

  it("should handle empty values", () => {
    const result = parseEnvFile("EMPTY=\nALSO_EMPTY=");
    expect(result).toEqual({ EMPTY: "", ALSO_EMPTY: "" });
  });

  it("should return empty object for empty input", () => {
    expect(parseEnvFile("")).toEqual({});
    expect(parseEnvFile("\n\n\n")).toEqual({});
  });

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
    expect(pkg.scripts.start).toBe("node dist/server.js");
    expect(pkg.scripts.deploy).toBe("bash deploy.sh");
    expect(pkg.dependencies.express).toBeTruthy();
  });
});
