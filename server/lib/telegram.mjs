// Telegram delivery. SEND ONLY: this server never calls getUpdates, so it can
// share the GQ agent's bot token without stealing its messages.
export function createTelegram(cfg, fetchImpl = fetch, log = console.log) {
  const enabled = !!cfg.telegramToken;
  async function call(method, body) {
    const r = await fetchImpl(`${cfg.telegramApiBase}/bot${cfg.telegramToken}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) { const e = new Error(j.description || `telegram ${r.status}`); e.code = j.error_code || r.status; throw e; }
    return j.result;
  }
  /** html: Telegram HTML subset. Splits long messages at line breaks. */
  async function send(chatId, html, extra = {}) {
    if (!enabled) throw new Error("TELEGRAM_BOT_TOKEN is not set on the TA server");
    const parts = [];
    let cur = "";
    for (const line of String(html).split("\n")) {
      if ((cur + line).length > 3800) { parts.push(cur); cur = ""; }
      cur += (cur ? "\n" : "") + line;
    }
    if (cur) parts.push(cur);
    let last;
    for (const p of parts) {
      try { last = await call("sendMessage", { chat_id: chatId, text: p, parse_mode: "HTML", disable_web_page_preview: true, ...extra }); }
      catch (e) {
        if (e.code === 400 && /parse|entit/i.test(e.message)) last = await call("sendMessage", { chat_id: chatId, text: p.replace(/<[^>]+>/g, ""), disable_web_page_preview: true });
        else throw e;
      }
    }
    return last;
  }
  return { enabled, send, call, log };
}
export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
