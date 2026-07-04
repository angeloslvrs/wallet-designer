// Central Express error handler. Every async route is wrapped by asyncHandler
// (util/async-handler.js), so a rejected promise — e.g. a JSON.parse SyntaxError
// from one corrupt stored row — lands here instead of crashing the process or
// leaking err.message to a client. The /api/wallet/* routes are PUBLIC (Apple
// devices call them from the internet), so the body is deliberately generic: no
// stack trace, file path, or error text ever crosses the wire; the real error
// is logged server-side only.

/* eslint-disable no-unused-vars */
export function errorHandler(err, req, res, next) {
  // next is required for Express to recognise this as error middleware (4 args).
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  if (res.headersSent) return next(err);   // response already streaming — let Express abort it
  res.status(500).json({ error: "internal error" });
}
