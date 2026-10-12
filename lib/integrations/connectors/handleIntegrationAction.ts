/**
 * Platform-owned integration action helper — DO NOT EDIT.
 *
 * Injected by the platform on every sandbox boot. Thin per-action routes under
 * pages/api/integrations/{slug}/{action}.ts (or app/api/.../route.ts) call this
 * with method + endpoint baked from integration_action_master.
 *
 *   fetch('/api/integrations/<slug>/<action>', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ ...actionParams }),
 *   })
 *
 * Response: { success: boolean, data: unknown, error?: string }.
 */
import fs from 'fs';
import path from 'path';
import type { ProviderConfig } from '@/lib/integrations/connectors';
import {
  runIntegration,
  registerProviders,
  normalizeConnectorAuthCreds,
} from '@/lib/integrations/connectors';

type ManifestField = { key: string; location?: 'path' | 'query' | 'body' | 'header' };

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
  auth: ProviderConfig['auth'];
  default_content_type?: ProviderConfig['defaultContentType'];
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

const MANIFEST_PATH = path.join(process.cwd(), 'lib/integrations/connectors/manifest.json');

let cache: { mtimeMs: number; manifest: Manifest } | null = null;

/** Re-read on mtime change so connecting an integration takes effect without a restart. */
function loadManifest(): Manifest | null {
  try {
    const { mtimeMs } = fs.statSync(MANIFEST_PATH);
    if (cache && cache.mtimeMs === mtimeMs) return cache.manifest;
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
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
 * Credentials the platform synced into this sandbox for one provider.
 * `SENDGRID_API_KEY` → `api_key`, which is what the connector's auth pattern
 * and `{placeholder}` interpolation look for.
 */
function credentialsFromEnv(slug: string): Record<string, string> {
  const prefix = slug.toUpperCase().replace(/-/g, '_') + '_';
  const creds: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || !key.startsWith(prefix)) continue;
    creds[key.slice(prefix.length).toLowerCase()] = value;
  }
  return creds;
}

/** Fire-and-forget: a logging failure must never fail the operator's call. */
function postExecutionLog(
  manifest: Manifest,
  entry: Record<string, unknown>,
): void {
  if (!manifest.log) return;
  void fetch(manifest.log.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-as-app-log-token': manifest.log.token,
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

  const compact = trimmed.replace(/[_-]/g, '').toLowerCase();
  for (const [key, action] of Object.entries(provider.actions)) {
    if (key.replace(/[_-]/g, '').toLowerCase() === compact) return action;
  }
  return null;
}

/**
 * Keys the connector reads as EXECUTION CONTROL rather than as action data:
 * they choose the HTTP method, the endpoint path, and which bucket each value
 * is sent in. Must mirror CONTROL_PARAM_KEYS in the connector runtime.
 *
 * Caller input is merged into the payload AFTER the route's baked method and
 * endpoint, so any of these arriving from the request would silently win. That
 * turns a route for one action into a request for any endpoint on the
 * provider — with the workspace's credentials attached — and for providers
 * whose base URL carries placeholders (`{store_url}`, `{domain}`, …) a
 * caller-supplied `pathParams` can move the whole request to another host.
 *
 * The route is the authority on what it executes. Callers supply data only.
 */
const CONTROL_PARAM_KEYS = new Set(["method","endpoint","pathParams","queryParams","body","contentType","headers","fieldLocations","paramDefaults"]);

/** Drop execution-control keys from caller-supplied params. */
function stripControlParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
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
        'Integration manifest is missing. Restart the app preview so the platform can reinject it.',
    };
  }

  const provider = manifest.providers[slug.toLowerCase()];
  if (!provider) {
    return {
      success: false,
      statusCode: 404,
      error: `Unknown integration "${slug}".`,
    };
  }
  if (!provider.configured) {
    return {
      success: false,
      statusCode: 404,
      error: `${provider.name} is not connected for this workspace. Connect it under Integrations, then reload the preview.`,
    };
  }

  const bakedMethod =
    typeof baked?.method === 'string' ? baked.method.trim().toUpperCase() : '';
  const bakedEndpoint =
    typeof baked?.endpoint === 'string' ? baked.endpoint.trim() : '';
  const hasBaked = Boolean(bakedMethod && bakedEndpoint);

  const manifestAction = resolveManifestAction(provider, actionSlug);
  if (!hasBaked && !manifestAction) {
    const available = Object.keys(provider.actions).slice(0, 20).join(', ');
    return {
      success: false,
      statusCode: 404,
      error:
        `Unknown ${provider.name} action "${actionSlug}".` +
        (available ? ` Available: ${available}` : ''),
    };
  }

  const method = hasBaked ? bakedMethod : manifestAction!.http_method;
  const endpoint = hasBaked ? bakedEndpoint : manifestAction!.endpoint_template;
  const fields =
    hasBaked && baked?.fields?.length
      ? baked.fields
      : manifestAction?.fields;

  const credentials = normalizeConnectorAuthCreds(
    provider.slug,
    credentialsFromEnv(provider.slug),
  );
  // Workspace-pinned defaults for parameters the caller left out. Spread AFTER
  // the caller's params on purpose: `paramDefaults` is an execution-control
  // key, so `stripControlParams` has already removed any the caller sent, and
  // adding the platform's own last means a request body can never choose them.
  // The connector narrows this to the keys the invoked action declares and
  // never lets a default override a value the caller supplied.
  const paramDefaults = provider.param_defaults;
  const payload = {
    method,
    endpoint,
    ...(fields?.length ? { fieldLocations: fields } : {}),
    ...stripControlParams(params),
    ...(paramDefaults && Object.keys(paramDefaults).length > 0
      ? { paramDefaults }
      : {}),
  };
  let result = await runIntegration(provider.slug, payload, credentials, credentials);

  // A rejected OAuth token is reported, never refreshed here. Refreshing from
  // inside the sandbox looked like a courtesy and was destructive: providers
  // that rotate refresh tokens (Salesforce, Xero, Dropbox, QuickBooks, and
  // Google under some grants) return a NEW refresh_token in the response, and
  // this process had nowhere to persist it — so the platform's stored token
  // was invalidated at the vendor the moment a generated app made one call,
  // permanently killing the workspace's connection.
  //
  // Losing the refresh costs little: the platform re-syncs a fresh access
  // token into the sandbox on every boot, and sandboxes idle-stop after ten
  // minutes and live at most two hours, so only a session running longer than
  // the token lifetime is affected — and it recovers on reload.
  if (
    !result.success &&
    (result.statusCode === 401 || result.statusCode === 403) &&
    provider.oauth
  ) {
    result = {
      ...result,
      errorMessage:
        provider.name +
        ' rejected the stored access token. Reconnect ' +
        provider.name +
        ' under Integrations, then reload the preview.',
    };
  }

  postExecutionLog(manifest, {
    slug: provider.slug,
    action: manifestAction?.slug ?? actionSlug,
    status: result.success ? 'success' : 'failure',
    http_status_code: result.statusCode ?? null,
    duration_ms: result.durationMs ?? null,
    input: params,
    output: result.data,
    error_message: result.errorMessage ?? null,
  });

  if (result.success) {
    return { success: true, data: result.data, statusCode: 200 };
  }

  // Keep the vendor's own wording, but a rejected credential that a refresh
  // could not rescue needs an operator action the vendor cannot know about.
  // 401 is always that. A 403 is only sometimes: vendors also use it for
  // policy rejections whose remedy has nothing to do with credentials —
  // Resend's "The example.com domain is not verified. Please, add and verify
  // your domain on https://resend.com/domains" got a misleading "reconnect
  // Resend" suffix appended (live 2026-08-12), sending the operator to
  // re-enter a key that already worked. Append the reconnect advice to a 403
  // only when the vendor's message actually points at credentials; otherwise
  // let its own actionable wording stand alone.
  const messageLooksCredential =
    /api.?key|access.?token|credential|unauthoriz|authenticat|expired|revoked|permission|forbidden\b/i.test(
      String(result.errorMessage ?? ''),
    );
  const authRejected =
    result.statusCode === 401 ||
    (result.statusCode === 403 && messageLooksCredential);
  return {
    success: false,
    data: result.data,
    statusCode: result.statusCode || 502,
    error: authRejected
      ? `${result.errorMessage} — reconnect ${provider.name} under Integrations, then reload the preview.`
      : result.errorMessage,
  };
}
