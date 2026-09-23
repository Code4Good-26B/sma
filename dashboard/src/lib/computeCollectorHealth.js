// Pure decision logic for the Collector health indicator — no React, no
// Supabase, no Date.now() in here. Takes the raw rows fetched from
// collector_runs and the current time, and returns a plain object
// describing what to show. Kept pure and in its own module specifically so
// every state can be exercised with hand-built input in a test, without
// ever writing fabricated rows into the real collector_runs table (that
// table is a historical record a future reader will consult to find out
// whether the system was actually working — inventing entries in it is
// inventing history).
//
// Two days, not one: the scheduled daily run has been observed starting
// four to five hours late, so a single missed/late day is a blip, not a
// fault. Two days means a real problem is visible before Michal's next
// weekly visit, without crying wolf over normal scheduling jitter.
const STALE_AFTER_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * @param {Array<{
 *   started_at: string,
 *   finished_at: string | null,
 *   status: 'running' | 'success' | 'partial' | 'failed',
 *   items_seen?: number,
 *   items_inserted?: number,
 *   sources?: Array<{ name: string, status: string, [key: string]: any }> | null,
 *   error_message?: string | null,
 * }>} runs - rows from collector_runs, most-recent-first is assumed but not
 *   required (this function sorts defensively).
 * @param {Date} now - the current time, injected so this stays pure.
 * @returns {
 *   | { status: 'unknown' }
 *   | { status: 'stale', lastFinishedAt: string | null }
 *   | { status: 'source_failing',
 *       failingSources: Array<{ name: string, lastOkAt: string | null }>,
 *       totalSourceCount: number }
 *   | { status: 'healthy', lastFinishedAt: string }
 * }
 */
export function computeCollectorHealth(runs, now) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return { status: 'unknown' };
  }

  const sorted = [...runs].sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );

  const nowMs = now.getTime();
  const withinTwoDays = (isoDate) =>
    isoDate != null && nowMs - new Date(isoDate).getTime() <= STALE_AFTER_MS;

  // "Healthy" or "a source is failing" both require the pipeline to be
  // running at all, i.e. some run actually completed (success or partial —
  // a lone source outage alone must not read as the whole system being
  // down) within the window. Absence of that is 'stale', regardless of what
  // any individual source did.
  const lastGoodRun = sorted.find(
    (r) => (r.status === 'success' || r.status === 'partial') && r.finished_at
  );

  if (!lastGoodRun || !withinTwoDays(lastGoodRun.finished_at)) {
    return {
      status: 'stale',
      lastFinishedAt: lastGoodRun ? lastGoodRun.finished_at : null,
    };
  }

  // Which sources currently exist comes from the NEWEST run only, not the
  // whole fetched window. collect_source (collector/main.py) appends a
  // detail entry to a run's `sources` array for every configured source,
  // even one that errored, so the newest run's `sources` array is exactly
  // today's source configuration. Sourcing this list from older runs too
  // would mean a source commented out of sources.py keeps being reported as
  // "failing" for as long as it lingers in the fetched window — up to
  // ~2 weeks at one run/day — after it has already stopped existing. That
  // is exactly the false alarm this project is built to avoid, and it is
  // not hypothetical: two sources are commented out in sources.py today.
  const newestRun = sorted[0];
  const currentSourceNames = (Array.isArray(newestRun.sources) ? newestRun.sources : [])
    .map((s) => s?.name)
    .filter(Boolean);

  // The *last-ok time* for each currently-configured source is still looked
  // up across the whole fetched window — a source can be configured today
  // but simply not have reported 'ok' recently.
  const lastOkBySource = new Map();
  for (const run of sorted) {
    const sources = Array.isArray(run.sources) ? run.sources : [];
    for (const s of sources) {
      const name = s?.name;
      if (!name) continue;
      if (s.status === 'ok' && !lastOkBySource.has(name)) {
        lastOkBySource.set(name, run.finished_at ?? run.started_at);
      }
    }
  }

  const failingSources = currentSourceNames
    .filter((name) => !withinTwoDays(lastOkBySource.get(name) ?? null))
    .map((name) => ({ name, lastOkAt: lastOkBySource.get(name) ?? null }));

  if (failingSources.length > 0) {
    return {
      status: 'source_failing',
      failingSources,
      totalSourceCount: currentSourceNames.length,
    };
  }

  return { status: 'healthy', lastFinishedAt: lastGoodRun.finished_at };
}
