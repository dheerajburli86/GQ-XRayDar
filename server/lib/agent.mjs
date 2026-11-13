// GQ Agent chat for the web app's agent panel.
// When GQAGENT_URL is set, the question goes to the GQ agent's /api/chat (the
// same model and tools as on Telegram, including the TA tools that call back
// into this server). Without it, or when the agent is down, the built-in
// research assistant answers from stored calculations, so the panel always works.
import { answer as builtinAnswer } from "../../engine/assistant.js";

export function createAgentProxy({ cfg, data, fetchImpl = fetch, log = console.log }) {
  async function viaAgent({ message, history, user, context }) {
    const r = await fetchImpl(`${cfg.agentUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ta-secret": cfg.agentSecret },
      body: JSON.stringify({ message, history: (history || []).slice(-10), context, user: { email: user.email, name: user.name, telegramUserId: user.telegramUserId || null } }),
      signal: AbortSignal.timeout(170_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `agent answered HTTP ${r.status}`);
    return { source: "gq-agent", answer: j.answer, markdown: true };
  }

  async function viaBuiltin({ message, context }) {
    const d = await data.facade();
    const q = context?.instrumentId && !/\b[A-Z]{2,}\b/.test(message) ? `${message} ${d.secById.get(context.instrumentId)?.symbol || ""}` : message;
    const out = await builtinAnswer(q, d);
    return { source: "built-in", blocks: out.blocks };
  }

  async function chat(args) {
    if (cfg.agentUrl && cfg.agentSecret) {
      try { return await viaAgent(args); }
      catch (e) { log(`[agent] GQ agent unavailable (${e.message}); answering with the built-in assistant`); const b = await viaBuiltin(args); return { ...b, notice: "The GQ agent did not answer, so this reply comes from the built-in assistant (stored data only)." }; }
    }
    return viaBuiltin(args);
  }
  return { chat, connected: () => !!(cfg.agentUrl && cfg.agentSecret) };
}
