// The Supabase pooler recycles connections; during a long run a connection can drop under a running query
// ("Connection terminated unexpectedly", ECONNRESET, admin shutdown). Those are retried; anything else
// (a constraint, bad SQL, a statement timeout) is thrown at once. Every write the engine retries is an
// idempotent upsert inside its own transaction, so a retry after a dropped connection cannot double-write.
const TRANSIENT_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "57P01", "57P02", "57P03", "08000", "08003", "08006", "08001", "08004"]);
export function isTransient(e) {
  if (!e) return false;
  if (TRANSIENT_CODES.has(e.code)) return true;
  return /Connection terminated|connection timeout|terminating connection|server closed the connection|Client has encountered a connection error|socket hang up/i.test(String(e.message || ""));
}

export async function withRetry(fn, { tries = 5, log = console.warn, what = "query" } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); } catch (e) {
      if (attempt >= tries || !isTransient(e)) throw e;
      const wait = Math.min(30000, 2000 * 2 ** (attempt - 1));
      log(`[retry] ${what}: ${e.message} (attempt ${attempt} of ${tries}, again in ${wait / 1000}s)`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/** The pool, with query() retried on a dropped connection. connect() is passed through (callers retry whole transactions). */
export function retryPool(pool, opts = {}) {
  return {
    query: (...a) => withRetry(() => pool.query(...a), opts),
    connect: () => pool.connect(),
    end: () => pool.end(),
    on: (...a) => pool.on(...a),
  };
}
