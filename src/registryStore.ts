// ─── Registry Store — Project Manifest Manager ──────────────

import { readFileSync, watchFile } from "fs";
import { createLogger } from "@rodrigo-barraza/utilities-library/node";
import { envPrefix } from "./envParser.ts";
import type {
  Registry,
  RegistryProject,
  RegistryInfrastructure,
  SecretsMap,
} from "./types.ts";

const logger = createLogger("vault:registry");

export interface RegistryStoreOptions {
  filePath: string;
  reloadIntervalMs: number;
}

export interface RegistryStore {
  /** Current registry data */
  readonly registry: Registry;
  /** ISO timestamp of last successful load */
  readonly loadedAt: string | null;
  /** Force-reload from disk */
  reload(): void;
  /** Start watching the file for changes */
  startWatching(): void;
  /** Resolve the effective default host */
  resolveDefaultHost(): string;
  /** Enrich a service entry with its resolved URL */
  enrichService(service: RegistryProject, secrets: SecretsMap): RegistryProject;
  /** Enrich an infrastructure entry with its display URL */
  enrichInfrastructure(infra: RegistryInfrastructure): RegistryInfrastructure;
  /** Derive env-var-shaped fallbacks from the registry */
  deriveRegistrySecrets(secrets: SecretsMap): SecretsMap;
}

const EMPTY_REGISTRY: Registry = {
  version: 0,
  projects: [],
  infrastructure: [],
  devices: [],
};

export function createRegistryStore(
  options: RegistryStoreOptions,
): RegistryStore {
  const { filePath, reloadIntervalMs } = options;

  let registry: Registry = { ...EMPTY_REGISTRY };
  let loadedAt: string | null = null;

  function reload(): void {
    try {
      const content = readFileSync(filePath, "utf-8");
      registry = JSON.parse(content) as Registry;
      loadedAt = new Date().toISOString();
      logger.success(
        `Loaded registry — ${registry.projects?.length || 0} projects, ${registry.infrastructure?.length || 0} infrastructure, ${registry.devices?.length || 0} devices`,
      );
    } catch (error) {
      logger.error(
        `Failed to load projects.json: ${(error as Error).message}`,
      );
    }
  }

  function startWatching(): void {
    watchFile(filePath, { interval: reloadIntervalMs }, () => {
      logger.info("projects.json changed — reloading registry");
      reload();
    });
  }

  /**
   * Resolve the effective host for auto-constructing service URLs.
   * Priority: projects.json defaultHost → DEFAULT_HOST env var → localhost.
   */
  function resolveDefaultHost(): string {
    return registry.defaultHost || process.env.DEFAULT_HOST || "localhost";
  }

  /**
   * Enrich a service entry with its resolved URL from the secrets store.
   *
   * Resolution order:
   *   1. Explicit per-service URL override (e.g. PRISM_SERVICE_URL in .env)
   *   2. Auto-constructed from resolved host + service port
   *   3. Localhost fallback (dev-only, no host configured)
   */
  function enrichService(
    service: RegistryProject,
    secrets: SecretsMap,
  ): RegistryProject {
    const enriched = { ...service };
    const urlEnv = `${envPrefix(service.id)}_URL`;

    if (secrets[urlEnv]) {
      enriched.url = secrets[urlEnv];
    } else if (service.port) {
      enriched.url = `http://${resolveDefaultHost()}:${service.port}`;
    }

    return enriched;
  }

  /**
   * Enrich an infrastructure entry with its display URL.
   * Uses the same resolveDefaultHost() + port pattern as services.
   * The urlEnv field exists for services that need the actual connection
   * string — it is NOT used here to avoid leaking credentials into the
   * registry response.
   */
  function enrichInfrastructure(
    infra: RegistryInfrastructure,
  ): RegistryInfrastructure {
    const enriched = { ...infra };

    if (infra.defaultPort) {
      enriched.url = `http://${resolveDefaultHost()}:${infra.defaultPort}`;
    }

    return enriched;
  }

  /**
   * Derive env-var-shaped key-value pairs from the projects.json registry.
   *
   * All env var names are derived from the service ID using the convention:
   *   {ID_UPPERCASED}_PORT, {ID_UPPERCASED}_URL, {ID_UPPERCASED}_MONGO_DB_NAME, etc.
   *
   * This lets services receive ports, auto-constructed URLs, and database/bucket
   * names via the normal /secrets → boot.js → process.env pipeline, even when
   * those values are not explicitly set in the master .env file.
   *
   * These are returned as a flat object to be merged as fallbacks (never
   * overwriting explicit .env entries).
   */
  function deriveRegistrySecrets(secrets: SecretsMap): SecretsMap {
    const derived: SecretsMap = {};
    const host = resolveDefaultHost();

    for (const service of registry.projects || []) {
      const prefix = envPrefix(service.id);

      // Port
      if (service.port) {
        derived[`${prefix}_PORT`] = String(service.port);
      }

      // URL — auto-construct if not explicitly overridden in .env
      const urlKey = `${prefix}_URL`;
      if (!secrets[urlKey] && service.port) {
        derived[urlKey] = `http://${host}:${service.port}`;
      }

      // WebSocket URL — auto-construct from wsPort if defined
      if (service.wsPort) {
        const wsKey = `${prefix}_WS_URL`;
        if (!secrets[wsKey]) {
          derived[wsKey] = `ws://${host}:${service.wsPort}`;
        }
      }

      // Database name
      if (service.db) {
        derived[`${prefix}_MONGO_DB_NAME`] = service.db;
      }

      // MinIO bucket name (single string only; arrays use custom env var naming)
      if (service.minioBucket && typeof service.minioBucket === "string") {
        derived[`${prefix}_MINIO_BUCKET_NAME`] = service.minioBucket;
      }

      // Per-service config — non-secret settings (IDs, flags, model names, etc.)
      // NOTE: When multiple projects define the same key (e.g. AUTH_URL) with
      // different values, the last project in the list wins. Services that need
      // project-specific values should use prefixed env vars (e.g. PORTAL_SERVICE_PUBLIC_URL)
      // or explicit .env overrides to avoid collisions.
      if (service.config) {
        for (const [key, value] of Object.entries(service.config)) {
          if (secrets[key] === undefined) {
            derived[key] = String(value);
          }
        }
      }

      // AUTH_URL auto-derivation — for projects with a domain, derive
      // AUTH_URL as https://{domain} unless explicitly overridden in
      // the project's config block or the master .env.
      if (service.domain && !secrets.AUTH_URL && !service.config?.AUTH_URL) {
        derived.AUTH_URL = `https://${service.domain}`;
      }
    }

    // Infrastructure config (e.g. MinIO public URL)
    for (const infra of registry.infrastructure || []) {
      if (infra.config) {
        for (const [key, value] of Object.entries(infra.config)) {
          if (secrets[key] === undefined) {
            derived[key] = String(value);
          }
        }
      }
    }

    // Top-level config — entries not tied to a specific service (e.g. stickers)
    if (registry.config) {
      for (const [key, value] of Object.entries(registry.config)) {
        if (secrets[key] === undefined) {
          derived[key] = String(value);
        }
      }
    }

    return derived;
  }

  // Initial load
  reload();

  return {
    get registry() {
      return registry;
    },
    get loadedAt() {
      return loadedAt;
    },
    reload,
    startWatching,
    resolveDefaultHost,
    enrichService,
    enrichInfrastructure,
    deriveRegistrySecrets,
  };
}
