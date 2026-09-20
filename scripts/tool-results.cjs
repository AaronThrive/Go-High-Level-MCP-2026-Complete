'use strict';

function toolFailed(result) {
  return Boolean(result && typeof result === 'object' &&
    (result.isError === true || result.success === false || result.ok === false));
}
function toolFailureMessage(result) {
  const detail = result?.error?.message || result?.error ||
    (Array.isArray(result?.content) && result.content.find(item => item.type === 'text')?.text) || 'Tool reported failure';
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}
function toMcpResult(result) {
  const isError = toolFailed(result);
  if (result && typeof result === 'object' && Array.isArray(result.content)) {
    return { ...result, ...(isError ? { isError: true } : {}) };
  }
  return {
    content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result ?? null) }],
    ...(result && typeof result === 'object' && !Array.isArray(result) ? { structuredContent: result } : {}),
    ...(isError ? { isError: true } : {}),
  };
}
module.exports = { toolFailed, toolFailureMessage, toMcpResult };
