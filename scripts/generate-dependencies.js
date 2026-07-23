#!/usr/bin/env node
// ============================================================
// Dependency Generator — code-derived dependsOn edges
//
// Scans every registry project's repo (package.json + src/**) and
// writes dependencies.generated.json next to projects.json. The
// registry store merges this file into /registry at load time, so
// dependsOn is never hand-declared in projects.json.
//
// Detection per project:
//   • package.json deps:  @rodrigo-barraza/<id> or bare <id>
//   • src/** references:  the candidate's id, its ENV prefix
//     (PRISM_SERVICE_…), or its public domain (api.prism.rod.dev)
//   • vault-service is forced for every non-library project — env
//     bootstrap makes it a universal dependency.
//
// Criticality (also code-derived, no hand tuning):
//   • libraries                          → required
//   • <stem>-service for a <stem>-client → required (primary backend)
//   • vault-service for services/bots    → required (boot fails without it)
//   • everything else                    → optional
//
// Usage: node scripts/generate-dependencies.js [--check]
//   --check  exit 1 if the file on disk is stale (CI/deploy guard)
// ============================================================
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../..");
const VAULT_DIR = path.resolve(__dirname, "..");
const PROJECTS_JSON = path.join(VAULT_DIR, "projects.json");
const OUTPUT_JSON = path.join(VAULT_DIR, "dependencies.generated.json");

const isCheckMode = process.argv.includes("--check");

const registry = JSON.parse(fs.readFileSync(PROJECTS_JSON, "utf8"));
const projects = registry.projects || [];
const infrastructure = registry.infrastructure || [];

const envPrefix = (id) => id.toUpperCase().replace(/-/g, "_");

// Candidates a repo can reference: every project and infrastructure entry.
// mongodb/minio are intentionally excluded — consumers derive those edges
// from the registry's own `db` / `minioBucket` fields.
// A domain that is the parent zone of other projects' domains (e.g. the
// rod.dev apex under api.prism.rod.dev) matches far too broadly — footer
// links and email addresses would become dependencies. Only unambiguous
// domains participate in matching.
const allDomains = [...projects, ...infrastructure]
  .map((entry) => entry.domain)
  .filter(Boolean);
const isSharedApex = (domain) =>
  allDomains.some((other) => other !== domain && other.endsWith(`.${domain}`));

const candidates = [...projects, ...infrastructure]
  .filter((entry) => !["mongodb", "minio"].includes(entry.id))
  .map((entry) => ({
    id: entry.id,
    // Match "<id>" as a whole token, "<ENV_PREFIX>_" env keys, or the
    // public domain (left-anchored so "rod.dev" never matches inside
    // "api.prism.rod.dev").
    patterns: [
      new RegExp(`(?<![\\w-])${entry.id}(?![\\w-])`),
      new RegExp(`\\b${envPrefix(entry.id)}_`),
      ...(entry.domain && !isSharedApex(entry.domain)
        ? [new RegExp(`(?<![\\w.-])${entry.domain.replace(/\./g, "\\.")}`)]
        : []),
    ],
  }));

// Files that intentionally enumerate every service (registry mirrors,
// port taxonomies) — matching against them would make their repo depend
// on the entire fleet.
const IGNORED_FILES = [/taxonomy[/\\]/];

// Drop line + block comments so prose mentions of a service id don't
// count as dependencies. Cheap approximation — string literals containing
// "//" survive because we only strip when the line starts with the marker
// or after whitespace.
function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const projectById = new Map(projects.map((p) => [p.id, p]));

function collectSourceFiles(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === ".next") continue;
      collectSourceFiles(fullPath, out);
    } else if (/\.(tsx?|jsx?|mjs|cjs|json)$/.test(name) && !name.includes(".test.")) {
      out.push(fullPath);
    }
  }
}

function criticalityFor(project, depId) {
  const dep = projectById.get(depId);
  if (dep?.projectType === "Library") return "required";
  const clientStem = project.id.match(/^(.*)-client$/)?.[1];
  if (clientStem && depId === `${clientStem}-service`) return "required";
  if (depId === "vault-service" && /-(service|bot)$/.test(project.id)) {
    return "required";
  }
  return "optional";
}

function detectDependencies(project) {
  const projDir = path.join(ROOT_DIR, project.id);
  const pkgPath = path.join(projDir, "package.json");
  if (!fs.existsSync(pkgPath)) return null; // no local repo — nothing to scan

  const detected = new Set();

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  for (const depName of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
    const bare = depName.replace(/^@rodrigo-barraza\//, "");
    if (projectById.has(bare) && bare !== project.id) detected.add(bare);
  }

  const srcDir = path.join(projDir, "src");
  if (fs.existsSync(srcDir)) {
    const files = [];
    collectSourceFiles(srcDir, files);
    const remaining = candidates.filter((c) => c.id !== project.id && !detected.has(c.id));
    for (const file of files) {
      if (!remaining.length) break;
      if (IGNORED_FILES.some((re) => re.test(file))) continue;
      const raw = fs.readFileSync(file, "utf8");
      const content = file.endsWith(".json") ? raw : stripComments(raw);
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (remaining[i].patterns.some((re) => re.test(content))) {
          detected.add(remaining[i].id);
          remaining.splice(i, 1);
        }
      }
    }
  }

  if (project.id !== "vault-service" && project.projectType !== "Library") {
    detected.add("vault-service");
  }

  return [...detected]
    .sort()
    .map((id) => ({ id, criticality: criticalityFor(project, id) }));
}

const dependencies = {};
let scanned = 0;
for (const project of projects) {
  const deps = detectDependencies(project);
  if (deps === null) {
    console.log(`  – ${project.id}: no local repo, skipped`);
    dependencies[project.id] = [];
    continue;
  }
  scanned++;
  dependencies[project.id] = deps;
  console.log(`  ✔ ${project.id}: ${deps.map((d) => d.id).join(", ") || "(none)"}`);
}

const output = `${JSON.stringify({ generatedAt: new Date().toISOString(), dependencies }, null, 2)}\n`;

// Compare ignoring the timestamp so --check and no-op runs are stable.
const stripTimestamp = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    delete parsed.generatedAt;
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
};
const existing = fs.existsSync(OUTPUT_JSON) ? fs.readFileSync(OUTPUT_JSON, "utf8") : null;
const unchanged = existing !== null && stripTimestamp(existing) === stripTimestamp(output);

if (isCheckMode) {
  if (unchanged) {
    console.log(`\n✔ dependencies.generated.json is up to date (${scanned} repos scanned)`);
    process.exit(0);
  }
  console.error("\n✖ dependencies.generated.json is stale — run: npm run generate:deps");
  process.exit(1);
}

if (unchanged) {
  console.log(`\n✔ No dependency changes (${scanned} repos scanned)`);
} else {
  fs.writeFileSync(OUTPUT_JSON, output, "utf8");
  console.log(`\n✔ Wrote ${path.relative(process.cwd(), OUTPUT_JSON)} (${scanned} repos scanned)`);
}
