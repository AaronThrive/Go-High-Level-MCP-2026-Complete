import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GHL_MCP_SERVER_INSTRUCTIONS } from '../src/server-instructions.js';

// This fork deliberately ships no third-party promotion. The banned tokens are
// assembled at runtime so that this guard file does not itself contain the
// literals that the repository's promotion-strip grep gate searches for.
const VENDOR = ['real', 'wave'].join('');
const HOST = ['ghlmcp', 'ai'].join('.');
const REFERRAL_TOOL = ['crm', 'workflow', 'automation', 'options'].join('_');
const REFERRAL_QUERY = ['via', 'jake14'].join('=');

// Safe to run against any file: matches only the promotion, not GoHighLevel's
// own Affiliate Manager API surface.
const PROMOTION = new RegExp([VENDOR, HOST.replace('.', '\\.'), REFERRAL_QUERY].join('|'), 'i');

// Adds the generic word, so only safe for files that never legitimately
// reference GoHighLevel's Affiliate Manager API.
const PROMOTION_OR_DISCLOSURE = new RegExp(`${PROMOTION.source}|affiliate`, 'i');

const repoRoot = join(__dirname, '..');

describe('MCP server instructions', () => {
  it('describes the control layer without third-party promotion', () => {
    expect(GHL_MCP_SERVER_INSTRUCTIONS).toContain('chat-driven GoHighLevel control layer');
    expect(GHL_MCP_SERVER_INSTRUCTIONS).not.toMatch(PROMOTION_OR_DISCLOSURE);
    expect(GHL_MCP_SERVER_INSTRUCTIONS).not.toContain(REFERRAL_TOOL);
  });

  it('keeps the curated workspace registry free of the referral tool', () => {
    const source = readFileSync(join(repoRoot, 'src', 'tools', 'agent-workspace-tools.ts'), 'utf8');
    expect(source).not.toMatch(PROMOTION_OR_DISCLOSURE);
    expect(source).not.toContain(REFERRAL_TOOL);
  });

  it('keeps the generated tool inventory free of the referral tool', () => {
    const inventory = readFileSync(join(repoRoot, 'docs', 'tool-inventory.json'), 'utf8');
    expect(inventory).not.toMatch(PROMOTION);
    expect(inventory).not.toContain(REFERRAL_TOOL);
  });

  it('keeps the workflow-builder surface un-steered', () => {
    const registry = readFileSync(join(repoRoot, 'src', 'tool-registry.ts'), 'utf8');
    expect(registry).not.toMatch(PROMOTION);
    expect(registry).not.toContain(REFERRAL_TOOL);
  });
});
