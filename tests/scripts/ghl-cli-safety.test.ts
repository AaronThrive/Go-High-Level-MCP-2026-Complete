import { afterAll, describe, expect, it } from '@jest/globals';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Run the shipped CLI in an isolated package. The registry records dispatch,
// never contacts a CRM, and supplies the result shapes real tool modules use.
const root = mkdtempSync(join(tmpdir(), 'ghl-cli-safety-'));
mkdirSync(join(root, 'scripts'));
mkdirSync(join(root, 'dist'));
copyFileSync(join(__dirname, '../../scripts/ghl-mcp.mjs'), join(root, 'scripts/ghl-mcp.mjs'));
writeFileSync(join(root, 'package.json'), '{"type":"module"}');
writeFileSync(join(root, 'dist/enhanced-ghl-client.js'), 'export class EnhancedGHLClient { constructor(config) { this.config = config; } }');
writeFileSync(join(root, 'dist/tool-registry.js'), `export class ToolRegistry {
  constructor(client) { this.client = client; }
  getToolInventory() { return [{name:'create_contact',access:'write',readOnly:false}, {name:'get_contact',access:'read',readOnly:true}]; }
  getAllToolDefinitions() { return this.getToolInventory().map(t => ({...t,inputSchema:{type:'object',properties:{email:{type:'string'},locationId:{type:'string'},contactId:{type:'string'}}}})); }
  async callTool(name, args) {
    if (args.contactId === 'success-false') return {success:false,error:'provider rejected'};
    if (args.contactId === 'ok-false') return {ok:false,error:'provider rejected'};
    if (args.contactId === 'mcp-error') return {isError:true,content:[{type:'text',text:'provider rejected'}]};
    if (args.contactId === 'secret-error') throw new Error('failed with ' + this.client.config.accessToken);
    return {dispatched:true,locationId:this.client.config.locationId,args};
  }
}`);
writeFileSync(join(root, '.env'), 'GHL_API_KEY=repo-token\nGHL_LOCATION_ID=repo-location\n');
writeFileSync(join(root, 'partial.env'), 'GHL_LOCATION_ID=location-B\n');
writeFileSync(join(root, 'complete.env'), 'GHL_API_KEY=token-B\nGHL_LOCATION_ID=location-B\n');
afterAll(() => rmSync(root, {recursive:true, force:true}));
function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [join(root, 'scripts/ghl-mcp.mjs'), ...args], {
    cwd:root, encoding:'utf8', env:{PATH:process.env.PATH, GHL_API_KEY:'fake-token-A', GHL_LOCATION_ID:'location-A', ...env},
  });
}
describe('CLI safety at the dispatch boundary', () => {
  it.each(['--confirm=false', '--confirm=true', '--confirm=0'])('rejects ambiguous confirmation %s', flag => {
    const result = run(['create_contact', '--email', 'test@example.invalid', flag]);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('dispatched');
    expect(JSON.parse(result.stderr).error.message).toContain('bare --confirm');
  });
  it('requires confirmation and permits an explicitly confirmed write', () => {
    expect(run(['create_contact', '--email', 'test@example.invalid']).status).toBe(1);
    const allowed = run(['create_contact', '--email', 'test@example.invalid', '--confirm']);
    expect(allowed.status).toBe(0);
    expect(JSON.parse(allowed.stdout).result.dispatched).toBe(true);
  });
  it.each(['success-false', 'ok-false', 'mcp-error'])('returns nonzero for %s tool results', contactId => {
    const result = run(['get_contact', '--contact-id', contactId]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({ok:false,error:{message:'provider rejected'}});
  });
  it('does not refill an incomplete explicit profile from inherited or repo credentials', () => {
    const result = run(['get_contact', '--env-file', join(root, 'partial.env')]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr).error.message).toContain('GHL_API_KEY is required');
  });
  it('isolates GHL_ENV_FILE and lets --env-file take precedence', () => {
    const env = {GHL_ENV_FILE:join(root, 'partial.env')};
    expect(run(['get_contact'], env).status).toBe(1);
    const result = run(['get_contact', '--env-file', join(root, 'complete.env')], env);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).result.locationId).toBe('location-B');
  });
  it('preserves skip-dotenv on a machine with a populated .env', () => {
    const result = run(['get_contact'], {GHL_SKIP_DOTENV:'1', GHL_API_KEY:'', GHL_LOCATION_ID:''});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('GHL_API_KEY is required');
  });
  it('does not dispatch a dry run and redacts thrown credentials', () => {
    const dry = run(['create_contact', '--dry-run']);
    expect(dry.status).toBe(0);
    expect(JSON.parse(dry.stdout)).toMatchObject({dryRun:true,wouldRequireConfirmation:true});
    expect(dry.stdout).not.toContain('dispatched');
    const error = run(['get_contact', '--contact-id', 'secret-error']);
    expect(error.status).toBe(1);
    expect(error.stderr).not.toContain('fake-token-A');
  });
});
