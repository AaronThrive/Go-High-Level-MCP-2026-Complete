import type { GHLConfig, GHLUserType } from './types/ghl-types.js';

/**
 * Builds configuration for an HTTP caller-provided token.
 *
 * A replacement token is independent from the server's configured token, so
 * its preflight scope must never be inherited. Callers may opt into preflight
 * by supplying x-ghl-user-type for that exact token.
 */
export function createPerRequestConfig(
  baseConfig: GHLConfig,
  accessToken: string,
  locationId: string,
  requestedUserType: unknown,
): GHLConfig {
  const userType: GHLUserType | undefined = requestedUserType === 'Company' || requestedUserType === 'Location'
    ? requestedUserType
    : undefined;

  return {
    ...baseConfig,
    accessToken,
    locationId,
    userType,
  };
}

export class RequestConfigError extends Error {}

/** Reject incomplete overrides rather than silently using the server account. */
export function resolveRequestConfig(base: GHLConfig, headers: Record<string, unknown>): GHLConfig {
  const token = headers['x-ghl-access-token'];
  const location = headers['x-ghl-location-id'];
  const userType = headers['x-ghl-user-type'];
  if (token === undefined && location === undefined && userType === undefined) return base;
  if (typeof token !== 'string' || !token.trim() || typeof location !== 'string' || !location.trim()) {
    throw new RequestConfigError('Supply both x-ghl-access-token and x-ghl-location-id as non-empty headers');
  }
  if (userType !== undefined && userType !== 'Location' && userType !== 'Company') {
    throw new RequestConfigError('x-ghl-user-type must be Location or Company');
  }
  return createPerRequestConfig(base, token.trim(), location.trim(), userType);
}
