// Pure helpers for the ops (Manage) view: turn status-editor inputs into a
// status-route body, and push-route responses into one-line summaries.

import { semanticKind, validateFieldValue } from "@wpd/pass-builder/field-kinds.js";

/**
 * Validate the status-editor's values the same way the issue form and the
 * server do: each field's kind comes from its semantic (the editor's keys ARE
 * semantic keys), so a date edit must be ISO-8601, etc. Empty values clear a
 * semantic and are fine. Returns { fieldKey: message } for the invalid ones.
 * @param {Record<string, string>} values
 * @returns {Record<string, string>}
 */
export function validateStatusValues(values) {
  const errors = {};
  for (const [key, raw] of Object.entries(values ?? {})) {
    const msg = validateFieldValue({ kind: semanticKind(key), required: false }, raw);
    if (msg) errors[key] = msg;
  }
  return errors;
}

/**
 * Collect the non-empty status-editor fields into a body for the status
 * routes. Returns null when nothing was entered (caller shows a hint instead
 * of firing an empty update).
 * @param {Record<string, string>} values
 * @returns {Record<string, string> | null}
 */
export function buildStatusBody(values) {
  const body = {};
  for (const [key, raw] of Object.entries(values ?? {})) {
    const v = (raw ?? "").trim();
    if (v) body[key] = v;
  }
  return Object.keys(body).length ? body : null;
}

/**
 * One-line summary of a status-push response — single-pass
 * ({ok, push, skippedFields?}) or group ({ok, count, sent, results[]}).
 * Surfaces delivery health (devices reached, failures, and 410-pruned stale
 * devices) so a silent APNs problem is visible from the console, plus any
 * template field keys the template doesn't declare.
 * @param {object} j
 * @returns {string}
 */
export function describePushResult(j) {
  if (!j?.ok) return `✗ ${j?.error ?? "error"}`;

  const skipped = new Set(j.skippedFields ?? []);
  for (const r of j.results ?? []) for (const k of r.skippedFields ?? []) skipped.add(k);
  const skippedNote = skipped.size ? ` · template lacks: ${[...skipped].join(", ")}` : "";

  // Aggregate delivery counts across single-pass (j.push) or group (j.results[].push).
  const pushes = j.results ? j.results.map(r => r.push) : [j.push];
  let sent = 0, failed = 0, pruned = 0;
  for (const p of pushes) {
    if (!p) continue;
    sent += p.sent ?? 0;
    failed += p.failures?.length ?? 0;
    pruned += p.unregistered?.length ?? 0;
  }

  const head = j.results ? `✓ ${j.count} pass(es), ${sent} device(s)` : `✓ pushed ${sent} device(s)`;
  const failNote = failed ? ` · ⚠ ${failed} failed` : "";
  const pruneNote = pruned ? ` · pruned ${pruned} stale` : "";
  return head + failNote + pruneNote + skippedNote;
}
