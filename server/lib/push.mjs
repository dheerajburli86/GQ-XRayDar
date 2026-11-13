// Web push (phone / desktop pop-ups for the installed app). Optional: on only
// when VAPID keys are set. Generate them once with: npx web-push generate-vapid-keys
export async function createPush(cfg, pool, log = console.log) {
  if (!cfg.vapidPublic || !cfg.vapidPrivate) return { enabled: false, publicKey: null, async notify() { return { skipped: "push not configured" }; } };
  const { default: webpush } = await import("web-push");
  webpush.setVapidDetails(cfg.vapidSubject, cfg.vapidPublic, cfg.vapidPrivate);
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
