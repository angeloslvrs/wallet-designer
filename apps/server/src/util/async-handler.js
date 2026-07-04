/**
 * Wrap an async route handler so a rejected promise is forwarded to Express's
 * error middleware via next(err) instead of becoming an unhandledRejection.
 * Express 4 does not await handlers, so without this one corrupt stored row
 * (e.g. a JSON.parse SyntaxError from snapshot()) would take the whole process
 * down on the next request rather than returning a 500.
 *
 * @param {(req, res, next) => Promise<unknown>} fn
 * @returns {(req, res, next) => void}
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
