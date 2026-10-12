/**
 * Platform-owned Hono application shell — do NOT edit.
 *
 * Layout (all API traffic lives under `/api`, matching the `/api/:path*`
 * proxy every client stack ships; `/health` is also served at the root for
 * the sandbox health check):
 *
 *   GET  /health, /api/health         liveness + database mode
 *   GET  /openapi.json, /api/openapi.json   the generated contract
 *   /api/auth/*                       platform auth (src/auth/routes.ts)
 *   /api/integrations/*               connector routes (src/integrations)
 *   /api/<your routes>                src/routes/index.ts registry
 *
 * Unknown paths answer 404 `{ success: false, error }`; thrown errors answer
 * with their HTTPException status or 500, same envelope.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { createAuthRoutes } from "./auth/routes";
import { isMockMode } from "./db";
import { env } from "./env";
import { createIntegrationsApp } from "./integrations";
import { createRouter, type AppEnv, type AppRouter } from "./router";
import { routes } from "./routes";

export const API_PREFIX = "/api";

export const OPENAPI_CONFIG = {
  openapi: "3.0.0",
  info: {
    title: "API service",
    version: "1.0.0",
    description:
      "Generated API service. Every response is `{ success: true, data }` or `{ success: false, error }`.",
  },
} as const;

// Preview hosts every sandbox provider serves from. Used only outside
// production when no explicit allowlist is configured.
const DEV_ORIGIN_SUFFIXES = [
  ".dev.dual7.app",
  ".dev.dual7.ai",
  ".dual7.app",
  ".dual7.ai", // production dashboard (https://app.dual7.ai)
  ".e2b.app",
  ".e2b-staging.com",
  ".modal.host",
  ".proxy.daytona.work",
  ".daytonaproxy01.net",
  ".preview.bl.run",
  ".lvh.me",
];

function hostnameOf(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname;
  } catch {
    return null;
  }
}

/**
 * Which cross-origin callers may use credentials:
 *   1. an exact entry in AS_ALLOWED_CORS_ORIGINS (deployed clients + workbench)
 *   2. the request's own host (same-origin behind a proxy that forwards Origin)
 *   3. outside production: localhost, Expo, and sandbox preview domains —
 *      allowlist is additive here, never exclusive (a Vercel-only allowlist
 *      must not block the Dual7 workbench)
 */
export function resolveAllowedOrigin(origin: string, c: Context): string | null {
  if (!origin) return null;
  const allowlist = env.ALLOWED_CORS_ORIGINS;
  if (allowlist.includes(origin)) return origin;
  const host = hostnameOf(origin);
  const requestHost = (c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "")
    .split(",")[0]
    .trim()
    .replace(/:\d+$/, "");
  if (host && requestHost && host === requestHost) return origin;
  // Production: allowlist / same-host only. Non-production: also trust
  // workbench + sandbox preview hosts even when the allowlist is non-empty.
  if (env.isProduction) return null;
  if (origin.startsWith("exp://")) return origin;
  if (!host) return null;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return origin;
  if (DEV_ORIGIN_SUFFIXES.some((suffix) => host.endsWith(suffix))) return origin;
  return null;
}

function healthPayload() {
  return {
    success: true as const,
    data: {
      ok: true as const,
      service: "node-api",
      database: isMockMode ? "mock" : "postgres",
      uptimeSeconds: Math.round(process.uptime()),
    },
  };
}

export function buildOpenAPIDocument(app: AppRouter) {
  return app.getOpenAPIDocument(OPENAPI_CONFIG);
}

export function createApp(): AppRouter {
  const app = new OpenAPIHono<AppEnv>();

  app.use("*", logger());
  app.use(
    "*",
    cors({
      origin: resolveAllowedOrigin,
      credentials: true,
      allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "Cookie",
        "X-Requested-With",
        "Accept",
        "Origin",
      ],
      exposeHeaders: ["Set-Cookie"],
      maxAge: 600,
    }),
  );

  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });

  app.get("/health", (c) => c.json(healthPayload()));
  app.get("/openapi.json", (c) => c.json(buildOpenAPIDocument(app)));

  const api = createRouter();
  api.get("/health", (c) => c.json(healthPayload()));
  api.get("/openapi.json", (c) => c.json(buildOpenAPIDocument(app)));
  api.route("/auth", createAuthRoutes());
  api.route("/integrations", createIntegrationsApp());
  for (const entry of routes) {
    api.route(entry.path, entry.app);
  }
  app.route(API_PREFIX, api);

  app.notFound((c) =>
    c.json(
      { success: false as const, error: `Not found: ${c.req.method} ${c.req.path}` },
      404,
    ),
  );

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ success: false as const, error: err.message || "Request failed" }, err.status);
    }
    console.error(`[api] ${c.req.method} ${c.req.path} failed:`, err);
    const message =
      env.isProduction ? "Internal server error" : err instanceof Error ? err.message : String(err);
    return c.json({ success: false as const, error: message }, 500);
  });

  return app;
}
