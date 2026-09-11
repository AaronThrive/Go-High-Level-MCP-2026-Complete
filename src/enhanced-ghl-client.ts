/**
 * Enhanced GHL API Client
 * 
 * Wraps the existing GHLApiClient with:
 * - Connection pooling (HTTP keep-alive)
 * - TTL cache for read-only responses
 * - GET-only retry with exponential backoff (429/5xx)
 * - Rate limit header tracking
 * - Structured error responses
 */

import type { AxiosResponse } from 'axios';
import * as http from 'http';
import * as https from 'https';
import { GHLApiClient } from './clients/ghl-api-client.js';
import { GHLConfig, GHLApiResponse } from './types/ghl-types.js';

// ─── TTL Cache ──────────────────────────────────────────────

interface CacheEntry<T = any> {
  data: T;
  expires: number;
}

class TTLCache {
  private store = new Map<string, CacheEntry>();
  private defaultTTL: number;
  private maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(defaultTTLMs = 30_000, maxSize = 500) {
    this.defaultTTL = defaultTTLMs;
    this.maxSize = maxSize;

    // Expire lazily: per-request clients must not leave lifetime-extending timers.
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) { this.misses++; return undefined; }
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    if (this.store.size >= this.maxSize) this.cleanup();
    // Evict oldest if still at capacity
    if (this.store.size >= this.maxSize) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, {
      data,
      expires: Date.now() + (ttlMs ?? this.defaultTTL),
    });
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.store.clear();
      return;
    }
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) this.store.delete(key);
    }
  }

  getStats() {
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? `${Math.round((this.hits / (this.hits + this.misses)) * 100)}%`
        : '0%',
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expires) this.store.delete(key);
    }
  }
}

// ─── Rate Limit Tracker ─────────────────────────────────────

interface RateLimitState {
  remaining: number;
  limit: number;
  resetAt: number;
}

// ─── Enhanced Client ────────────────────────────────────────

export class EnhancedGHLClient extends GHLApiClient {
  private cache: TTLCache;
  private rateLimit: RateLimitState = { remaining: Infinity, limit: Infinity, resetAt: 0 };

  constructor(config: GHLConfig) {
    super(config);
    // Configure the actual instance used by the base client's request methods.
    this.axiosInstance.defaults.httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
    this.axiosInstance.defaults.httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });
    // Track rate limit headers
    this.axiosInstance.interceptors.response.use(
      (response) => {
        this.trackRateLimit(response);
        return response;
      },
      (error) => {
        if (error.response) this.trackRateLimit(error.response);
        return Promise.reject(error);
      }
    );

    // Cache with 30s TTL, 500 entries max
    this.cache = new TTLCache(30_000, 500);
  }

  private trackRateLimit(response: AxiosResponse): void {
    const remaining = response.headers['x-ratelimit-remaining'];
    const limit = response.headers['x-ratelimit-limit'];
    const reset = response.headers['x-ratelimit-reset'];

    if (remaining !== undefined) this.rateLimit.remaining = parseInt(remaining, 10);
    if (limit !== undefined) this.rateLimit.limit = parseInt(limit, 10);
    if (reset !== undefined) this.rateLimit.resetAt = parseInt(reset, 10) * 1000;
  }

  /**
   * Enhanced makeRequest with caching and retry
   */
  async makeRequest<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: Record<string, unknown> | string,
    options?: {
      version?: string;
      app?: string;
      contentType?: 'application/json' | 'application/x-www-form-urlencoded';
    }
  ): Promise<GHLApiResponse<T>> {
    // Cache GET requests (include version in key so v2/v3 responses never collide)
    if (method === 'GET') {
      const cacheKey = `${method}:${options?.version || this.getConfig().version}:${path}`;
      const cached = this.cache.get<GHLApiResponse<T>>(cacheKey);
      if (cached) return cached;

      const result = await this.makeRequestWithRetry<T>(method, path, body, options);
      if (result.success) {
        this.cache.set(cacheKey, result);
      }
      return result;
    }

    // Non-GET: execute and invalidate related caches
    // A failed write can have committed upstream; do not serve stale cached reads.
    try {
      return await this.makeRequestWithRetry<T>(method, path, body, options);
    } finally {
      this.cache.invalidate();
    }
  }

  private async makeRequestWithRetry<T>(
    method: string,
    path: string,
    body?: Record<string, unknown> | string,
    options?: {
      version?: string;
      app?: string;
      contentType?: 'application/json' | 'application/x-www-form-urlencoded';
    },
    attempt = 0
  ): Promise<GHLApiResponse<T>> {
    const MAX_RETRIES = 3;
    const BASE_DELAY = 1000;

    try {
      // Preemptive rate limit check
      if (this.rateLimit.remaining <= 1 && Date.now() < this.rateLimit.resetAt) {
        const waitMs = this.rateLimit.resetAt - Date.now();
        if (waitMs > 0 && waitMs < 60_000) {
          await new Promise(r => setTimeout(r, waitMs));
        }
      }

      // Use parent's makeRequest which has all the proper axios config
      return await super.makeRequest<T>(method as any, path, body, options);
    } catch (err: any) {
      const status = err.response?.status || (err.message?.match(/\((\d+)\)/)?.[1] && parseInt(err.message.match(/\((\d+)\)/)[1]));

      // Never replay writes after ambiguous failures without endpoint-specific deduplication.
      if (method === 'GET' && attempt < MAX_RETRIES && (status === 429 || (status >= 500 && status < 600))) {
        const delay = BASE_DELAY * Math.pow(2, attempt) + Math.random() * 500;
        process.stderr.write(`[GHL] Retry ${attempt + 1}/${MAX_RETRIES} for ${method} ${path} (status ${status}, delay ${Math.round(delay)}ms)\n`);
        await new Promise(r => setTimeout(r, delay));
        return this.makeRequestWithRetry<T>(method, path, body, options, attempt + 1);
      }

      throw err;
    }
  }

  updateAccessToken(newToken: string): void {
    super.updateAccessToken(newToken);
    this.cache.invalidate();
    this.rateLimit = { remaining: Infinity, limit: Infinity, resetAt: 0 };
  }

  getCacheStats() {
    return {
      ...this.cache.getStats(),
      rateLimit: {
        remaining: this.rateLimit.remaining === Infinity ? 'unlimited' : this.rateLimit.remaining,
        limit: this.rateLimit.limit === Infinity ? 'unlimited' : this.rateLimit.limit,
      },
    };
  }
}
