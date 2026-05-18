// ─── Vault Service — Public API ──────────────────────────────

export { envPrefix } from "./envParser.ts";
export { loadBearerToken } from "./secretsStore.ts";
export { createRegistryStore } from "./registryStore.ts";
export { createAuthMiddleware } from "./authMiddleware.ts";
export { mountRoutes } from "./routes.ts";

export type { RegistryStore, RegistryStoreOptions } from "./registryStore.ts";
export type { RoutesOptions } from "./routes.ts";
export type {
  SecretsMap,
  Registry,
  RegistryProject,
  RegistryInfrastructure,
  RegistryDevice,
  RegistryDependency,
  RegistryProjectConfig,
  SecretsQuery,
  RegistryQuery,
  RegistryProjectsQuery,
  HealthResponse,
  AuthMiddleware,
} from "./types.ts";
