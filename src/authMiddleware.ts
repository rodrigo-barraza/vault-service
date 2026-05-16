// ─── Auth Middleware — Bearer Token Verification ─────────────

import type { Request, Response, NextFunction } from "express";

/**
 * Create an Express middleware that validates Bearer token authorization.
 * The token is resolved lazily via the provided getter, allowing the
 * token to be loaded/reloaded independently of middleware creation.
 */
export function createAuthMiddleware(
  getToken: () => string,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ error: "Missing or malformed Authorization header" });
      return;
    }

    if (header.slice(7) !== getToken()) {
      res.status(403).json({ error: "Invalid bearer token" });
      return;
    }

    next();
  };
}
