// Extra alert delivery channels besides Telegram and phone push:
//   email     through Resend (RESEND_API_KEY, ALERT_EMAIL_FROM); off when unset
//   webhook   POST JSON to the user's own https URL, signed with HMAC-SHA256
//             (header x-xraydar-signature) using WEBHOOK_SIGNING_SECRET
import crypto from "node:crypto";

const PRIVATE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?|metadata\.)/i;
export function webhookAllowed(url) {
  try { const u = new URL(url); return u.protocol === "https:" && !PRIVATE.test(u.hostname); } catch { return false; }
}

export function createChannels(cfg, fetchImpl = fetch, log = console.log) {
  const email = {
    enabled: !!cfg.resendKey,
    async send(to, subject, text) {
      const r = await fetchImpl("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${cfg.resendKey}`, "content-type": "application/json" }, body: JSON.stringify({ from: cfg.alertEmailFrom, to: [to], subject, text }), signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`email HTTP ${r.status}`);
      return true;
    },
  };
  const webhook = {
    enabled: true,
    async send(url, payload) {
      if (!webhookAllowed(url)) throw new Error("webhook URL must be public https");
      const body = JSON.stringify(payload);
      const sig = cfg.webhookSecret ? crypto.createHmac("sha256", cfg.webhookSecret).update(body).digest("hex") : null;
      const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...(sig ? { "x-xraydar-signature": sig } : {}) }, body, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`webhook HTTP ${r.status}`);
      return true;
    },
  };
  void log;
  return { email, webhook };
}
