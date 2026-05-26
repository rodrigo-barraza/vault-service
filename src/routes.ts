// ─── Vault Routes ────────────────────────────────────────────

import type { Router, Request, Response, RequestHandler } from "express";
import type { RegistryStore } from "./registryStore.ts";
import type { SecretsQuery, RegistryQuery, RegistryProjectsQuery, HealthResponse, SecretsMap } from "./types.ts";

export interface RoutesOptions {
  router: Router;
  registryStore: RegistryStore;
  requireAuth: RequestHandler;
}

export function mountRoutes(options: RoutesOptions): void {
  const { router, registryStore, requireAuth } = options;

  router.get("/health", (_req: Request, res: Response) => {
    const reg = registryStore.registry;
    const secrets = registryStore.deriveSecrets();
    const body: HealthResponse = {
      status: "ok",
      service: "vault",
      secretCount: Object.keys(secrets).length,
      projectCount: reg.projects?.length || 0,
      registryLoadedAt: registryStore.loadedAt,
      uptime: Math.floor(process.uptime()),
    };
    res.json(body);
  });

  router.get("/secrets", requireAuth, (req: Request<object, SecretsMap, unknown, SecretsQuery>, res: Response) => {
    const { keys, prefix, exclude } = req.query;
    let result: SecretsMap = registryStore.deriveSecrets();

    if (keys) {
      const keyList = keys.split(",").map((keyItem) => keyItem.trim());
      const filtered: SecretsMap = {};
      for (const key of keyList) {
        if (result[key] !== undefined) filtered[key] = result[key];
      }
      result = filtered;
    }

    if (prefix) {
      const prefixes = prefix.split(",").map((prefixItem) => prefixItem.trim());
      const filtered: SecretsMap = {};
      for (const [key, value] of Object.entries(result)) {
        if (prefixes.some((prefixItem) => key.startsWith(prefixItem))) filtered[key] = value;
      }
      result = filtered;
    }

    if (exclude) {
      const excludePrefixes = exclude.split(",").map((excludePrefix) => excludePrefix.trim());
      for (const key of Object.keys(result)) {
        if (excludePrefixes.some((excludePrefix) => key.startsWith(excludePrefix))) delete result[key];
      }
    }

    res.json(result);
  });

  router.post("/reload", requireAuth, (_req: Request, res: Response) => {
    registryStore.reload();
    const secrets = registryStore.deriveSecrets();
    res.json({
      status: "reloaded",
      secretCount: Object.keys(secrets).length,
      projectCount: registryStore.registry.projects?.length || 0,
      registryLoadedAt: registryStore.loadedAt,
    });
  });

  router.get("/keys", requireAuth, (_req: Request, res: Response) => {
    const secrets = registryStore.deriveSecrets();
    res.json(Object.keys(secrets));
  });

  router.get("/registry", requireAuth, (req: Request<object, unknown, unknown, RegistryQuery>, res: Response) => {
    const shouldResolve = req.query.resolve !== "false";
    const reg = registryStore.registry;
    res.json({
      version: reg.version,
      projects: shouldResolve ? (reg.projects || []).map((project) => registryStore.enrichService(project)) : reg.projects || [],
      infrastructure: shouldResolve ? (reg.infrastructure || []).map((infraItem) => registryStore.enrichInfrastructure(infraItem)) : reg.infrastructure || [],
      devices: reg.devices || [],
    });
  });

  router.get("/registry/projects", requireAuth, (req: Request<object, unknown, unknown, RegistryProjectsQuery>, res: Response) => {
    const { id, type, deployTier, resolve: resolveParam } = req.query;
    const shouldResolve = resolveParam !== "false";
    let services = registryStore.registry.projects || [];

    if (id) services = services.filter((project) => project.id === id);
    if (type) {
      const types = type.split(",").map((typeItem) => typeItem.trim());
      services = services.filter((project) => types.includes(project.type as string));
    }
    if (deployTier !== undefined) {
      const tier = parseInt(deployTier, 10);
      services = services.filter((project) => project.deployTier === tier);
    }
    if (shouldResolve) services = services.map((project) => registryStore.enrichService(project));

    res.json(services);
  });

  router.get("/registry/projects/:id", requireAuth, (req: Request<{ id: string }, unknown, unknown, RegistryQuery>, res: Response) => {
    const service = (registryStore.registry.projects || []).find((project) => project.id === req.params.id);
    if (!service) {
      res.status(404).json({ error: `Project "${req.params.id}" not found` });
      return;
    }
    const shouldResolve = req.query.resolve !== "false";
    res.json(shouldResolve ? registryStore.enrichService(service) : service);
  });

  router.get("/registry/infrastructure", requireAuth, (req: Request<object, unknown, unknown, RegistryQuery>, res: Response) => {
    const shouldResolve = req.query.resolve !== "false";
    const infra = registryStore.registry.infrastructure || [];
    res.json(shouldResolve ? infra.map((infraItem) => registryStore.enrichInfrastructure(infraItem)) : infra);
  });
}
