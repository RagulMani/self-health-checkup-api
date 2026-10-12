/**
 * Dynamic Integration Connector
 *
 * A single generic connector that handles all integration API calls dynamically
 * based on provider configuration and action metadata.
 *
 * Provider transport comes from the registry. Method, endpoint, field
 * locations, and parameters come from action metadata.
 */

import type {
  ConnectorResult,
  ConnectorResultWithDuration,
  ConnectorAuth,
  ConnectorCustom,
  GenericApiCallParams,
  ProviderConfig,
} from './types';
import { getProvider } from './providerRegistry';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function nowMs(start: number): number {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return Math.round(now - start);
}

function getStartTime(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function base64Encode(str: string): string {
  const BufferCtor = (globalThis as { Buffer?: { from(s: string): { toString(encoding: 'base64'): string } } })
    .Buffer;
  if (BufferCtor) {
    return BufferCtor.from(str).toString('base64');
  }
  return btoa(str);
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON Parsing Utilities (Backend Parity)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempt to parse a JSON string, tolerating trailing commas.
 * First tries strict JSON.parse, then strips trailing commas with a
 * regex and retries. Returns the parsed value or throws if both fail.
 */
function lenientJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    // Strip trailing commas before } or ] and retry.
    // e.g.  { "a": 1, }  →  { "a": 1 }
    const cleaned = s.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(cleaned); // throws if still invalid
  }
}

/**
 * Recursively walk a value and parse any string that looks like a JSON
 * object or array into its real JS equivalent.
 *
 * This handles the case where a Textarea field stores its content as a
 * string (e.g. "[\n  { ... }\n]") — we want the real array/object to
 * reach bodyToFormData so it can be serialized as proper nested form
 * keys (line_items[0][price]=xxx) rather than as a flat encoded string.
 * Trailing commas in user-typed JSON are tolerated.
 */
function deepParseJsonStrings(val: unknown): unknown {
  if (typeof val === 'string') {
    const t = val.trim();
    if (
      (t.startsWith('{') && t.endsWith('}')) ||
      (t.startsWith('[') && t.endsWith(']'))
    ) {
      try {
        return lenientJsonParse(t);
      } catch {
        // not valid JSON even after cleanup — keep as string
      }
    }
    return val;
  }
  if (Array.isArray(val)) return val.map(deepParseJsonStrings);
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = deepParseJsonStrings(v);
    }
    return out;
  }
  return val;
}

/**
 * Build auth headers based on the provider's auth pattern.
 */
function buildAuthHeaders(
  auth: ProviderConfig['auth'],
  creds: ConnectorAuth
): Record<string, string> {
  const headers: Record<string, string> = {};

  switch (auth.type) {
    case 'bearer': {
      // Prefer the provider's configured credential key, then OAuth/token aliases.
      const token = creds[auth.credKey] || creds.access_token || creds.api_key;
      if (token) headers['Authorization'] = `Bearer ${token}`;
      break;
    }
    case 'api_key_header': {
      const key = creds[auth.credKey];
      if (key) {
        const value = (auth.valuePrefix || '') + key;
        headers[auth.headerName] = value;
        break;
      }
      // A provider can offer BOTH an api-key credential and an OAuth flow —
      // Discord (`Bot <bot_token>` vs a Bearer user token) and Klaviyo are
      // both like this. An OAuth-issued token is a Bearer token by definition
      // (RFC 6750), so it never takes the api-key path's prefix. Restricted to
      // `Authorization` because any other header name is provider-specific and
      // "Bearer" would be meaningless in it.
      if (auth.headerName === 'Authorization' && creds.access_token) {
        headers['Authorization'] = `Bearer ${creds.access_token}`;
      }
      break;
    }
    case 'basic': {
      const user = creds[auth.userKey] || '';
      const pass = creds[auth.passKey] || '';
      if (user || pass) {
        headers['Authorization'] = `Basic ${base64Encode(`${user}:${pass}`)}`;
      }
      break;
    }
    case 'oauth2_bearer': {
      if (creds.access_token) {
        headers['Authorization'] = `Bearer ${creds.access_token}`;
      }
      break;
    }
    case 'none':
    default:
      break;
  }

  return headers;
}

/**
 * Validate that required auth credentials are present.
 */
function validateAuth(
  provider: ProviderConfig,
  creds: ConnectorAuth
): string | null {
  const auth = provider.auth;

  switch (auth.type) {
    case 'bearer': {
      const token = creds[auth.credKey] || creds.access_token || creds.api_key;
      if (!token) return `Missing ${provider.name} ${auth.credKey} or access_token`;
      break;
    }
    case 'api_key_header': {
      // Mirrors the OAuth fallback in `buildAuthHeaders` — validation runs
      // first, so without this an OAuth-connected provider is rejected here
      // and never reaches the header builder that would have handled it.
      const usable =
        creds[auth.credKey] ||
        (auth.headerName === 'Authorization' ? creds.access_token : undefined);
      if (!usable) return `Missing ${provider.name} ${auth.credKey}`;
      break;
    }
    case 'basic': {
      if (!creds[auth.userKey] || !creds[auth.passKey]) {
        return `Missing ${provider.name} ${auth.userKey} or ${auth.passKey}`;
      }
      break;
    }
    case 'oauth2_bearer': {
      if (!creds.access_token) {
        return `Missing ${provider.name} access_token. Complete the OAuth flow.`;
      }
      break;
    }
  }

  return null;
}

/**
 * Replace {placeholder} tokens in URL with values from pathParams or creds.
 * Throws an error if any placeholders remain unresolved (backend parity).
 */
function interpolateUrl(
  template: string,
  pathParams: Record<string, string>,
  creds: ConnectorAuth,
  throwOnUnresolved = false,
  encodeValues = true,
): string {
  const serialize = (value: string) =>
    encodeValues ? encodeURIComponent(value) : value;
  let out = template;
  for (const [k, v] of Object.entries(pathParams)) {
    out = out.split(`{${k}}`).join(serialize(v));
  }
  // Also check creds for any remaining placeholders
  out = out.replace(/\{([^}]+)\}/g, (match, key) => {
    const value = creds[key];
    if (value !== undefined && value !== null && value !== '') {
      return serialize(value);
    }
    return match; // Keep placeholder for error detection
  });

  // Check for unresolved placeholders
  if (throwOnUnresolved && /\{[^}]+\}/.test(out)) {
    throw new Error(
      'Unresolved path placeholders; provide pathParams for all {keys} in endpoint'
    );
  }

  // For backward compatibility, replace remaining placeholders with empty string
  return out.replace(/\{[^}]+\}/g, '');
}

function normalizeLookupKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function lookupDynamicValue(
  key: string,
  ...sources: Array<Record<string, unknown>>
): unknown {
  for (const source of sources) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
    const normalizedKey = normalizeLookupKey(key);
    for (const [sourceKey, value] of Object.entries(source)) {
      if (
        value !== undefined &&
        value !== null &&
        normalizeLookupKey(sourceKey) === normalizedKey
      ) {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * Append query parameters to URL.
 */
function appendQueryParams(url: URL, queryParams: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(queryParams)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

/**
 * Convert body to URL-encoded form data.
 */
function bodyToFormData(body: unknown): URLSearchParams {
  const params = new URLSearchParams();
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return params;
  }

  function appendValue(prefix: string, value: unknown): void {
    if (value === undefined || value === null) return;

    if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        appendValue(prefix ? `${prefix}[${k}]` : k, v);
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, i) => appendValue(`${prefix}[${i}]`, item));
      return;
    }

    params.append(prefix, String(value));
  }

  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    appendValue(key, value);
  }

  return params;
}

/**
 * OpenAPI paths often repeat a version segment already present on base_url
 * (e.g. base …/v2 + endpoint v2/payments). Strip the overlap.
 */
function dedupeEndpointAgainstBase(baseUrl: string, pathPart: string): string {
  const normalizedPath = pathPart.replace(/^\/+/, '');
  let basePath: string;
  try {
    basePath = new URL(baseUrl).pathname.replace(/\/+$/, '');
  } catch {
    return normalizedPath;
  }
  if (!basePath || basePath === '/') return normalizedPath;

  const baseSegs = basePath.split('/').filter(Boolean);
  const pathSegs = normalizedPath.split('/').filter(Boolean);

  while (
    pathSegs.length > 0 &&
    baseSegs.length > 0 &&
    pathSegs[0] === baseSegs[baseSegs.length - 1]
  ) {
    pathSegs.shift();
    baseSegs.pop();
  }

  return pathSegs.join('/');
}

function buildRequestUrl(baseUrl: string, pathPart: string): string {
  const relative = dedupeEndpointAgainstBase(baseUrl, pathPart);
  const base = baseUrl.replace(/\/+$/, '');
  if (!relative) return base;
  return `${base}/${relative}`;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** Pull a human message from common API error JSON shapes (no provider branches). */
function extractApiErrorMessage(
  data: unknown,
  rawText: string,
  statusCode: number,
): string {
  const visit = (value: unknown, depth = 0): string | undefined => {
    if (depth > 3 || value == null) return undefined;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      try {
        return visit(JSON.parse(trimmed), depth + 1) ?? trimmed;
      } catch {
        return trimmed;
      }
    }
    if (typeof value !== 'object') return undefined;
    if (Array.isArray(value)) {
      for (const item of value) {
        const message = visit(item, depth + 1);
        if (message) return message;
      }
      return undefined;
    }
    const object = value as Record<string, unknown>;
    const direct = firstNonEmptyString(
      object.message,
      object.error_description,
      object.error_message,
      object.detail,
      object.title,
      object.description,
      typeof object.error === 'string' ? object.error : undefined,
    );
    if (direct) {
      const param = firstNonEmptyString(object.param);
      return param ? `${direct} (param: ${param})` : direct;
    }
    for (const nested of [object.error, object.errors]) {
      const message = visit(nested, depth + 1);
      if (message) return message;
    }
    return undefined;
  };

  return visit(data)?.slice(0, 500) || rawText.trim().slice(0, 500) || `HTTP ${statusCode}`;
}

/**
 * Reserved keys on GenericApiCallParams — everything else is a caller-supplied
 * value that has to be routed to a request bucket.
 *
 * MUST stay identical to `INJECTED_CONTROL_PARAM_KEYS` in the backend
 * (`services/integrations/integrationRouteTemplates.ts`), which is the list the
 * injected route strips from caller input. A key honoured here but missing
 * there is settable from a request body — `connectorParity` pins the two
 * together for exactly that reason.
 */
export const CONTROL_PARAM_KEYS: ReadonlySet<string> = new Set([
  'method',
  'endpoint',
  'pathParams',
  'queryParams',
  'body',
  'contentType',
  'headers',
  'fieldLocations',
  // Workspace-pinned defaults for catalog parameters (migration 309). Platform
  // supplied, never caller supplied: it is reserved here so that the moment
  // anything starts producing it, a request body already cannot forge it.
  'paramDefaults',
]);

export interface ResolvedRequestParams {
  pathParams: Record<string, string>;
  queryParams: Record<string, unknown>;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Route a flat parameter bag into path / query / header / body buckets.
 *
 * Evidence is applied strongest-first:
 *  1. Buckets the caller set explicitly (`pathParams`, `queryParams`,
 *     `headers`, `body`) — a deliberate choice is never second-guessed.
 *  2. `fieldLocations` from the action's input schema, i.e. the vendor's own
 *     OpenAPI `in` values.
 *  3. Heuristic, for actions seeded before locations were recorded: a key
 *     matching a `{placeholder}` in the endpoint is a path param; on GET and
 *     DELETE the remainder are query params (those methods carry no body);
 *     otherwise the remainder is the body.
 *
 * Step 3 is what the connectors already did implicitly, minus two failures it
 * removes: flat params on a GET were collected into a body the fetch then
 * discarded (the values vanished with no error), and a flat `{id}` never
 * reached the URL template (400 on an unresolved placeholder).
 */
export function resolveRequestParams(
  params: GenericApiCallParams,
  endpointTemplate: string,
  method: string,
): ResolvedRequestParams {
  const pathParams: Record<string, string> = Object.fromEntries(
    Object.entries((params.pathParams ?? {}) as Record<string, unknown>).map(
      ([key, value]) => [key, String(value ?? '')],
    ),
  );
  const queryParams: Record<string, unknown> = { ...((params.queryParams ?? {}) as Record<string, unknown>) };
  const headers: Record<string, string> = { ...((params.headers ?? {}) as Record<string, string>) };

  // Catalog data decides these buckets, and catalog data can be wrong: the
  // locations are imported from vendor OpenAPI documents and backfilled by
  // script. Two failure modes were fatal and invisible —
  //
  //   an out-of-enum value (Swagger 2.0 'formData', OAS3 'cookie') matched no
  //   branch below and silently fell through to the body;
  //
  //   a stored 'body' on a key that is a {placeholder} in the endpoint left the
  //   placeholder unfilled, so literal braces went to the vendor.
  //
  // Ignoring a bad value and falling back to the heuristic makes a future
  // catalog error survivable instead of a broken request nobody can explain.
  const VALID_LOCATIONS = new Set(['path', 'query', 'body', 'header']);
  const templatePlaceholders = new Set(
    [...endpointTemplate.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]),
  );
  const locationByKey = new Map(
    (params.fieldLocations ?? [])
      .filter((field) => {
        if (!field.key || !field.location) return false;
        if (!VALID_LOCATIONS.has(field.location)) return false;
        // A path placeholder is a fact about the URL, not an opinion.
        if (field.location !== 'path' && templatePlaceholders.has(field.key)) {
          return false;
        }
        return true;
      })
      .map((field) => [field.key, field.location!] as const),
  );
  const placeholders = new Set(
    [...endpointTemplate.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]),
  );
  const methodUpper = method.toUpperCase();
  const bodyless = methodUpper === 'GET' || methodUpper === 'DELETE';

  // Workspace-pinned defaults fill gaps the caller left (migration 309).
  //
  // Two gates, both here rather than trusted to the producer. A default is only
  // applied to a key the action DECLARES — `fieldLocations` is the action's own
  // input schema, so no schema means no fill, because absence of evidence is
  // not permission. And it never overrides a value the caller supplied, in any
  // bucket: an explicit `pathParams.id` or a flat `id` both win over a pin.
  const declaredKeys = new Set((params.fieldLocations ?? []).map((field) => field.key));
  const defaults = (params.paramDefaults ?? {}) as Record<string, unknown>;
  const filledFromDefaults: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (CONTROL_PARAM_KEYS.has(key)) continue;
    if (!declaredKeys.has(key)) continue;
    if (params[key] !== undefined) continue;
    if (pathParams[key] !== undefined) continue;
    if (queryParams[key] !== undefined) continue;
    if (headers[key] !== undefined) continue;
    filledFromDefaults[key] = value;
  }

  // An explicit `body` means the caller has already decided what the body is;
  // flat keys alongside it are routing metadata, not more body fields.
  const bodyFromFlat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ ...filledFromDefaults, ...params })) {
    if (CONTROL_PARAM_KEYS.has(key)) continue;

    const location =
      locationByKey.get(key) ?? (placeholders.has(key) ? 'path' : bodyless ? 'query' : 'body');

    if (location === 'path') {
      if (pathParams[key] === undefined) pathParams[key] = String(value ?? '');
    } else if (location === 'query') {
      if (queryParams[key] === undefined) queryParams[key] = value;
    } else if (location === 'header') {
      if (headers[key] === undefined) headers[key] = String(value ?? '');
    } else {
      bodyFromFlat[key] = value;
    }
  }

  const body =
    params.body !== undefined
      ? params.body
      : Object.keys(bodyFromFlat).length > 0
        ? bodyFromFlat
        : undefined;

  return { pathParams, queryParams, headers, body };
}

function isTruthySandboxFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

function isExplicitProduction(custom: ConnectorCustom): boolean {
  const env = String(custom.api_environment ?? custom.environment ?? '').trim().toLowerCase();
  return env === 'production' || env === 'prod';
}

function readEnv(key: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[key];
}

/** Whether to call sandbox_base_url first (mirrors backend integrationGenericApiCall). */
function shouldUseSandboxFirst(
  slug: string,
  provider: ProviderConfig,
  custom: ConnectorCustom,
): boolean {
  if (!provider.sandboxBaseUrl) return false;
  if (isExplicitProduction(custom)) return false;
  const sandboxEnv = readEnv(`${slug.toUpperCase()}_USE_SANDBOX`);
  return (
    isTruthySandboxFlag(custom.use_sandbox) ||
    isTruthySandboxFlag(custom.sandbox) ||
    String(custom.api_environment ?? custom.environment ?? '').trim().toLowerCase() === 'sandbox' ||
    sandboxEnv === 'true' ||
    sandboxEnv === '1'
  );
}

interface PreparedProviderRequest {
  slug: string;
  provider: ProviderConfig;
  method: string;
  url: string;
  headers: Record<string, string>;
  fetchOptions: RequestInit;
}

async function executePreparedRequest(
  prepared: PreparedProviderRequest,
): Promise<{ success: boolean; statusCode: number; data: unknown; errorMessage?: string }> {
  const { provider, url, fetchOptions } = prepared;

  const res = await fetch(url, fetchOptions);
  const text = await res.text();

  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Keep as text
  }

  let success = res.ok;
  let errorMessage: string | undefined;

  if (typeof data === 'object' && data !== null) {
    const object = data as { ok?: boolean; error?: { message?: string } | string };
    if (object.ok === false) {
      success = false;
    }
    if (
      typeof object.error === 'object' &&
      object.error !== null &&
      firstNonEmptyString(object.error.message)
    ) {
      success = false;
    }
  }

  if (!success) {
    errorMessage =
      errorMessage ||
      extractApiErrorMessage(data, text, res.status);
  }

  return { success, statusCode: res.status, data, errorMessage };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Connector Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute an integration API call.
 *
 * @param slug - Provider slug
 * @param params - Request parameters including endpoint, method, body, etc.
 * @param auth - Authentication credentials
 * @param custom - Custom settings
 */
export async function runIntegration(
  slug: string,
  params: GenericApiCallParams,
  auth: ConnectorAuth,
  custom: ConnectorCustom = {}
): Promise<ConnectorResultWithDuration> {
  const t0 = getStartTime();

  // Provider lookup uses the shared sandbox registry — must stay aligned with
  // apps/backend/src/config/providerRegistry.ts for every slug runIntegration() supports.
  const provider = getProvider(slug);
  if (!provider) {
    return {
      success: false,
      statusCode: 404,
      data: null,
      durationMs: nowMs(t0),
      errorMessage: `Unknown provider "${slug}". Check the integration slug.`,
    };
  }

  return runIntegrationWithProvider(provider, params, auth, custom);
}

/**
 * Execute using provider configuration supplied by a registry or runtime
 * manifest. This is the canonical dynamic transport entry point.
 */
export async function runIntegrationWithProvider(
  provider: ProviderConfig,
  params: GenericApiCallParams,
  auth: ConnectorAuth,
  custom: ConnectorCustom = {},
): Promise<ConnectorResultWithDuration> {
  const t0 = getStartTime();
  const slug = provider.slug;

  // Validate authentication
  const authError = validateAuth(provider, auth);
  if (authError) {
    return {
      success: false,
      statusCode: 401,
      data: null,
      durationMs: nowMs(t0),
      errorMessage: authError,
    };
  }

  // Parse request parameters
  const method = (params.method || 'GET').toUpperCase();
  const endpoint = String(params.endpoint || '').replace(/^\/+/, '');
  const routed = resolveRequestParams(params, endpoint, method);
  const pathParams = routed.pathParams;
  const queryParams = routed.queryParams;
  const extraHeaders = routed.headers;

  // Apply deep JSON string parsing (backend parity) — handles textarea inputs
  // where users type JSON as strings.
  let body = deepParseJsonStrings(routed.body);

  // Validate endpoint (prevent path traversal and absolute URLs)
  if (/^https?:\/\//i.test(String(params.endpoint || ''))) {
    return {
      success: false,
      statusCode: 400,
      data: null,
      durationMs: nowMs(t0),
      errorMessage:
        'endpoint must be relative (no http(s)://); the server chooses the API host',
    };
  }
  if (endpoint.includes('..')) {
    return {
      success: false,
      statusCode: 400,
      data: null,
      durationMs: nowMs(t0),
      errorMessage: 'Path traversal is not allowed in endpoint.',
    };
  }

  // Resolve every URL placeholder from explicit path params, credentials, or
  // custom settings. This works for all providers without slug-specific code.
  const templates = `${provider.baseUrl}/${endpoint}`;
  for (const match of templates.matchAll(/\{([^}]+)\}/g)) {
    const key = match[1];
    if (!key || pathParams[key]) continue;
    const value = lookupDynamicValue(
      key,
      pathParams,
      auth as Record<string, unknown>,
      custom,
    );
    if (value !== undefined && value !== null && String(value).trim()) {
      pathParams[key] = String(value).trim();
    }
  }

  // Build URL — honour sandbox host when custom_settings or env flags request it
  const useSandboxFirst = shouldUseSandboxFirst(slug, provider, custom);
  let baseUrl = useSandboxFirst && provider.sandboxBaseUrl
    ? provider.sandboxBaseUrl
    : provider.baseUrl;

  // Everything that can fail while ASSEMBLING the URL returns 400 from here.
  //
  // The endpoint leg always did. The base-URL leg and `new URL()` did not, and
  // both throw: `interpolateUrl` with throwOnUnresolved=true throws on a
  // `{placeholder}` no credential satisfies, and the URL constructor throws on
  // anything malformed. Nothing upstream catches — `runIntegration` is called
  // bare by the generated app's route — so a provider whose base URL is wrong
  // produced a 500 with a stack from inside the tenant's app instead of a
  // structured failure. That asymmetry only survived because base URLs were
  // hand-written in a registry; they are about to become operator-editable.
  //
  // Messages are deliberately built here rather than forwarded: a base URL can
  // legitimately carry a secret in its path (telegram is
  // `https://api.telegram.org/bot{bot_token}`), so the value never goes into an
  // error string that reaches a caller or a log.
  let resolvedEndpoint: string;
  let url: URL;
  try {
    // Resolve dynamic base URLs from registry placeholders.
    try {
      baseUrl = interpolateUrl(baseUrl, pathParams, auth, true, false);
    } catch {
      throw new Error(
        `Provider "${slug}" has a base URL with unresolved placeholders. ` +
          `Check that every {placeholder} names a configured credential field.`,
      );
    }

    // Use throwOnUnresolved=true to catch missing path params early
    resolvedEndpoint = interpolateUrl(endpoint, pathParams, auth, true);

    try {
      url = new URL(buildRequestUrl(baseUrl, resolvedEndpoint));
    } catch {
      throw new Error(
        `Provider "${slug}" produced an invalid request URL. Check its base URL configuration.`,
      );
    }
  } catch (e: unknown) {
    return {
      success: false,
      statusCode: 400,
      data: null,
      durationMs: nowMs(t0),
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }

  appendQueryParams(url, queryParams);

  // Static headers from the provider config precede auth and caller-supplied headers
  const headers: Record<string, string> = {
    ...(provider.staticHeaders ?? {}),
    ...buildAuthHeaders(provider.auth, auth),
    ...extraHeaders,
  };

  // Determine content type
  const requestContentType = params.contentType || provider.defaultContentType || 'json';
  const hasBody = body !== undefined && body !== null && !['GET', 'DELETE'].includes(method);

  // Build fetch options
  const fetchOptions: RequestInit = { method, headers };

  if (hasBody) {
    if (requestContentType === 'form') {
      fetchOptions.body = bodyToFormData(body);
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else {
      fetchOptions.body = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
  }

  const prepared: PreparedProviderRequest = {
    slug,
    provider,
    method,
    url: url.toString(),
    headers,
    fetchOptions,
  };

  // Execute request
  try {
    let result = await executePreparedRequest(prepared);

    // Sandbox tokens fail on production hosts with 401.
    // Retry once on sandboxBaseUrl when production was tried first.
    if (
      !result.success &&
      result.statusCode === 401 &&
      provider.sandboxBaseUrl &&
      !useSandboxFirst
    ) {
      const sandboxBase = interpolateUrl(
        provider.sandboxBaseUrl,
        pathParams,
        auth,
        true,
        false,
      );
      const sandboxUrl = new URL(buildRequestUrl(sandboxBase, resolvedEndpoint));
      appendQueryParams(sandboxUrl, queryParams);
      const sandboxResult = await executePreparedRequest({
        ...prepared,
        url: sandboxUrl.toString(),
      });
      if (sandboxResult.success) {
        return {
          ...sandboxResult,
          durationMs: nowMs(t0),
          errorMessage: undefined,
        };
      }
      result = sandboxResult;
    }

    return {
      success: result.success,
      statusCode: result.statusCode,
      data: result.data,
      durationMs: nowMs(t0),
      errorMessage: result.success ? undefined : result.errorMessage,
    };
  } catch (e: unknown) {
    return {
      success: false,
      statusCode: 0,
      data: null,
      durationMs: nowMs(t0),
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}
