import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { EnhancedGHLClient } from '../../src/enhanced-ghl-client.js';
import { GHLApiClient } from '../../src/clients/ghl-api-client.js';
const config = {accessToken:'fake',locationId:'fake',baseUrl:'https://example.invalid',version:'v3',apiGeneration:'v3' as const};
afterEach(()=>{jest.restoreAllMocks();jest.useRealTimers();});
describe('enhanced client retry and cache safety', () => {
  it.each(['POST','PUT','PATCH','DELETE'] as const)('never replays ambiguous %s failures', async method => {
    for (const status of [429,500,503]) {
      const request = jest.spyOn(GHLApiClient.prototype,'makeRequest').mockRejectedValue(Object.assign(new Error('ambiguous failure'),{response:{status}}));
      const client = new EnhancedGHLClient(config);
      await expect(client.makeRequest(method,'/contacts',{name:'fake'})).rejects.toThrow('ambiguous');
      expect(request).toHaveBeenCalledTimes(1);request.mockRestore();
    }
  });
  it('retries transient GET failures and caps retry attempts', async () => {
    jest.useFakeTimers();
    const request = jest.spyOn(GHLApiClient.prototype,'makeRequest').mockRejectedValue(Object.assign(new Error('temporary'),{response:{status:503}}));
    const promise = new EnhancedGHLClient(config).makeRequest('GET','/contacts');
    const assertion = expect(promise).rejects.toThrow('temporary');
    await jest.runAllTimersAsync(); await assertion;
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('invalidates cached reads after failed writes and token changes', async () => {
    const request = jest.spyOn(GHLApiClient.prototype,'makeRequest').mockResolvedValue({success:true,data:{id:'old'}});
    const client = new EnhancedGHLClient(config);
    await client.makeRequest('GET','/contacts/id'); await client.makeRequest('GET','/contacts/id');
    expect(request).toHaveBeenCalledTimes(1);
    request.mockRejectedValueOnce(new Error('ambiguous write'));
    await expect(client.makeRequest('POST','/contacts',{name:'new'})).rejects.toThrow();
    await client.makeRequest('GET','/contacts/id'); expect(request).toHaveBeenCalledTimes(3);
    client.updateAccessToken('new-fake-token');
    await client.makeRequest('GET','/contacts/id'); expect(request).toHaveBeenCalledTimes(4);
  });
  it('tracks rate limits on the HTTP instance actually making requests', async () => {
    const client = new EnhancedGHLClient(config);
    (client as any).axiosInstance.defaults.adapter = async (request: any) => ({data:{},status:200,statusText:'OK',headers:{'x-ratelimit-remaining':'8','x-ratelimit-limit':'100'},config:request});
    await client.makeRequest('GET','/test');
    expect(client.getCacheStats().rateLimit).toEqual({remaining:8,limit:100});
  });
});
