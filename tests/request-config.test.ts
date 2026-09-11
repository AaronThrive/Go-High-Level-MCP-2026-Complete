import { describe, expect, it } from '@jest/globals';
import { createPerRequestConfig } from '../src/request-config.js';

const base = {
  accessToken: 'server-token',
  baseUrl: 'https://services.leadconnectorhq.com',
  version: 'v3',
  locationId: 'server-location',
  apiGeneration: 'v3' as const,
  userType: 'Company' as const,
};

describe('createPerRequestConfig', () => {
  it('does not inherit the server token userType for an override token', () => {
    expect(createPerRequestConfig(base, 'request-token', 'request-location', undefined)).toEqual({
      ...base,
      accessToken: 'request-token',
      locationId: 'request-location',
      userType: undefined,
    });
  });

  it.each(['Location', 'Company'] as const)('accepts a declared %s token type', (userType) => {
    expect(createPerRequestConfig(base, 'request-token', 'request-location', userType).userType).toBe(userType);
  });

  it('ignores invalid user type headers', () => {
    expect(createPerRequestConfig(base, 'request-token', 'request-location', 'Agency').userType).toBeUndefined();
  });
});

describe('request override boundary', () => {
  const { resolveRequestConfig } = require('../src/request-config.js');
  it.each([
    {'x-ghl-access-token':'token'}, {'x-ghl-location-id':'location'},
    {'x-ghl-user-type':'Company'}, {'x-ghl-access-token':'','x-ghl-location-id':'location'},
    {'x-ghl-access-token':['token'],'x-ghl-location-id':'location'},
    {'x-ghl-access-token':'token','x-ghl-location-id':'location','x-ghl-user-type':'invalid'},
  ])('rejects incomplete or malformed context %j', headers => { expect(()=>resolveRequestConfig(base,headers)).toThrow(); });
  it('uses the default only when no override is supplied', () => { expect(resolveRequestConfig(base,{})).toBe(base); });
  it('binds the replacement token and location together', () => {
    expect(resolveRequestConfig(base,{'x-ghl-access-token':'new-token','x-ghl-location-id':'new-location'})).toMatchObject({accessToken:'new-token',locationId:'new-location',userType:undefined});
  });
});
