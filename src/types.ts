// ─── Vault Service — Type Definitions ────────────────────────

import type { Request, Response, NextFunction } from "express";

// ── Secrets Store ──────────────────────────────────────────────

export type SecretsMap = Record<string, string>;

// ── Project Registry ───────────────────────────────────────────

export interface RegistryDependency {
  id: string;
  criticality: "required" | "optional";
}

/**
 * Shape of dependencies.generated.json — code-derived dependsOn edges
 * produced by scripts/generate-dependencies.js and merged into the
 * registry at load time. Never hand-edited.
 */
export interface GeneratedDependencies {
  generatedAt?: string;
  dependencies: Record<string, RegistryDependency[]>;
}

export interface RegistryProjectConfig {
  [key: string]: string;
}

export interface RegistryProject {
  id: string;
  label: string;
  essential?: boolean;
  port?: number | null;
  wsPort?: number;
  healthPath?: string | null;
  description?: string;
  db?: string | null;
  minioBucket?: string | string[] | null;
  visibility?: "internal" | "external";
  domain?: string;
  url?: string;
  device?: string;
  repo?: string | null;
  dockerProject?: string | null;
  deployTier?: number;
  dependsOn?: RegistryDependency[];
  config?: RegistryProjectConfig;
  analyticsPropertyId?: string;
  analyticsMeasurementId?: string;
  [key: string]: unknown;
}

export interface RegistryInfrastructure {
  id: string;
  label: string;
  type?: string;
  defaultPort?: number;
  url?: string;
  urlEnv?: string;
  config?: Record<string, string>;
  [key: string]: unknown;
}

export interface RegistryDevice {
  id: string;
  label: string;
  [key: string]: unknown;
}

export interface Registry {
  version: number;
  defaultHost?: string;
  config?: Record<string, string>;
  projects: RegistryProject[];
  infrastructure: RegistryInfrastructure[];
  devices: RegistryDevice[];
}

// ── Route Query Params ─────────────────────────────────────────

export interface SecretsQuery {
  keys?: string;
  prefix?: string;
  exclude?: string;
}

export interface RegistryProjectsQuery {
  id?: string;
  type?: string;
  deployTier?: string;
  resolve?: string;
}

export interface RegistryQuery {
  resolve?: string;
}

// ── Health Response ────────────────────────────────────────────

export interface HealthResponse {
  status: "ok";
  service: string;
  secretCount: number;
  projectCount: number;
  registryLoadedAt: string | null;
  uptime: number;
}

// ── Express Middleware Types ───────────────────────────────────

export type AuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void;
