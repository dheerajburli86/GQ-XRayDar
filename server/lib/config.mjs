// Every setting is an environment variable (Railway service variables).
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const list = (v) => String(v || "").split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

export function loadConfig(e = process.env) {
  return {
    port: int(e.PORT, 8787),
    databaseUrl: e.DATABASE_URL || "",
    // Supabase Auth (the heatmap project's auth): used only to verify web logins
    supabaseUrl: (e.SUPABASE_URL || "").replace(/\/$/, ""),
    supabaseAnonKey: e.SUPABASE_ANON_KEY || "",
    // Anyone may create an account and sign in (owner, 2026-11-24). OPEN_SIGNUP=0 goes back to the domain list.
    openSignup: (e.OPEN_SIGNUP || "1") !== "0",
    allowedDomains: list(e.ALLOWED_EMAIL_DOMAINS || "gquants.com"),
    allowedEmails: list(e.ALLOWED_EMAILS),
    adminEmails: list(e.ADMIN_EMAILS),
    authMode: (e.AUTH_MODE || "supabase").toLowerCase(), // "dev" only for local tests: trusts x-dev-email
    appOrigins: list(e.APP_ORIGINS || "http://localhost:5173,http://localhost:4173"),
    appUrl: (e.APP_URL || "").replace(/\/$/, ""),
    // Shared secret between this server and the GQ agent (both directions)
    agentSecret: e.TA_API_SECRET || "",
    // Guests (no login) using the agent: OFF. The whole site needs sign-in and the agent is per-person (owner,
    // 2026-11-24, after the morning's open trial). AGENT_PUBLIC=1 turns the guest path back on.
    agentPublic: (e.AGENT_PUBLIC || "0") === "1",
    agentUrl: (e.GQAGENT_URL || "").replace(/\/$/, ""),
    // Telegram: the SAME bot token the GQ agent uses. This server only SENDS
    // (sendMessage); it never polls, so it does not conflict with the agent.
    telegramToken: e.TELEGRAM_BOT_TOKEN || "",
    telegramBotUsername: e.TELEGRAM_BOT_USERNAME || "GQagent_bot",
    telegramApiBase: e.TELEGRAM_API_BASE || "https://api.telegram.org",
    vapidPublic: e.VAPID_PUBLIC_KEY || "",
    vapidPrivate: e.VAPID_PRIVATE_KEY || "",
    vapidSubject: e.VAPID_SUBJECT || "mailto:tech@gquants.com",
    alertPollMinutes: int(e.ALERT_POLL_MINUTES, 15),
    alertMaxInstruments: int(e.ALERT_MAX_INSTRUMENTS, 2000),
    jobsEnabled: (e.JOBS_ENABLED || "true").toLowerCase() !== "false",
    morningSummaryTime: e.MORNING_SUMMARY_IST || "09:15",
    weeklySummaryTime: e.WEEKLY_SUMMARY_IST || "sat 09:00",
    rateLimitPerMin: int(e.RATE_LIMIT_PER_MIN, 120),
    // Optional alert channels
    resendKey: e.RESEND_API_KEY || "",
    alertEmailFrom: e.ALERT_EMAIL_FROM || "GQ XRayDar <alerts@gquants.com>",
    webhookSecret: e.WEBHOOK_SIGNING_SECRET || "",
  };
}
