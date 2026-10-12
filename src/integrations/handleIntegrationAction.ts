/**
 * Platform-owned integration action helper — DO NOT EDIT.
 *
 * Hono port of the helper the Next.js stacks receive at
 * lib/integrations/connectors/handleIntegrationAction.ts. The connector
 * runtime it drives lives next to it in ./connectors (a copy of
 * packages/shared/src/integrations/connectors, kept byte-identical by the
 * platform test suite). The per-app action manifest is read from the SAME
 * path the platform syncs for every stack:
 *
 *   lib/integrations/connectors/manifest.json   (AS_INTEGRATION_MANIFEST_PATH)
 *
 * Two entry points:
 *   handleIntegrationAction(slug, action, params, baked?)  in-process call
 *   createIntegrationActionRouter({...})                    HTTP route factory
 *
 * Response: { success: boolean, data: unknown, error?: string }.
 */
import fs from "node:fs";
import path from "node:path";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { env } from "../env";
import { createRouter, type AppEnv, type AppRouter } from "../router";
import type { ProviderConfig } from "./connectors";
import {
  CONTROL_PARAM_KEYS,
  normalizeConnectorAuthCreds,
  registerProviders,
  runIntegration,
} from "./connectors";

type ManifestField = { key: string; location?: "path" | "query" | "body" | "header" };

interface ManifestAction {
  slug: string;
  http_method: string;
  endpoint_template: string;
  fields?: ManifestField[];
}

interface ManifestProvider {
  slug: string;
  name: string;
  base_url: string;
  sandbox_base_url?: string;
  auth: ProviderConfig["auth"];
  default_content_type?: ProviderConfig["defaultContentType"];
  static_headers?: Record<string, string>;
  oauth?: { token_uri: string; auth_method?: string };
  configured: boolean;
  param_defaults?: Record<string, string>;
  actions: Record<string, ManifestAction>;
}

interface Manifest {
  generated_at: string;
  app_id: string;
  providers: Record<string, ManifestProvider>;
  log?: { url: string; token: string };
}

export type BakedExecution = {
  method: string;
  endpoint: string;
  fields?: ManifestField[];
};

export type IntegrationActionResultBody = {
  success: boolean;
  data?: unknown;
  error?: string;
  statusCode: number;
};

const APP_RUNTIME_LOG_TOKEN_HEADER = "x-as-app-log-token";

function manifestPath(): string {
  const configured = env.INTEGRATION_MANIFEST_PATH;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

let cache: { mtimeMs: number; manifest: Manifest } | null = null;

/** Re-read on mtime change so connecting an integration takes effect without a restart. */
function loadManifest(): Manifest | null {
  try {
    const file = manifestPath();
    const { mtimeMs } = fs.statSync(file);
    if (cache && cache.mtimeMs === mtimeMs) return cache.manifest;
    const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as Manifest;
    registerProviders(
      Object.values(manifest.providers).map((provider) => ({
        slug: provider.slug,
        name: provider.name,
        baseUrl: provider.base_url,
        sandboxBaseUrl: provider.sandbox_base_url,
        auth: provider.auth,
        defaultContentType: provider.default_content_type,
        staticHeaders: provider.static_headers,
      })),
    );
    cache = { mtimeMs, manifest };
    return manifest;
  } catch {
    return null;
  }
}

/**
 * Credentials the platform synced into this service for one provider.
 * `SENDGRID_API_KEY` → `api_key`, which is what the connector's auth pattern
 * and `{placeholder}` interpolation look for.
 */
function credentialsFromEnv(slug: string): Record<string, string> {
  const prefix = slug.toUpperCase().replace(/-/g, "_") + "_";
  const creds: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || !key.startsWith(prefix)) continue;
    creds[key.slice(prefix.length).toLowerCase()] = value;
  }
  return creds;
}

/** Fire-and-forget: a logging failure must never fail the operator's call. */
function postExecutionLog(manifest: Manifest, entry: Record<string, unknown>): void {
  if (!manifest.log) return;
  void fetch(manifest.log.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [APP_RUNTIME_LOG_TOKEN_HEADER]: manifest.log.token,
    },
    body: JSON.stringify(entry),
  }).catch(() => undefined);
}

/** Exact / compact slug lookup only — no hardcoded semantic matchers. */
function resolveManifestAction(
  provider: ManifestProvider,
  actionSlug: string,
): ManifestAction | null {
  const trimmed = actionSlug.trim();
  if (!trimmed) return null;
  if (provider.actions[trimmed]) return provider.actions[trimmed];
  const lower = trimmed.toLowerCase();
  if (provider.actions[lower]) return provider.actions[lower];

  const compact = trimmed.replace(/[_-]/g, "").toLowerCase();
  for (const [key, action] of Object.entries(provider.actions)) {
    if (key.replace(/[_-]/g, "").toLowerCase() === compact) return action;
  }
  return null;
}

/**
 * Drop execution-control keys from caller-supplied params.
 *
 * `CONTROL_PARAM_KEYS` comes from the connector runtime itself, so the set the
 * runtime honours and the set filtered here can never drift apart. Caller
 * input is merged AFTER the route's baked method and endpoint; any of these
 * arriving from a request would otherwise turn a route for one action into a
 * request for any endpoint on the provider with the workspace's credentials.
 */
function stripControlParams(params: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (CONTROL_PARAM_KEYS.has(key)) continue;
    safe[key] = value;
  }
  return safe;
}

/**
 * Resolve one provider/action and run it.
 * Prefer `baked` method/endpoint from the thin route (from integration_action_master).
 * Fall back to exact/compact manifest lookup when baked metadata is absent.
 */
export async function handleIntegrationAction(
  slug: string,
  actionSlug: string,
  params: Record<string, unknown>,
  baked?: BakedExecution | null,
): Promise<IntegrationActionResultBody> {
  const manifest = loadManifest();
  if (!manifest) {
    return {
      success: false,
      statusCode: 503,
      error:
        "Integration manifest is missing. Restart the app preview so the platform can reinject it.",
    };
  }

  const provider = manifest.providers[slug.toLowerCase()];
  if (!provider) {
    return { success: false, statusCode: 404, error: `Unknown integration "${slug}".` };
  }
  if (!provider.configured) {
    return {
      success: false,
      statusCode: 404,
      error: `${provider.name} is not connected for this workspace. Connect it under Integrations, then reload the preview.`,
    };
  }

  const bakedMethod = typeof baked?.method === "string" ? baked.method.trim().toUpperCase() : "";
  const bakedEndpoint = typeof baked?.endpoint === "string" ? baked.endpoint.trim() : "";
  const hasBaked = Boolean(bakedMethod && bakedEndpoint);

  const manifestAction = resolveManifestAction(provider, actionSlug);
  if (!hasBaked && !manifestAction) {
    const available = Object.keys(provider.actions).slice(0, 20).join(", ");
    return {
      success: false,
      statusCode: 404,
      error:
        `Unknown ${provider.name} action "${actionSlug}".` +
        (available ? ` Available: ${available}` : ""),
    };
  }

  const method = hasBaked ? bakedMethod : manifestAction!.http_method;
  const endpoint = hasBaked ? bakedEndpoint : manifestAction!.endpoint_template;
  const fields = hasBaked && baked?.fields?.length ? baked.fields : manifestAction?.fields;

  const credentials = normalizeConnectorAuthCreds(provider.slug, credentialsFromEnv(provider.slug));
  // Workspace-pinned defaults for parameters the caller left out. Spread AFTER
  // the caller's params on purpose: `paramDefaults` is an execution-control
  // key, so `stripControlParams` has already removed any the caller sent, and
  // adding the platform's own last means a request body can never choose them.
  const paramDefaults = provider.param_defaults;
  const payload = {
    method,
    endpoint,
    ...(fields?.length ? { fieldLocations: fields } : {}),
    ...stripControlParams(params),
    ...(paramDefaults && Object.keys(paramDefaults).length > 0 ? { paramDefaults } : {}),
  };
  let result = await runIntegration(provider.slug, payload, credentials, credentials);

  // A rejected OAuth token is reported, never refreshed here: providers that
  // rotate refresh tokens would hand this process a new one it has nowhere to
  // persist, invalidating the platform's stored token. The platform re-syncs a
  // fresh access token on every boot.
  if (!result.success && (result.statusCode === 401 || result.statusCode === 403) && provider.oauth) {
    result = {
      ...result,
      errorMessage:
        provider.name +
        " rejected the stored access token. Reconnect " +
        provider.name +
        " under Integrations, then reload the preview.",
    };
  }

  postExecutionLog(manifest, {
    slug: provider.slug,
    action: manifestAction?.slug ?? actionSlug,
    status: result.success ? "success" : "failure",
    http_status_code: result.statusCode ?? null,
    duration_ms: result.durationMs ?? null,
    input: params,
    output: result.data,
    error_message: result.errorMessage ?? null,
  });

  if (result.success) {
    return { success: true, data: result.data, statusCode: 200 };
  }

  // Append the reconnect advice to a 401 always, and to a 403 only when the
  // vendor's message actually points at credentials; otherwise let its own
  // actionable wording stand alone.
  const messageLooksCredential =
    /api.?key|access.?token|credential|unauthoriz|authenticat|expired|revoked|permission|forbidden\b/i.test(
      String(result.errorMessage ?? ""),
    );
  const authRejected =
    result.statusCode === 401 || (result.statusCode === 403 && messageLooksCredential);
  return {
    success: false,
    data: result.data,
    statusCode: result.statusCode || 502,
    error: authRejected
      ? `${result.errorMessage} — reconnect ${provider.name} under Integrations, then reload the preview.`
      : result.errorMessage,
  };
}

// ─── HTTP route factory (used by platform-materialized per-action files) ────

export interface IntegrationActionRouteOptions {
  slug: string;
  action: string;
  /** Baked from integration_action_master; omit to resolve from the manifest. */
  baked?: BakedExecution | null;
}

async function paramsFromRequest(
  req: { query(): Record<string, string>; json(): Promise<unknown> },
): Promise<Record<string, unknown>> {
  const fromQuery: Record<string, unknown> = { ...req.query() };
  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // GET or empty body
  }
  return { ...fromQuery, ...body };
}

/**
 * A router answering GET and POST at its mount path by executing one
 * provider/action. Mount it from src/integrations/routes/index.ts as
 * `{ path: "/<slug>/<action>", app }` so it serves
 * `/api/integrations/<slug>/<action>`.
 */
export function createIntegrationActionRouter(
  options: IntegrationActionRouteOptions,
): AppRouter {
  const app = createRouter();
  const run = async (c: Context<AppEnv>) => {
    const result = await handleIntegrationAction(
      options.slug,
      options.action,
      await paramsFromRequest(c.req),
      options.baked ?? null,
    );
    return c.json(
      {
        success: result.success,
        data: result.data,
        ...(result.success ? {} : { error: result.error }),
      },
      result.statusCode as ContentfulStatusCode,
    );
  };
  app.get("/", run);
  app.post("/", run);
  return app;
}
