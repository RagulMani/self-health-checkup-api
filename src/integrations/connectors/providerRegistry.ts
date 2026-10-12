/**
 * Sandbox runtime provider registry — used by runIntegration() in generated apps.
 *
 * Dual-registry contract:
 * - Backend apps/backend/src/config/providerRegistry.ts is the catalog/UI/OpenAPI
 *   source of truth (credential fields, OpenAPI URLs, DB seed metadata).
 * - This file must include every slug that generated apps call via runIntegration().
 *   When adding a provider to the backend registry, also add a minimal runtime entry
 *   here: slug, baseUrl, auth, defaultContentType, staticHeaders, sandboxBaseUrl.
 *
 * Action definitions still come from integration_action_master / tenant registry.
 */

import type { ProviderConfig } from './types';

export const PROVIDER_REGISTRY: Record<string, ProviderConfig> = {
  // ─────────────────────────────────────────────────────────────────────────────
  // Communication
  // ─────────────────────────────────────────────────────────────────────────────

  sendgrid: {
    slug: 'sendgrid',
    name: 'SendGrid',
    baseUrl: 'https://api.sendgrid.com/v3',
    auth: { type: 'bearer', credKey: 'api_key' },
  },

  slack: {
    slug: 'slack',
    name: 'Slack',
    baseUrl: 'https://slack.com/api',
    auth: { type: 'bearer', credKey: 'bot_token' },
  },

  twilio: {
    slug: 'twilio',
    name: 'Twilio',
    baseUrl: 'https://api.twilio.com/2010-04-01',
    auth: { type: 'basic', userKey: 'account_sid', passKey: 'auth_token' },
    defaultContentType: 'form',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Payments
  // ─────────────────────────────────────────────────────────────────────────────

  stripe: {
    slug: 'stripe',
    name: 'Stripe',
    baseUrl: 'https://api.stripe.com',
    auth: { type: 'bearer', credKey: 'secret_key' },
    defaultContentType: 'form',
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // CRM
  // ─────────────────────────────────────────────────────────────────────────────

  hubspot: {
    slug: 'hubspot',
    name: 'HubSpot',
    baseUrl: 'https://api.hubapi.com',
    auth: { type: 'oauth2_bearer' },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Databases
  // ─────────────────────────────────────────────────────────────────────────────

  airtable: {
    slug: 'airtable',
    name: 'Airtable',
    baseUrl: 'https://api.airtable.com',
    auth: { type: 'bearer', credKey: 'api_key' },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Google
  // ─────────────────────────────────────────────────────────────────────────────

  google_sheets: {
    slug: 'google_sheets',
    name: 'Google Sheets',
    baseUrl: 'https://sheets.googleapis.com/v4',
    auth: { type: 'oauth2_bearer' },
  },

  google_calendar: {
    slug: 'google_calendar',
    name: 'Google Calendar',
    baseUrl: 'https://www.googleapis.com/calendar/v3',
    auth: { type: 'oauth2_bearer' },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // AI & ML
  // ─────────────────────────────────────────────────────────────────────────────

  openai: {
    slug: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    auth: { type: 'bearer', credKey: 'api_key' },
  },

  anthropic: {
    slug: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    auth: { type: 'api_key_header', credKey: 'api_key', headerName: 'x-api-key' },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // E-commerce
  // ─────────────────────────────────────────────────────────────────────────────

  shopify: {
    slug: 'shopify',
    name: 'Shopify',
    baseUrl: 'https://{shop_domain}/admin/api/2024-01',
    auth: { type: 'bearer', credKey: 'access_token' },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Marketing
  // ─────────────────────────────────────────────────────────────────────────────

  mailchimp: {
    slug: 'mailchimp',
    name: 'Mailchimp',
    baseUrl: 'https://{dc}.api.mailchimp.com/3.0',
    auth: { type: 'bearer', credKey: 'api_key' },
  },

  klaviyo: {
    slug: 'klaviyo',
    name: 'Klaviyo',
    baseUrl: 'https://a.klaviyo.com/api',
    auth: { type: 'api_key_header', credKey: 'api_key', headerName: 'Authorization', valuePrefix: 'Klaviyo-API-Key ' },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Project Management
  // ─────────────────────────────────────────────────────────────────────────────

  notion: {
    slug: 'notion',
    name: 'Notion',
    baseUrl: 'https://api.notion.com/v1',
    auth: { type: 'bearer', credKey: 'api_key' },
  },

  linear: {
    slug: 'linear',
    name: 'Linear',
    baseUrl: 'https://api.linear.app',
    auth: { type: 'bearer', credKey: 'api_key' },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Cloud Storage
  // ─────────────────────────────────────────────────────────────────────────────

  dropbox: {
    slug: 'dropbox',
    name: 'Dropbox',
    baseUrl: 'https://api.dropboxapi.com/2',
    auth: { type: 'oauth2_bearer' },
  },

  google_drive: {
    slug: 'google_drive',
    name: 'Google Drive',
    baseUrl: 'https://www.googleapis.com/drive/v3',
    auth: { type: 'oauth2_bearer' },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Social
  // ─────────────────────────────────────────────────────────────────────────────

  github: {
    slug: 'github',
    name: 'GitHub',
    baseUrl: 'https://api.github.com',
    auth: { type: 'bearer', credKey: 'access_token' },
  },

  discord: {
    slug: 'discord',
    name: 'Discord',
    baseUrl: 'https://discord.com/api/v10',
    // `Bot <token>`, never `Bearer` — see the backend registry entry. At
    // runtime the manifest's auth (built from the backend registry) overrides
    // this via `registerProviders`, so this copy is a fallback; it is fixed
    // here so the two cannot disagree and mislead the next reader.
    auth: {
      type: 'api_key_header',
      credKey: 'bot_token',
      headerName: 'Authorization',
      valuePrefix: 'Bot ',
    },
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Additional providers (synced from backend providerRegistry.ts)
  // ─────────────────────────────────────────────────────────────────────────────

  gitlab: {
    slug: 'gitlab',
    name: 'GitLab',
    baseUrl: 'https://gitlab.com/api/v4',
    auth: { type: 'bearer', credKey: 'access_token' },
  },

  vercel: {
    slug: 'vercel',
    name: 'Vercel',
    baseUrl: 'https://api.vercel.com',
    auth: { type: 'bearer', credKey: 'access_token' },
  },

  jira: {
    slug: 'jira',
    name: 'Jira',
    baseUrl: 'https://{domain}.atlassian.net/rest/api/3',
    auth: { type: 'basic', userKey: 'email', passKey: 'api_token' },
  },

  paypal: {
    slug: 'paypal',
    name: 'PayPal',
    baseUrl: 'https://api-m.paypal.com',
    sandboxBaseUrl: 'https://api-m.sandbox.paypal.com',
    auth: { type: 'oauth2_bearer' },
  },

  zoom: {
    slug: 'zoom',
    name: 'Zoom',
    baseUrl: 'https://api.zoom.us/v2',
    auth: { type: 'oauth2_bearer' },
  },

  freshdesk: {
    slug: 'freshdesk',
    name: 'Freshdesk',
    baseUrl: 'https://{domain}.freshdesk.com/api/v2',
    auth: { type: 'basic', userKey: 'api_key', passKey: 'password' },
  },

  intercom: {
    slug: 'intercom',
    name: 'Intercom',
    baseUrl: 'https://api.intercom.io',
    staticHeaders: { 'Intercom-Version': '2.11' },
    auth: { type: 'bearer', credKey: 'access_token' },
  },

  mixpanel: {
    slug: 'mixpanel',
    name: 'Mixpanel',
    baseUrl: 'https://mixpanel.com/api/2.0',
    auth: { type: 'basic', userKey: 'service_account', passKey: 'service_account_secret' },
  },

  segment: {
    slug: 'segment',
    name: 'Segment',
    baseUrl: 'https://api.segmentapis.com',
    auth: { type: 'bearer', credKey: 'access_token' },
  },

  posthog: {
    slug: 'posthog',
    name: 'PostHog',
    baseUrl: 'https://app.posthog.com/api',
    auth: { type: 'bearer', credKey: 'api_key' },
  },

  resend: {
    slug: 'resend',
    name: 'Resend',
    baseUrl: 'https://api.resend.com',
    auth: { type: 'bearer', credKey: 'api_key' },
  },

  typeform: {
    slug: 'typeform',
    name: 'Typeform',
    baseUrl: 'https://api.typeform.com',
    auth: { type: 'bearer', credKey: 'access_token' },
  },

  calendly: {
    slug: 'calendly',
    name: 'Calendly',
    baseUrl: 'https://api.calendly.com',
    auth: { type: 'bearer', credKey: 'access_token' },
  },

  plaid: {
    slug: 'plaid',
    name: 'Plaid',
    baseUrl: 'https://production.plaid.com',
    sandboxBaseUrl: 'https://sandbox.plaid.com',
    auth: { type: 'api_key_header', credKey: 'client_id', headerName: 'PLAID-CLIENT-ID' },
  },

  quickbooks: {
    slug: 'quickbooks',
    name: 'QuickBooks',
    baseUrl: 'https://quickbooks.api.intuit.com/v3',
    sandboxBaseUrl: 'https://sandbox-quickbooks.api.intuit.com/v3',
    auth: { type: 'oauth2_bearer' },
  },

  monday: {
    slug: 'monday',
    name: 'Monday.com',
    baseUrl: 'https://api.monday.com/v2',
    auth: { type: 'bearer', credKey: 'api_key' },
  },

  asana: {
    slug: 'asana',
    name: 'Asana',
    baseUrl: 'https://app.asana.com/api/1.0',
    auth: { type: 'bearer', credKey: 'access_token' },
  },

  trello: {
    slug: 'trello',
    name: 'Trello',
    baseUrl: 'https://api.trello.com/1',
    auth: { type: 'bearer', credKey: 'access_token' },
  },

  razorpay: {
    slug: 'razorpay',
    name: 'Razorpay',
    baseUrl: 'https://api.razorpay.com/v1',
    auth: { type: 'basic', userKey: 'key_id', passKey: 'key_secret' },
  },

  square: {
    slug: 'square',
    name: 'Square',
    baseUrl: 'https://connect.squareup.com/v2',
    sandboxBaseUrl: 'https://connect.squareupsandbox.com/v2',
    staticHeaders: { 'Square-Version': '2024-01-18' },
    auth: { type: 'bearer', credKey: 'access_token' },
  },

  woocommerce: {
    slug: 'woocommerce',
    name: 'WooCommerce',
    baseUrl: '{store_url}/wp-json/wc/v3',
    auth: { type: 'basic', userKey: 'consumer_key', passKey: 'consumer_secret' },
  },

  bigcommerce: {
    slug: 'bigcommerce',
    name: 'BigCommerce',
    baseUrl: 'https://api.bigcommerce.com/stores/{store_hash}/v2',
    auth: { type: 'api_key_header', credKey: 'access_token', headerName: 'X-Auth-Token' },
  },

  salesforce: {
    slug: 'salesforce',
    name: 'Salesforce',
    baseUrl: 'https://login.salesforce.com/services/data/v58.0',
    sandboxBaseUrl: 'https://test.salesforce.com/services/data/v58.0',
    auth: { type: 'oauth2_bearer' },
  },

  pipedrive: {
    slug: 'pipedrive',
    name: 'Pipedrive',
    baseUrl: 'https://api.pipedrive.com/v1',
    auth: { type: 'bearer', credKey: 'api_token' },
  },

  zendesk: {
    slug: 'zendesk',
    name: 'Zendesk',
    baseUrl: 'https://{subdomain}.zendesk.com/api/v2',
    auth: { type: 'basic', userKey: 'email', passKey: 'api_token' },
  },

  microsoft_teams: {
    slug: 'microsoft_teams',
    name: 'Microsoft Teams',
    baseUrl: 'https://graph.microsoft.com/v1.0',
    auth: { type: 'oauth2_bearer' },
  },

  gmail: {
    slug: 'gmail',
    name: 'Gmail',
    baseUrl: 'https://gmail.googleapis.com/gmail/v1/users/me',
    auth: { type: 'oauth2_bearer' },
  },

  outlook: {
    slug: 'outlook',
    name: 'Outlook',
    baseUrl: 'https://graph.microsoft.com/v1.0/me',
    auth: { type: 'oauth2_bearer' },
  },

  office_365: {
    slug: 'office_365',
    name: 'Office 365',
    baseUrl: 'https://graph.microsoft.com/v1.0',
    auth: { type: 'oauth2_bearer' },
  },

  onedrive: {
    slug: 'onedrive',
    name: 'OneDrive',
    baseUrl: 'https://graph.microsoft.com/v1.0/me/drive',
    auth: { type: 'oauth2_bearer' },
  },

  box: {
    slug: 'box',
    name: 'Box',
    baseUrl: 'https://api.box.com/2.0',
    auth: { type: 'oauth2_bearer' },
  },

  bitbucket: {
    slug: 'bitbucket',
    name: 'Bitbucket',
    baseUrl: 'https://api.bitbucket.org/2.0',
    auth: { type: 'basic', userKey: 'username', passKey: 'app_password' },
  },

  google_forms: {
    slug: 'google_forms',
    name: 'Google Forms',
    baseUrl: 'https://forms.googleapis.com/v1',
    auth: { type: 'oauth2_bearer' },
  },

  jotform: {
    slug: 'jotform',
    name: 'JotForm',
    baseUrl: 'https://api.jotform.com',
    auth: { type: 'api_key_header', credKey: 'api_key', headerName: 'APIKEY' },
  },

  google_meet: {
    slug: 'google_meet',
    name: 'Google Meet',
    baseUrl: 'https://meet.googleapis.com/v2',
    auth: { type: 'oauth2_bearer' },
  },

  teams_meetings: {
    slug: 'teams_meetings',
    name: 'Teams Meetings',
    baseUrl: 'https://graph.microsoft.com/v1.0',
    auth: { type: 'oauth2_bearer' },
  },

  hubspot_marketing: {
    slug: 'hubspot_marketing',
    name: 'HubSpot Marketing',
    baseUrl: 'https://api.hubapi.com',
    auth: { type: 'oauth2_bearer' },
  },

  google_analytics: {
    slug: 'google_analytics',
    name: 'Google Analytics',
    baseUrl: 'https://analyticsdata.googleapis.com/v1beta',
    auth: { type: 'oauth2_bearer' },
  },

  auth0: {
    slug: 'auth0',
    name: 'Auth0',
    baseUrl: 'https://{domain}/api/v2',
    auth: { type: 'basic', userKey: 'client_id', passKey: 'client_secret' },
  },

  clerk: {
    slug: 'clerk',
    name: 'Clerk',
    baseUrl: 'https://api.clerk.com/v1',
    auth: { type: 'bearer', credKey: 'secret_key' },
  },

  braintree: {
    slug: 'braintree',
    name: 'Braintree',
    baseUrl: 'https://api.braintreegateway.com',
    sandboxBaseUrl: 'https://api.sandbox.braintreegateway.com',
    auth: { type: 'basic', userKey: 'public_key', passKey: 'private_key' },
  },

  magento: {
    slug: 'magento',
    name: 'Magento',
    baseUrl: '{store_url}/rest/V1',
    auth: { type: 'bearer', credKey: 'access_token' },
  },

  zoho_crm: {
    slug: 'zoho_crm',
    name: 'Zoho CRM',
    baseUrl: 'https://www.zohoapis.com/crm/v3',
    auth: { type: 'oauth2_bearer' },
  },

  help_scout: {
    slug: 'help_scout',
    name: 'Help Scout',
    baseUrl: 'https://api.helpscout.net/v2',
    auth: { type: 'bearer', credKey: 'api_key' },
  },

  telegram: {
    slug: 'telegram',
    name: 'Telegram',
    baseUrl: 'https://api.telegram.org/bot{bot_token}',
    auth: { type: 'bearer', credKey: 'bot_token' },
  },

  aws_s3: {
    slug: 'aws_s3',
    name: 'AWS S3',
    baseUrl: 'https://s3.amazonaws.com',
    auth: { type: 'api_key_header', credKey: 'access_key_id', headerName: 'Authorization' },
  },

  surveymonkey: {
    slug: 'surveymonkey',
    name: 'SurveyMonkey',
    baseUrl: 'https://api.surveymonkey.com/v3',
    auth: { type: 'oauth2_bearer' },
  },

  webex: {
    slug: 'webex',
    name: 'Webex',
    baseUrl: 'https://webexapis.com/v1',
    auth: { type: 'oauth2_bearer' },
  },

  activecampaign: {
    slug: 'activecampaign',
    name: 'ActiveCampaign',
    baseUrl: '{api_url}/api/3',
    auth: { type: 'api_key_header', credKey: 'api_key', headerName: 'Api-Token' },
  },

  amplitude: {
    slug: 'amplitude',
    name: 'Amplitude',
    baseUrl: 'https://amplitude.com/api/2',
    auth: { type: 'basic', userKey: 'api_key', passKey: 'secret_key' },
  },

  xero: {
    slug: 'xero',
    name: 'Xero',
    baseUrl: 'https://api.xero.com/api.xro/2.0',
    auth: { type: 'oauth2_bearer' },
  },

  vonage: {
    slug: 'vonage',
    name: 'Vonage',
    baseUrl: 'https://rest.nexmo.com',
    auth: { type: 'basic', userKey: 'api_key', passKey: 'api_secret' },
  },

  twitter: {
    slug: 'twitter',
    name: 'Twitter/X',
    baseUrl: 'https://api.twitter.com/2',
    auth: { type: 'oauth2_bearer' },
  },

  facebook: {
    slug: 'facebook',
    name: 'Facebook/Meta',
    baseUrl: 'https://graph.facebook.com/v19.0',
    auth: { type: 'oauth2_bearer' },
  },

  google_ai: {
    slug: 'google_ai',
    name: 'Google AI',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    auth: { type: 'api_key_header', credKey: 'api_key', headerName: 'x-goog-api-key' },
  },

  firebase_auth: {
    slug: 'firebase_auth',
    name: 'Firebase Auth',
    baseUrl: 'https://identitytoolkit.googleapis.com/v1',
    auth: { type: 'bearer', credKey: 'service_account_json' },
  },
};

/**
 * Merge provider configs supplied at runtime (the injected manifest built from
 * the backend registry) over the entries compiled into this file.
 *
 * The manifest is generated data, so it is authoritative: a provider the
 * platform can call but this file has not been updated for still resolves, and
 * a base URL changed platform-side does not need a code change here.
 */
export function registerProviders(configs: ProviderConfig[]): void {
  for (const config of configs) {
    if (!config?.slug || !config.baseUrl) continue;
    PROVIDER_REGISTRY[config.slug] = { ...PROVIDER_REGISTRY[config.slug], ...config };
  }
}

/**
 * Get provider configuration by slug.
 */
export function getProvider(slug: string): ProviderConfig | undefined {
  return PROVIDER_REGISTRY[slug];
}

/**
 * Get all provider slugs.
 */
export function getProviderSlugs(): string[] {
  return Object.keys(PROVIDER_REGISTRY);
}
