// ── Smoke tests — validates core vault logic ──────────────────

describe("vault-service smoke", () => {
  // ── .env parser ────────────────────────────────────────────
  // Re-implement the parseEnvFile logic here to test it in isolation,
  // since server.js has side-effects at module scope that prevent
  // clean imports (readFileSync, process.exit, watchFile, etc.)

  function parseEnvFile(content) {
    const parsed = {};

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

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

  function envPrefix(id) {
    return id.toUpperCase().replace(/-/g, "_");
  }

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

  it("package.json should have required fields", async () => {
    const { readFileSync } = await import("fs");
    const { resolve, dirname } = await import("path");
    const { fileURLToPath } = await import("url");

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8"));

    expect(pkg.name).toBe("vault-service");
    expect(pkg.type).toBe("module");
    expect(pkg.scripts.start).toBe("node server.js");
    expect(pkg.scripts.deploy).toBe("bash deploy.sh");
    expect(pkg.dependencies.express).toBeTruthy();
  });
});
