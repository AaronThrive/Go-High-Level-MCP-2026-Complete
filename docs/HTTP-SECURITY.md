# HTTP transport security

The main HTTP server, legacy SSE server, and MCP Apps server use the same Origin, CORS, bearer-token, and bind-host implementation.

Local processes default to `127.0.0.1`. Set `GHL_MCP_BIND_HOST` to override it. The supplied Docker image binds `0.0.0.0` inside the container; Compose publishes only `127.0.0.1:8000:8000` on the host. For standalone Docker, use `-p 127.0.0.1:8000:8000`. A local `.env` that overrides the image bind address must also use `0.0.0.0` inside Docker.

`GHL_MCP_ALLOWED_ORIGINS` is a comma-separated replacement for the remote defaults (`https://chatgpt.com` and `https://chat.openai.com`). Set it to `none` for loopback origins only. HTTP/HTTPS localhost, 127.0.0.1, and [::1] origins are accepted with optional ports. Disallowed supplied Origins return 403. Requests without Origin remain supported for non-browser clients; this is not authentication.

Set `GHL_MCP_AUTH_TOKEN` to require `Authorization: Bearer <token>` on data, preview, and MCP routes. GET/HEAD `/health` remains public; allowed CORS preflight is handled before authentication. Failed authentication returns 401 with a Bearer challenge. This secret is separate from the CRM token. It is an operator shared-secret gate, not MCP OAuth discovery or delegated authorization. For browser preview, use a trusted proxy that supplies the token; do not embed it in a URL or HTML.

For Kubernetes/PaaS or remote access, bind `0.0.0.0` internally, use TLS at the ingress, restrict network access, configure the bearer token and exact browser origins, and configure the client/proxy to send Authorization. A health check alone does not verify authenticated MCP access. Hosts requiring MCP OAuth need an authorization gateway.

Run `npm test -- --runInBand` for shared middleware and transport regression coverage. Local HTTP listener tests use fake CRM credentials and a mock provider.
