/**
 * Types for the dynamic integration connector system.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Result Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ConnectorResult {
  success: boolean;
  statusCode: number;
  data: unknown;
  errorMessage?: string;
}

export interface ConnectorResultWithDuration extends ConnectorResult {
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ConnectorAuth {
  api_key?: string;
  secret_key?: string;
  access_token?: string;
  account_sid?: string;
  auth_token?: string;
  bot_token?: string;
  from_number?: string;
  base_id?: string;
  [key: string]: string | undefined;
}

export interface ConnectorCustom {
  from_email?: string;
  from_name?: string;
  spreadsheet_id?: string;
  table?: string;
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider Registry Types
// ─────────────────────────────────────────────────────────────────────────────

export type AuthPattern =
  | { type: 'bearer'; credKey: string }
  | { type: 'api_key_header'; credKey: string; headerName: string; valuePrefix?: string }
  | { type: 'basic'; userKey: string; passKey: string }
  | { type: 'oauth2_bearer' }
  | { type: 'none' };

export interface ProviderConfig {
  slug: string;
  name: string;
  baseUrl: string;
  auth: AuthPattern;
  defaultContentType?: 'json' | 'form';
  /** Static headers appended to every request (e.g. Square-Version). Mirrors backend static_headers. */
  staticHeaders?: Record<string, string>;
  /** Sandbox API host; used when custom_settings or env flags request sandbox, or on 401 retry. */
  sandboxBaseUrl?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ActionDefinition {
  slug: string;
  httpMethod: string;
  endpointTemplate: string;
  inputFields?: string[];
}

/**
 * Where a field travels in the HTTP request. Mirrors OpenAPI's `in` and the
 * backend's `IntegrationActionInputField['location']` — keep the two in sync.
 */
export type ParamLocation = 'path' | 'query' | 'body' | 'header';

/**
 * The subset of an action's input schema the connector needs to route a field
 * to the right part of the request.
 */
export interface ActionFieldLocation {
  key: string;
  location?: ParamLocation;
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parameters for generic api_call action.
 * When using named actions, these are derived from the action metadata.
 */
export interface GenericApiCallParams {
  /** HTTP method (GET, POST, PUT, PATCH, DELETE) */
  method?: string;
  /** Relative endpoint path (e.g., "mail/send" or "v1/customers") */
  endpoint?: string;
  /** Path parameter substitutions for {placeholder} tokens */
  pathParams?: Record<string, string>;
  /** Query string parameters */
  queryParams?: Record<string, unknown>;
  /** Request body */
  body?: unknown;
  /** Content type override: 'json' or 'form' */
  contentType?: 'json' | 'form';
  /** Additional headers */
  headers?: Record<string, string>;
  /**
   * Per-field request bucket from `integration_action_master.input_schema`.
   * When supplied, flat params are routed by this rather than by the
   * method/endpoint heuristic — which is what stops query params being dropped
   * on GET and `{id}` placeholders going unsubstituted.
   */
  fieldLocations?: ActionFieldLocation[];
  /**
   * Workspace-pinned values for catalog parameters the caller did not supply
   * (migration 309) — `from_email`, `channel_id`, `project_id` and the like.
   *
   * Platform-supplied only. It is a control key on both sides of the wire, so
   * a caller cannot set it: the injected route strips it from the request body
   * before the connector ever sees the payload. A caller who could set it would
   * be choosing the values for every action of that provider.
   */
  paramDefaults?: Record<string, unknown>;
  /** Any other fields are treated as body when body is not specified */
  [key: string]: unknown;
}
