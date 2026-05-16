// ─── Vault Routes ────────────────────────────────────────────

import type { Router, Request, Response, RequestHandler } from "express";
import type { SecretsStore } from "./secretsStore.ts";
import type { RegistryStore } from "./registryStore.ts";
import type { SecretsQuery, RegistryQuery, RegistryProjectsQuery, HealthResponse, SecretsMap } from "./types.ts";

export interface RoutesOptions {
  router: Router;
  secretsStore: SecretsStore;
  registryStore: RegistryStore;
  requireAuth: RequestHandler;
}

export function mountRoutes(options: RoutesOptions): void {
  const { router, secretsStore, registryStore, requireAuth } = options;

  router.get("/health", (_req: Request, res: Response) => {
    const reg = registryStore.registry;
    const body: HealthResponse = {
      status: "ok",
      service: "vault",
      secretCount: Object.keys(secretsStore.secrets).length,
      projectCount: reg.projects?.length || 0,
      lastLoadedAt: secretsStore.lastLoadedAt,
      registryLoadedAt: registryStore.loadedAt,
      uptime: Math.floor(process.uptime()),
    };
    res.json(body);
  });

  router.get("/secrets", requireAuth, (req: Request<object, SecretsMap, unknown, SecretsQuery>, res: Response) => {
    const { keys, prefix, exclude } = req.query;
    const registryDerived = registryStore.deriveRegistrySecrets(secretsStore.secrets);
    let result: SecretsMap = { ...registryDerived, ...secretsStore.secrets };

    if (keys) {
      const keyList = keys.split(",").map((k) => k.trim());
      const filtered: SecretsMap = {};
      for (const key of keyList) {
        if (result[key] !== undefined) filtered[key] = result[key];
      }
      result = filtered;
    }

    if (prefix) {
      const prefixes = prefix.split(",").map((p) => p.trim());
      const filtered: SecretsMap = {};
      for (const [key, value] of Object.entries(result)) {
        if (prefixes.some((p) => key.startsWith(p))) filtered[key] = value;
      }
      result = filtered;
    }

    if (exclude) {
      const excludePrefixes = exclude.split(",").map((p) => p.trim());
      for (const key of Object.keys(result)) {
        if (excludePrefixes.some((p) => key.startsWith(p))) delete result[key];
      }
    }

    res.json(result);
  });

  router.post("/reload", requireAuth, (_req: Request, res: Response) => {
    secretsStore.reload();
    registryStore.reload();
    res.json({
      status: "reloaded",
      secretCount: Object.keys(secretsStore.secrets).length,
      projectCount: registryStore.registry.projects?.length || 0,
      lastLoadedAt: secretsStore.lastLoadedAt,
      registryLoadedAt: registryStore.loadedAt,
    });
  });

  router.get("/keys", requireAuth, (_req: Request, res: Response) => {
    const registryDerived = registryStore.deriveRegistrySecrets(secretsStore.secrets);
    const merged = { ...registryDerived, ...secretsStore.secrets };
    res.json(Object.keys(merged));
  });

  router.get("/registry", requireAuth, (req: Request<object, unknown, unknown, RegistryQuery>, res: Response) => {
    const shouldResolve = req.query.resolve !== "false";
    const reg = registryStore.registry;
    const secrets = secretsStore.secrets;
    res.json({
      version: reg.version,
      projects: shouldResolve ? (reg.projects || []).map((s) => registryStore.enrichService(s, secrets)) : reg.projects || [],
      infrastructure: shouldResolve ? (reg.infrastructure || []).map((i) => registryStore.enrichInfrastructure(i)) : reg.infrastructure || [],
      devices: reg.devices || [],
    });
  });

  router.get("/registry/projects", requireAuth, (req: Request<object, unknown, unknown, RegistryProjectsQuery>, res: Response) => {
    const { id, type, deployTier, resolve: resolveParam } = req.query;
    const shouldResolve = resolveParam !== "false";
    const secrets = secretsStore.secrets;
    let services = registryStore.registry.projects || [];

    if (id) services = services.filter((s) => s.id === id);
    if (type) {
      const types = type.split(",").map((t) => t.trim());
      services = services.filter((s) => types.includes(s.type as string));
    }
    if (deployTier !== undefined) {
      const tier = parseInt(deployTier, 10);
      services = services.filter((s) => s.deployTier === tier);
    }
    if (shouldResolve) services = services.map((s) => registryStore.enrichService(s, secrets));

    res.json(services);
  });

  router.get("/registry/projects/:id", requireAuth, (req: Request<{ id: string }, unknown, unknown, RegistryQuery>, res: Response) => {
    const service = (registryStore.registry.projects || []).find((s) => s.id === req.params.id);
    if (!service) {
      res.status(404).json({ error: `Project "${req.params.id}" not found` });
      return;
    }
    const shouldResolve = req.query.resolve !== "false";
    res.json(shouldResolve ? registryStore.enrichService(service, secretsStore.secrets) : service);
  });

  router.get("/registry/infrastructure", requireAuth, (req: Request<object, unknown, unknown, RegistryQuery>, res: Response) => {
    const shouldResolve = req.query.resolve !== "false";
    const infra = registryStore.registry.infrastructure || [];
    res.json(shouldResolve ? infra.map((i) => registryStore.enrichInfrastructure(i)) : infra);
  });
}
