/**
 * Normalize credential field names to the connector registry's expected keys.
 *
 * Dashboard execute (`buildAuthFlatFromConfig`) already maps UI/schema drift
 * (api_key, stripe_secret_key, …) onto `secret_key` for Stripe. Generated apps
 * only saw raw env suffix keys after `STRIPE_` strip — so `STRIPE_API_KEY` became
 * `api_key` and `runIntegration` failed with "Missing Stripe secret_key" while
 * the Integrations drawer still worked.
 */
import type { ProviderConfig } from './types';
import { PROVIDER_REGISTRY } from './providerRegistry';

/** Common field-name aliases → canonical connector cred keys. */
const FIELD_ALIASES: Record<string, string[]> = {
  secret_key: [
    'stripe_secret_key',
    'api_key',
    'apikey',
    'key',
    'sk',
    'secret',
    'apiKey',
  ],
  api_key: ['secret_key', 'key', 'token', 'secret', 'apikey', 'apiKey'],
  access_token: [
    'api_key',
    'token',
    'bot_token',
    'oauth_token',
    'accesstoken',
  ],
  bot_token: ['access_token', 'token', 'api_key'],
  auth_token: ['access_token', 'token', 'api_key'],
  account_sid: ['sid'],
  client_id: ['app_id'],
  client_secret: ['app_secret'],
};

function requiredCredKeys(provider: ProviderConfig): string[] {
  const auth = provider.auth;
  switch (auth.type) {
    case 'bearer':
      return [auth.credKey];
    case 'api_key_header':
      return [auth.credKey];
    case 'basic':
      return [auth.userKey, auth.passKey];
    case 'oauth2_bearer':
      return ['access_token'];
    case 'none':
    default:
      return [];
  }
}

/**
 * Ensure connector-required keys exist on a flat cred map, copying from known
 * aliases when the canonical key is missing. Never overwrites a non-empty
 * canonical value.
 */
export function normalizeConnectorAuthCreds(
  slug: string,
  creds: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds)) {
    if (typeof v === 'string' && v.trim()) {
      out[k.toLowerCase()] = v.trim();
    }
  }

  const provider = PROVIDER_REGISTRY[slug.trim().toLowerCase()];
  if (!provider) return out;

  for (const credKey of requiredCredKeys(provider)) {
    if (out[credKey]) continue;
    for (const alias of FIELD_ALIASES[credKey] ?? []) {
      const v = out[alias.toLowerCase()];
      if (v) {
        out[credKey] = v;
        break;
      }
    }
  }

  // Bearer connectors also accept access_token; mirror secret/api keys when needed.
  if (provider.auth.type === 'bearer' && !out.access_token) {
    const credKey = provider.auth.credKey;
    if (out[credKey]) out.access_token = out[credKey];
  }

  return out;
}
