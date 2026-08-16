import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

const HEADER = "x-site-password";

/** Whole-site shared-password gate -- deliberately simple (one shared
 * secret via a request header, not real per-user accounts) since that's
 * what was actually asked for: keep casual/unintended visitors off a link
 * that's being shared around, not defend against a determined attacker.
 * The frontend attaches this header to every request once the password's
 * been entered once (see web/src/lib/sitePassword.ts) -- there's no cookie/
 * session here, just a static shared value checked on every request.
 *
 * Exempts /auth/check (the password check itself -- has to be reachable
 * pre-auth) and /health (Railway's own health probe, which won't send this
 * header). Everything else 401s without a match. */
export function siteAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/auth/check" || req.path === "/health") return next();
  const provided = req.header(HEADER);
  if (provided && provided === env.sitePassword) return next();
  return res.status(401).json({ error: "Unauthorized" });
}
