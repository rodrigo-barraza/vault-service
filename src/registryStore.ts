import { errorMessage } from "@rodrigo-barraza/utilities-library";
// ─── Registry Store — Single Source of Truth ─────────────────

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
  enrichService(service: RegistryProject): RegistryProject;
  /** Enrich an infrastructure entry with its display URL */
  enrichInfrastructure(infra: RegistryInfrastructure): RegistryInfrastructure;
  /** Flatten the registry into a key-value secrets map */
  deriveSecrets(): SecretsMap;
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
        `Failed to load projects.json: ${errorMessage(error)}`,
      );
    }
  }

  function startWatching(): void {
    watchFile(filePath, { interval: reloadIntervalMs }, () => {
      logger.info("projects.json changed — reloading");
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
   * Enrich a service entry with its resolved URL.
   *
   * Resolution order:
   *   1. Explicit per-service URL in top-level or per-project config
   *   2. Auto-constructed from resolved host + service port
   */
  function enrichService(service: RegistryProject): RegistryProject {
    const enriched = { ...service };
    const urlKey = `${envPrefix(service.id)}_URL`;

    // Check top-level config for explicit URL
    if (registry.config?.[urlKey]) {
      enriched.url = registry.config[urlKey];
    } else if (service.config?.[urlKey]) {
      enriched.url = service.config[urlKey];
    } else if (service.port) {
      enriched.url = `http://${resolveDefaultHost()}:${service.port}`;
    }

    return enriched;
  }

  /**
   * Enrich an infrastructure entry with its display URL.
   * Uses the same resolveDefaultHost() + port pattern as services.
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
   * Flatten the entire registry into a key-value secrets map.
   *
   * Sources (in priority order, later wins):
   *   1. Auto-derived from project metadata (ports, URLs, DB names, buckets)
   *   2. Infrastructure config blocks
   *   3. Per-project config blocks
   *   4. Top-level config (highest priority — shared secrets live here)
   */
  function deriveSecrets(): SecretsMap {
    const result: SecretsMap = {};
    const host = resolveDefaultHost();

    // Layer 1: Auto-derived from project metadata
    for (const service of registry.projects || []) {
      const prefix = envPrefix(service.id);

      // Port
      if (service.port) {
        result[`${prefix}_PORT`] = String(service.port);
      }

      // URL — auto-construct from host + port
      const urlKey = `${prefix}_URL`;
      if (service.port) {
        result[urlKey] = `http://${host}:${service.port}`;
      }

      // Public URL — auto-derive from domain when set
      if (service.domain) {
        result[`${prefix}_PUBLIC_URL`] = `https://${service.domain}`;
      }

      // WebSocket URL
      if (service.wsPort) {
        result[`${prefix}_WS_URL`] = `ws://${host}:${service.wsPort}`;
      }

      // Database name
      if (service.db) {
        result[`${prefix}_MONGO_DB_NAME`] = service.db;
      }

      // MinIO bucket name (single string only)
      if (service.minioBucket && typeof service.minioBucket === "string") {
        result[`${prefix}_MINIO_BUCKET_NAME`] = service.minioBucket;
      }

      // Global AUTH_URL auto-derivation was removed to prevent a Shared Namespace Collision
      // where the last project with a domain in projects.json would overwrite AUTH_URL
      // for all services. Instead, clients rely on NextAuth's `trustHost: true` to dynamically
      // resolve their own origin from incoming request headers.
    }

    // Layer 2: Infrastructure config
    for (const infra of registry.infrastructure || []) {
      if (infra.config) {
        for (const [key, value] of Object.entries(infra.config)) {
          result[key] = String(value);
        }
      }
    }

    // Layer 3: Per-project config
    // Secrets share ONE flat namespace — a key repeated across projects is
    // silently last-writer-wins (this shipped clankerbox's GA_MEASUREMENT_ID
    // inside rod.dev). Warn whenever a project overwrites another project's
    // value so the collision is visible before it reaches a build.
    const configKeyOwners = new Map<string, string>();
    for (const service of registry.projects || []) {
      if (service.config) {
        for (const [key, value] of Object.entries(service.config)) {
          const owner = configKeyOwners.get(key);
          if (owner && result[key] !== String(value)) {
            logger.warn(
              `Secret key collision: "${key}" from ${service.id} overwrites ${owner}'s value — prefix per-project keys to disambiguate`,
            );
          }
          configKeyOwners.set(key, service.id);
          result[key] = String(value);
        }
      }
    }

    // Layer 4: Top-level config (highest priority — secrets + shared config)
    if (registry.config) {
      for (const [key, value] of Object.entries(registry.config)) {
        result[key] = String(value);
      }
    }

    return result;
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
    deriveSecrets,
  };
}
