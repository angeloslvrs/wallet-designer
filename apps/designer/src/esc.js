// Single source of truth for HTML-escaping interpolated values before they go
// into innerHTML. Escapes the five characters that matter in both element and
// attribute contexts. (trip.js previously shipped a weaker copy that escaped
// only double-quotes, which left `<`/`>` open to stored XSS via server data.)
const MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => MAP[c]);
