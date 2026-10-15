// In-memory counters for the signal/notification pipeline, reported by
// GET /api/cron/health. Before this, "no notifications for hours" couldn't
// be told apart between the AI legitimately saying "wait", a Groq quota
// outage, unparseable AI output, dedup skips, or generation never running
// at all -- they all looked identical from outside. Resets whenever the
// process restarts (Render's free tier sleeps it), which bootedAt shows.

const bootedAt = new Date();
const counters = {};
const lastErrors = [];
let lastCycle = null;
// Last decision per pair ("why no signal?"): AI answer + rule details.
// Market reasoning only -- no user or money data (the report is public).
const lastDecisions = {};

function inc(key, by = 1) {
  counters[key] = (counters[key] || 0) + by;
}

function recordError(where, message) {
  lastErrors.unshift({ at: new Date(), where, message: String(message).slice(0, 300) });
  lastErrors.length = Math.min(lastErrors.length, 10);
}

function noteDecision(pair, text) {
  lastDecisions[pair] = { at: new Date(), text: String(text).slice(0, 400) };
}

function setLastCycle(cycle) {
  lastCycle = cycle;
}

function snapshot() {
  return { bootedAt, counters: { ...counters }, lastErrors: [...lastErrors], lastCycle, lastDecisions: { ...lastDecisions } };
}

module.exports = { inc, recordError, setLastCycle, snapshot, noteDecision };
