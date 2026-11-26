// Small concurrency helpers for the batch engine. The engine is database-bound (CPU < 1 core on a 24-core
// container), so overlapping reads and writes is what shortens a run. Results do not depend on the order
// countries finish in: every accumulator adds sums and counts.

/** Weighted semaphore: work with weight w starts when the weights already running plus w fit in `budget`,
 *  or when nothing else is running (a single item larger than the budget still runs, alone). */
export function weightedLimiter(budget, maxJobs = Infinity) {
  let inUse = 0, jobs = 0;
  const waiting = [];
  const pump = () => {
    while (waiting.length) {
      const i = waiting.findIndex((w) => jobs === 0 || (inUse + w.weight <= budget && jobs < maxJobs));
      if (i < 0) return;
      const [w] = waiting.splice(i, 1);
      inUse += w.weight; jobs++;
      w.resolve();
    }
  };
  return async function run(weight, fn) {
    await new Promise((resolve) => { waiting.push({ weight, resolve }); pump(); });
    try { return await fn(); } finally { inUse -= weight; jobs--; pump(); }
  };
}

/** Run fn over items with at most `limit` in flight; results in input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
