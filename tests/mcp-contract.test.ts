import { describe, expect, it } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ToolRegistry } from '../src/tool-registry.js';
import { validateToolInput, ToolInputError } from '../scripts/tool-schema.cjs';

describe('MCP tool contract', () => {
  it('exposes exact schemas, delivers arguments, and preserves tool failures', async () => {
    const received: unknown[] = [];
    const registry = new ToolRegistry({ getConfig: () => ({apiGeneration:'v3'}), getContact: async (id: string) => {
      received.push(id); return {success:true,data:{id}};
    }} as any);
    const server = new McpServer({name:'test',version:'1'});
    registry.registerAll(server);
    const client = new Client({name:'test',version:'1'});
    const [a,b] = InMemoryTransport.createLinkedPair();
    await server.connect(a); await client.connect(b);
    try {
      const tools = await client.listTools();
      expect(tools.tools.find(t=>t.name==='get_contact')?.inputSchema).toEqual(registry.getAllToolDefinitions().find(t=>t.name==='get_contact')?.inputSchema);
      const result = await client.callTool({name:'get_contact',arguments:{contactId:'contact-proof'}});
      expect(result.isError).not.toBe(true);
      expect(received).toEqual(['contact-proof']);
      await expect(client.callTool({name:'get_contact',arguments:{}})).rejects.toThrow('required');
      expect(received).toHaveLength(1);
      const mod = (registry as any).toolToModule.get('get_contact');
      for (const failure of [{success:false,error:'mock rejection'},{ok:false,error:'mock rejection'},{isError:true,content:[{type:'text',text:'mock rejection'}]}]) {
        mod.executeTool = async () => failure;
        expect((await client.callTool({name:'get_contact',arguments:{contactId:'x'}})).isError).toBe(true);
      }
      mod.executeTool = async () => { throw new Error('mock thrown rejection'); };
      const thrown = await client.callTool({name:'get_contact',arguments:{contactId:'x'}});
      expect(thrown.isError).toBe(true);
      expect(JSON.stringify(thrown)).toContain('mock thrown rejection');
    } finally { await client.close(); await server.close(); }
  });
  it.each(['v2','v3'])('all visible %s schemas are locally resolvable', generation => {
    const registry = new ToolRegistry({getConfig:()=>({apiGeneration:generation})} as any);
    for (const tool of registry.getAllToolDefinitions()) {
      try { validateToolInput(tool.name, {}, tool.inputSchema); }
      catch (error) { expect(error).toBeInstanceOf(ToolInputError); }
    }
  });
  it('validates nested required fields and exact oneOf semantics without coercion', () => {
    const schema = {type:'object',properties:{body:{type:'object',required:['email'],properties:{email:{type:'string',format:'email'}}}},required:['body']};
    expect(()=>validateToolInput('test',{body:{}},schema)).toThrow('email');
    expect(()=>validateToolInput('test',{body:{email:12}},schema)).toThrow();
    expect(()=>validateToolInput('test',{body:{email:'valid@example.invalid'}},schema)).not.toThrow();
    expect(()=>validateToolInput('test',{value:2},{type:'object',properties:{value:{oneOf:[{type:'number'},{type:'integer'}]}}})).toThrow('oneOf');
  });
  it('classifies explicit writes and typing state changes as writes', () => {
    const registry = new ToolRegistry({getConfig:()=>({apiGeneration:'v3'})} as any);
    expect(registry.getToolInventory().find(t=>t.name==='live_chat_typing')).toMatchObject({readOnly:false,access:'write'});
    (registry as any).allToolDefs.push({name:'get_mutating_example',inputSchema:{type:'object'},_meta:{labels:{access:'write'}}});
    expect(registry.getToolInventory().find(t=>t.name==='get_mutating_example')?.readOnly).toBe(false);
  });
});
