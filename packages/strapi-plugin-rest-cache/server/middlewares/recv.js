'use strict';

/**
 * @typedef {import('../types').CacheRouteConfig} CacheRouteConfig
 */

const chalk = require('chalk');
// Debug utility for logging cache operations
const debug = require('debug')('strapi:strapi-plugin-rest-cache');

// Import utility functions for cache key generation, lookup checks and etag handling
const { generateCacheKey } = require('../utils/keys/generateCacheKey');
const { shouldLookup } = require('../utils/middlewares/shouldLookup');
const { etagGenerate } = require('../utils/etags/etagGenerate');
const { etagLookup } = require('../utils/etags/etagLookup');
const { etagMatch } = require('../utils/etags/etagMatch');

/**
 * Creates a middleware function to handle caching of REST API responses
 * @param {{ cacheRouteConfig: CacheRouteConfig }} options - Configuration for caching specific routes
 * @param {{ strapi: import('@strapi/strapi').Strapi }} context - Strapi application context
 */
function createRecv(options, { strapi }) {
  // Validate required config
  if (!options?.cacheRouteConfig) {
    throw new Error(
      'REST Cache: unable to initialize recv middleware: options.cacheRouteConfig is required'
    );
  }

  // Initialize cache store and get configuration
  const store = strapi.plugin('rest-cache').service('cacheStore');
  const { strategy } = strapi.config.get('plugin.rest-cache');
  const { cacheRouteConfig } = options;
  const { hitpass, maxAge, keys } = cacheRouteConfig;
  const { enableEtag = false, enableXCacheHeaders = false } = strategy;

  /**
   * Middleware function that handles caching logic
   * - Checks cache before processing request
   * - Returns cached response if available
   * - Caches new responses for future requests
   */
  return async function recv(ctx, next) {
    // Generate unique cache key for this request
    const cacheKey = generateCacheKey(ctx, keys);
    // TODO: Remove this debug log as it's causing confusion about cache hits
    console.log('cacheKey', cacheKey);

    // Check if we should look up cache based on request
    // const lookup = shouldLookup(ctx, hitpass);
    const lookup = true;
    // TODO: Remove this debug log as it's causing confusion about cache hits

    // Track etag for cache validation
    let etagCached = null;

    if (lookup) {
      // Check for cached etag if enabled
      if (enableEtag) {
        etagCached = await etagLookup(cacheKey);

        // Return 304 Not Modified if etag matches
        if (etagCached && etagMatch(ctx, etagCached)) {
          if (enableXCacheHeaders) {
            ctx.set('X-Cache', 'HIT');
          }
          ctx.body = null;
          ctx.status = 304;
          return;
        }
      }

      // Try to get cached response
      const cacheEntry = await store.get(cacheKey);
      // TODO: Remove this debug log as it's causing confusion about cache hits

      // Return cached response if found
      if (cacheEntry) {
        debug(`[RECV] GET ${cacheKey} ${chalk.green('HIT')}`);

        if (enableXCacheHeaders) {
          ctx.set('X-Cache', 'HIT');
        }

        if (etagCached) {
          ctx.set('ETag', `"${etagCached}"`);
        }

        console.log('✅ Cache HIT - returning cached response');
        ctx.status = 200;
        ctx.body = cacheEntry;
        return;
      }
    }

    // TODO: Remove this debug log as it's causing confusion about cache hits
    console.log('❌ Cache MISS - calling backend');

    // If no cache hit, process request normally
    await next();

    // Handle response after backend fetch
    if (!lookup) {
      debug(`[RECV] GET ${cacheKey} ${chalk.magenta('HITPASS')}`);

      if (enableXCacheHeaders) {
        ctx.set('X-Cache', 'HITPASS');
      }
      return;
    }

    // Cache miss logging
    debug(`[RECV] GET ${cacheKey} ${chalk.yellow('MISS')}`);

    if (enableXCacheHeaders) {
      ctx.set('X-Cache', 'MISS');
    }

    // Cache successful responses
    if (ctx.body && ctx.status >= 200 && ctx.status <= 300) {
      // @TODO check Cache-Control response header

      // Generate and cache etag if enabled
      if (enableEtag) {
        const etag = etagGenerate(ctx, cacheKey);
        ctx.set('ETag', `"${etag}"`);

        // Store etag in cache
        store.set(`${cacheKey}_etag`, etag, maxAge).catch(() => {
          debug(
            `[RECV] GET ${cacheKey} ${chalk.yellow(
              'Unable to store ETag in cache'
            )}`
          );
        });
      }

      // Store response in cache
      store.set(cacheKey, ctx.body, maxAge).catch(() => {
        debug(
          `[RECV] GET ${cacheKey} ${chalk.yellow(
            'Unable to store Content in cache'
          )}`
        );
      });
    }
  };
}

module.exports = {
  createRecv,
};
