import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
export function toolFailed(result: unknown): boolean;
export function toolFailureMessage(result: unknown): string;
export function toMcpResult(result: unknown): CallToolResult;
