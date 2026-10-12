/**
 * Integrations mount — do NOT edit. Served at `/api/integrations`.
 *
 * Mounts whatever src/integrations/routes/index.ts registers. With nothing
 * registered every call answers 404 with a pointer at the fix.
 *
 * Access rule (mirrors the `/api/integrations` protected prefix in the
 * Next.js stacks): callers must be signed in, because these routes execute
 * vendor calls with the workspace's credentials. Two exceptions:
 *   - a caller presenting the platform's `x-as-integration-token` (a trusted
 *     proxy vouching for a verified session)
 *   - mock mode outside production, where nobody CAN sign in (no database)
 *     and the sandbox preview still needs to exercise connected integrations
 */
import type { MiddlewareHandler } from "hono";
import { isMockMode } from "../db";
import { env } from "../env";
import { optionalUser, resolveUser } from "../auth/middleware";
import { createRouter, type AppEnv, type AppRouter } from "../router";
import { integrationRoutes } from "./routes";

const INTEGRATION_CALL_TOKEN_HEADER = "x-as-integration-token";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const integrationGate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const expected = env.AS_INTEGRATION_ROUTE_TOKEN;
  const presented = c.req.header(INTEGRATION_CALL_TOKEN_HEADER) ?? "";
  if (expected && presented && timingSafeEqual(expected, presented)) {
    c.set("user", await resolveUser(c));
    await next();
    return;
  }
  const user = await resolveUser(c);
  if (user) {
    c.set("user", user);
    await next();
    return;
  }
  if (isMockMode && !env.isProduction) {
    c.set("user", null);
    await next();
    return;
  }
  return c.json(
    { success: false as const, error: "Sign in to call integrations." },
    401,
  );
};

export function createIntegrationsApp(): AppRouter {
  const app = createRouter();
  app.use("*", integrationRoutes.length > 0 ? integrationGate : optionalUser);
  for (const entry of integrationRoutes) {
    app.route(entry.path, entry.app);
  }
  app.all("*", (c) =>
    c.json(
      {
        success: false as const,
        error:
          integrationRoutes.length === 0
            ? "No integrations are connected to this API service yet. Connect one under Integrations; the platform will add its routes under src/integrations/routes/."
            : `Unknown integration route ${c.req.method} ${c.req.path}. Registered: ${integrationRoutes.map((r) => r.path).join(", ")}`,
      },
      404,
    ),
  );
  return app;
}
