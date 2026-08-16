import { Router } from "express";
import { env } from "../config/env";

export const authRouter = Router();

// GET /auth/check -- validates the X-Site-Password header against
// SITE_PASSWORD. Exempted from siteAuthMiddleware itself (has to be
// reachable pre-auth) -- used both by the frontend's initial password form
// and to silently revalidate a previously-stored password on every reload,
// so a rotated SITE_PASSWORD kicks stale browsers back to the gate instead
// of trusting a cached value forever.
authRouter.get("/check", (req, res) => {
  const provided = req.header("x-site-password");
  if (provided && provided === env.sitePassword) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false });
});
