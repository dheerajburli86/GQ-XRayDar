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
      // access = what an admin allowed this person's agent to read (XRayDar decides; the agent obeys it)
      body: JSON.stringify({ message, history: (history || []).slice(-10), context, user: user.guest ? { guest: true, guestId: user.guestId } : { email: user.email, name: user.displayName || user.name, telegramUserId: user.telegramUserId || null, access: { sources: user.agentAccess?.sources || [] } } }),
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

  // What is on the person's screen, with the instrument named (the agent cannot look ids up).
  async function enrich(context) {
    if (!context || typeof context !== "object") return null;
    const c = { page: context.page || null, tf: context.tf || null, view: context.view || null, symbol: context.symbol || null, name: context.name || null, country: null };
    if (context.instrumentId) {
      try { const s = (await data.facade()).secById.get(context.instrumentId); if (s) Object.assign(c, { symbol: s.symbol, name: s.name, country: s.country }); } catch { /* the bare context is still useful */ }
    }
    return c;
  }

  async function chat(args) {
    // the built-in assistant reads XRayDar's stored data, so it may only stand in for someone allowed that source
    const builtinOk = args.user?.guest || (args.user?.agentAccess?.sources || []).includes("xraydar");
    if (cfg.agentUrl && cfg.agentSecret) {
      try { return await viaAgent({ ...args, context: await enrich(args.context) }); }
      catch (e) {
        log(`[agent] GQ agent unavailable (${e.message}); ${builtinOk ? "answering with the built-in assistant" : "no fallback for this person"}`);
        if (!builtinOk) return { source: "none", answer: "The GQ agent did not answer just now. Try again in a minute.", markdown: true };
        const b = await viaBuiltin(args); return { ...b, notice: "The GQ agent did not answer, so this reply comes from the built-in assistant (stored data only)." };
      }
    }
    if (!builtinOk) return { source: "none", answer: "The GQ agent is not connected right now.", markdown: true };
    return viaBuiltin(args);
  }
  return { chat, connected: () => !!(cfg.agentUrl && cfg.agentSecret) };
}
