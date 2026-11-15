// Records AI / model outputs computed in the browser (recommender, Monte Carlo,
// coach, risk) in the server's append-only AI log, with the model version and
// the inputs. Best-effort and silent: a missing server never blocks the page.
import { SERVER_ON, api } from "./server.js";

const last = new Map();
export function logAi(kind, modelKey, { params = null, features = null, output = null, tookMs = null } = {}) {
  if (!SERVER_ON) return;
  const sig = JSON.stringify([kind, params, features]).slice(0, 2000);
  if (last.get(kind) === sig) return; // the same run re-rendered
  last.set(kind, sig);
  api("POST", "/api/audit/ai", { kind, modelKey, params, features, output, tookMs }).catch(() => {});
}
export function logRisk(action, detail) {
  if (!SERVER_ON) return;
  api("POST", "/api/audit/event", { action, detail }).catch(() => {});
}
