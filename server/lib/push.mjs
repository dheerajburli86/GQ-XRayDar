// Web push (phone / desktop pop-ups for the installed app). Optional: on only
// when VAPID keys are set. Generate them once with: npx web-push generate-vapid-keys
export async function createPush(cfg, pool, log = console.log) {
  const off = (why) => ({ enabled: false, publicKey: null, reason: why, async notify() { return { skipped: why }; } });
  if (!cfg.vapidPublic || !cfg.vapidPrivate) return off("push not configured");
  // web-push is CommonJS: under ESM its functions sit on the module itself, not on .default
  let webpush;
  try {
    const mod = await import("web-push");
    webpush = mod.default?.setVapidDetails ? mod.default : mod;
    webpush.setVapidDetails(cfg.vapidSubject, cfg.vapidPublic, cfg.vapidPrivate);
  } catch (e) {
    // bad keys must switch phone pop-ups off, never stop the whole server
    log(`[push] disabled: ${e.message}`);
    return off(`push disabled: ${e.message}`);
  }
  return {
    enabled: true, publicKey: cfg.vapidPublic,
    async notify(userId, payload) {
      const { rows } = await pool.query(`select id, endpoint, keys from tas_push_sub where user_id = $1`, [userId]);
      let sent = 0;
      for (const s of rows) {
        try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload)); sent++; }
        catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await pool.query(`delete from tas_push_sub where id = $1`, [s.id]); else log(`[push] ${e.message}`); }
      }
      return { sent };
    },
  };
}
