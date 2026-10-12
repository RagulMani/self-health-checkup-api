/**
 * Integration Connectors - Dynamic connector system for all integrations.
 *
 * This module provides a single generic connector that can handle any integration
 * dynamically based on provider configuration and action metadata.
 */

// Export types
export * from './types';

// Export provider registry
export * from './providerRegistry';

// Export registry-lookup and provider-config execution entry points.
export { runIntegration, runIntegrationWithProvider } from './connector';

export { normalizeConnectorAuthCreds } from './authNormalize';

// Shared param routing — the backend connector imports this so both paths
// bucket parameters identically.
export {
  resolveRequestParams,
  CONTROL_PARAM_KEYS,
  type ResolvedRequestParams,
} from './connector';
