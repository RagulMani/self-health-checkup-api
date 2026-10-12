/**
 * Integration route registry — PLATFORM-MANAGED. Do not edit by hand.
 *
 * When the workspace connects an integration the platform materializes one
 * file per action under src/integrations/routes/<slug>/<action>.ts (each built
 * with `createIntegrationActionRouter` from "../handleIntegrationAction") and
 * rewrites this registry to mount them. Every entry is served under
 * `/api/integrations<path>`.
 *
 * Business routes that need an integration should NOT fetch these URLs from
 * inside the API: import `handleIntegrationAction` and call it in-process.
 */
import type { AppRouter } from "@/router";

export const integrationRoutes: Array<{ path: string; app: AppRouter }> = [];
