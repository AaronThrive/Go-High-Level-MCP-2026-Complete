# Tool execution guarantees

The stdio, Streamable HTTP, and legacy SSE servers expose the original JSON input schemas and validate arguments before tool dispatch. Official request schemas include their referenced component models. The CLI uses the same validator after parsing its flags.

MCP tool execution failures return `isError: true`, including tools that return `success: false` or `ok: false`. Invalid MCP arguments produce an invalid-parameters protocol error. REST `/execute` and `/tools/call` return `ok: true` on success, HTTP 400 for invalid arguments or account overrides, HTTP 404 for unknown tools, and HTTP 502 for returned provider/tool failures. Thrown execution failures return HTTP 500.

HTTP account overrides require both `x-ghl-access-token` and `x-ghl-location-id`. Optional `x-ghl-user-type` must be `Location` or `Company`. SSE account context is fixed when the connection opens. The Apps server uses its configured account and rejects account-override headers.

The enhanced client automatically retries only GET requests on 429 and server errors. Writes are attempted once because an error response can follow a committed operation. Cached reads are invalidated after every write attempt and token change. A failed write should be checked against the provider before manually repeating it.

Regression tests exercise real SDK calls over stdio, Streamable HTTP, and both SSE implementations, plus REST calls against a local mock provider. These tests do not establish production deployment or live CRM behavior.
