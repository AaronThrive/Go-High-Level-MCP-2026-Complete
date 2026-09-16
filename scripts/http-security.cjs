'use strict';

const express = require('express');
const cors = require('cors');
const { timingSafeEqual } = require('node:crypto');

const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
function resolveBindHost() {
  return (process.env.GHL_MCP_BIND_HOST || '').trim() || '127.0.0.1';
}
function isOriginAllowed(origin) {
  if (!origin || LOOPBACK.test(origin)) return true;
  const raw = (process.env.GHL_MCP_ALLOWED_ORIGINS || '').trim();
  const origins = !raw ? ['https://chatgpt.com', 'https://chat.openai.com']
    : raw.toLowerCase() === 'none' ? [] : raw.split(',').map(value => value.trim());
  return origins.includes(origin);
}
function createHttpApp() {
  const app = express();
  app.use((req, res, next) => {
    if (isOriginAllowed(req.headers.origin)) return next();
    res.status(403).json({ error: 'Forbidden', reason: 'Origin not allowed' });
  });
  app.use(cors({
    origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'mcp-session-id', 'mcp-protocol-version', 'Last-Event-ID', 'x-ghl-access-token', 'x-ghl-location-id', 'x-ghl-user-type'],
    exposedHeaders: ['mcp-session-id', 'WWW-Authenticate'],
    credentials: true,
  }));
  app.use((req, res, next) => {
    const token = (process.env.GHL_MCP_AUTH_TOKEN || '').trim();
    // Only the read-only health endpoint is exempt; preflight was handled by CORS.
    if (!token || ((req.method === 'GET' || req.method === 'HEAD') && req.path === '/health')) return next();
    const header = req.headers.authorization || '';
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
    const actual = Buffer.from(supplied);
    const expected = Buffer.from(token);
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) return next();
    res.setHeader('WWW-Authenticate', 'Bearer realm="ghl-mcp"');
    res.status(401).json({ error: 'Unauthorized', reason: 'A valid bearer token is required' });
  });
  app.use(express.json());
  return app;
}
function describeBinding(host, port) {
  const auth = (process.env.GHL_MCP_AUTH_TOKEN || '').trim() ? 'bearer token required' : 'no bearer token configured';
  return `bind=${host}:${port}; ${auth}`;
}
module.exports = { createHttpApp, resolveBindHost, isOriginAllowed, describeBinding };
