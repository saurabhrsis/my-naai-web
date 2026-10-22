const express = require('express');
const publicReadLimiter = require('../utils/middleware/publicReadLimiter.middleware');

/**
 * The open storefront: the catalog and the shop rules, with NO token.
 *
 * Why a separate mount instead of dropping the guard from the partner routes:
 * `/api/shop-products/list` is also the salon's catalog endpoint, and its
 * middleware chain may grow (plan checks, salon lookups) for reasons that have
 * nothing to do with a visitor reading prices. These two reads are a stable,
 * deliberately public contract for the website, so the website can depend on
 * them whatever happens to the partner route.
 *
 * The handlers are the SAME ones the guarded routes use — only the chain in
 * front of them differs. If your file names differ, change these two requires;
 * nothing else in this file needs to move.
 *
 * Mount (one line, in app.js):
 *     app.use('/api/shop-public', shopPublicRouter);
 */
const listShopProducts = require('../controller/shopProduct/listShopProducts');
const getShopSettings = require('../controller/shopSettings/getShopSettings');

const shopPublicRouter = express.Router();

// Every controller in this project reads `req.body` (the whole API is POST).
// The website also wants a plain GET it can cache at the edge, so the query
// string is copied into the body and the same handler answers both — one
// implementation, two verbs.
const bodyFromQuery = (request, _response, next) => {
    if (request.method === 'GET') request.body = { ...request.query };
    next();
};

// Public reads may be cached briefly at the edge/CDN. The catalog changes when
// the admin edits a product, not per visitor, so a minute of staleness is a
// price worth paying for a storefront that opens instantly; `stale-while-
// revalidate` keeps it responsive while the fresh copy is fetched.
const cacheFor = (seconds) => (request, response, next) => {
    response.set('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=60`);
    next();
};

shopPublicRouter.post('/products/list', publicReadLimiter, cacheFor(60), bodyFromQuery, listShopProducts);
shopPublicRouter.get('/products/list', publicReadLimiter, cacheFor(60), bodyFromQuery, listShopProducts);

// Delivery charges, the free-delivery threshold, the COD limit and the
// discount are terms of sale, not secrets: the shop cannot quote an honest
// bill without them.
shopPublicRouter.post('/settings/get', publicReadLimiter, cacheFor(300), bodyFromQuery, getShopSettings);
shopPublicRouter.get('/settings/get', publicReadLimiter, cacheFor(300), bodyFromQuery, getShopSettings);

module.exports = shopPublicRouter;
