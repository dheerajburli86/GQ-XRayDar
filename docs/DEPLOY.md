# Deploying GQ Technical Analysis

Four pieces, three places:

| Piece | What it does | Where it runs |
|---|---|---|
| **Web app** (`src/`) | the dashboard people open | **Vercel** |
| **TA server** (`server/`) | login check, alerts on Telegram, morning and weekly summaries, tasks, the GQ agent panel, account sync of watchlists, alerts and notes | **Railway**, always on |
| **Engine** (`cli/run.mjs`) | the nightly calculation: indices, signals, scores (writes `tas_*` tables) | **Railway** cron (or GitHub Actions) |
| **GQ agent** (the existing `GQagent` repo) | the Telegram bot; gains the `ta_*` tools and `/ta link` | **Railway**, already running |

```
                         heatmap Supabase (prices: read only)
                 ┌───────────────┬────────────────┬──────────────────┐
                 │ reads         │ reads + tas_*  │ reads tas_*       │
          ┌──────▼──────┐ ┌──────▼──────┐  ┌──────▼──────┐
          │ Engine cron │ │  TA server  │◄─┤  Web app    │  (Vercel)
          │ (Railway)   │ │ (Railway)   │  └─────────────┘
          └─────────────┘ └──┬────▲─────┘
                 sends alerts │    │ ta_* tools (TA_API_SECRET)
                      ┌───────▼────┴──────┐
                      │ GQ agent (Railway)│ ── Telegram ── you
                      └───────────────────┘
```

Nothing here writes to a heatmap table. Every write goes to `tas_*` tables.

Do the steps in order. Each says how to check it worked.

---

## Step 0: Things you need

- The Supabase project of the heatmap (`xmcvsnollphnsonaupzt`), with access to the SQL editor.
- The **database connection string**: Supabase → *Project settings → Database →
  Connection string → Session pooler* (it starts `postgresql://postgres.`). This is
  `DATABASE_URL`. It is a password: only ever put it in Railway / GitHub secrets.
- The **anon (publishable) key**: Supabase → *Project settings → API*. Safe for the browser.
- The GQ agent's **Telegram bot token** (already in the agent's Railway variables as
  `TELEGRAM_BOT_TOKEN`).
- A long random string for `TA_API_SECRET`. Make one with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## Step 1: Create the tables (5 min)

In the Supabase SQL editor run, in this order:

1. `supabase/migrations/20261113000000_tas_schema.sql` (analysis tables)
2. `supabase/migrations/20261114000000_tas_users.sql` (accounts, alerts, tasks)

Check: *Table editor* now lists `tas_calc_run`, `tas_user`, `tas_task` and friends.
The second file switches row-level security on with no policies, so the browser
key can read nothing in the user tables; only the TA server can.

## Step 2: Engine on Railway (15 min)

1. Railway → your project → **New → GitHub repo** → pick this repository.
2. Service **Settings**:
   - *Root directory*: leave empty (the repo root).
   - *Config as code*: set the path to `railway.engine.json`. That file sets the
     Dockerfile, the start command and the cron `40 2 * * 2-6` (02:40 UTC Tue–Sat
     = 08:10 IST, after the heatmap's global prices, clear of its 05:30 UTC
     technical run and the India window). Railway's dashboard wins over the file:
     if a *Custom Start Command* or *Cron Schedule* is typed there, delete it.
   - *Resources*: give it **8 GB memory** (a full global run holds ~22k stocks).
3. **Variables**: `DATABASE_URL`, and `FMP_API_KEY` (for historical FX; optional).
4. First run: open the service → **Deploy → Run now** (or temporarily set the
   start command to `node cli/run.mjs --dry-run` to compute without writing).

Check: the log ends with `done in … min`, and `select status, stats->'dates' from
tas_calc_run order by started desc limit 1;` shows `ok`.

> Prefer GitHub Actions? `.github/workflows/engine.yml` does the same with 16 GB
> for free; add the `DATABASE_URL` secret and uncomment its `schedule`. Use one,
> not both.

## Step 3: TA server on Railway (15 min)

1. Railway → **New → GitHub repo** → this repository again (a second service).
2. *Settings*: root directory empty; *Config as code* → `railway.server.json`
   (Dockerfile build, `node server/index.mjs`, health check `/health`, 1 replica).
3. *Settings → Networking → Generate Domain*. Note the URL, e.g.
   `https://gq-ta-server.up.railway.app`.
4. **Variables**:

   ```
   DATABASE_URL=<session pooler string>
   SUPABASE_URL=https://xmcvsnollphnsonaupzt.supabase.co
   SUPABASE_ANON_KEY=<anon key>
   ALLOWED_EMAIL_DOMAINS=gquants.com
   ADMIN_EMAILS=dheeraj.burli@gquants.com        # optional
   APP_ORIGINS=https://<your-app>.vercel.app      # fill in after Step 5
   APP_URL=https://<your-app>.vercel.app
   TA_API_SECRET=<the random string from Step 0>
   TELEGRAM_BOT_TOKEN=<the GQ agent's bot token>
   TELEGRAM_BOT_USERNAME=GQagent_bot
   GQAGENT_URL=<the agent's public URL, Step 4>   # optional; empty = built-in assistant
   ```

   Optional phone pop-ups: run `npx web-push generate-vapid-keys` once and add
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. Optional timing:
   `MORNING_SUMMARY_IST=09:15`, `WEEKLY_SUMMARY_IST=sat 09:00`, `ALERT_POLL_MINUTES=15`.

Check: open `https://<server>/health`. It should say `"ok":true,"db":true` and a
`dataAsOf` date (after the engine has run once).

**Why sharing the bot token is safe:** Telegram lets only one program *read* a bot's
messages. The GQ agent reads them; this server only *sends* (`sendMessage`), so the
two never clash. Do not run a second copy of the GQ agent.

## Step 4: Connect the GQ agent (10 min)

In the GQ agent repo, apply the patch kept in this repo at
`integrations/gqagent-technical-analysis.patch` and push:

```bash
cd GQagent
git am ../gq-technical-analysis/integrations/gqagent-technical-analysis.patch
npm install && npm test     # 156 tests
git push                    # Railway redeploys the bot
```

It adds `src/tools/technical.js` (the `ta_*` tools), `/ta link` / `/ta unlink`,
`POST /api/chat` for the web panel, three variables in `src/config.js`, a prompt
section and `tests/technical.test.cjs`. Nothing else in the agent changes.

In the agent's Railway service → **Variables**, add:

```
TA_API_URL=https://<ta-server>.up.railway.app
TA_API_SECRET=<same value as the TA server>
TA_APP_URL=https://<your-app>.vercel.app
```

For the web app's agent panel to use the full agent (news, web search) instead of
the built-in assistant: agent service → *Settings → Networking → Generate Domain*,
then put that URL into the TA server's `GQAGENT_URL`.

Check: send the bot `/ta` in Telegram. It answers with the Technical Analysis help.
`analyse TCS` should return a technical read with an "as of" date.

## Step 5: Web app on Vercel (10 min)

1. vercel.com → **Add New → Project** → import this repository.
2. Framework preset **Vite** (detected; `vercel.json` sets build `npm run build`,
   output `dist`). Root directory: the repo root.
3. **Environment variables** (Production and Preview):

   ```
   VITE_SUPABASE_URL=https://xmcvsnollphnsonaupzt.supabase.co
   VITE_SUPABASE_ANON_KEY=<anon key>
   VITE_TA_SERVER_URL=https://<ta-server>.up.railway.app
   VITE_ALLOWED_EMAIL_DOMAINS=gquants.com
   ```

   Only `VITE_*` values reach the browser. Never add `DATABASE_URL`, the bot token
   or `TA_API_SECRET` to Vercel.
4. **Deploy**. Note the URL and put it into the TA server's `APP_ORIGINS` and
   `APP_URL`, and the agent's `TA_APP_URL` (Railway redeploys on save).
5. **Login redirect**: Supabase → *Authentication → URL configuration* → add the
   Vercel URL (and `http://localhost:5173` for local work) to *Redirect URLs*.
   Email links work out of the box. For "Sign in with Google", enable the Google
   provider under *Authentication → Providers* if the heatmap has not already.

Check: open the Vercel URL, sign in with your @gquants.com account, and the
Command centre loads with the latest data date in the top bar. Someone with a
non-GQuants email is refused, both by the app and by the server.

## Step 6: Link Telegram and try it (5 min, each person)

1. In the app: **Alerts → Telegram & summaries → Get a link code**.
2. In Telegram, in a private chat with `@GQagent_bot`: `/ta link 123456`.
3. Back in the app press **Refresh**, then **Send a test message**.
4. Add an alert (Alerts → Indicator alerts), or ask the bot:
   "alert me when TCS weekly RSI crosses above 60",
   "every weekday at 8:45 tell me which of my Core list are rising".

Alerts are checked every 15 minutes against the newest stored candle; each one is
sent once. The morning summary arrives on weekdays at 09:15 IST and the weekly one
on Saturday at 09:00 IST (switch either off in the same tab).

## Install on a phone

The web app is installable: Android Chrome → menu → *Install app*; iPhone Safari
→ Share → *Add to Home Screen*. With the VAPID keys set, **Alerts → Telegram &
summaries → Enable on this device** turns on pop-up alerts (on iPhone only from
the Home Screen app, iOS 16.4+).

---

## Day to day

| Task | How |
|---|---|
| See if alerts are running | `GET /health` on the TA server; the service log shows `[alerts] N new alert(s) delivered` |
| Pause everyone's background jobs | TA server variable `JOBS_ENABLED=false` |
| Re-run the engine now | Railway engine service → *Run now* |
| Change the summary times | `MORNING_SUMMARY_IST`, `WEEKLY_SUMMARY_IST` on the TA server |
| Local server against a test database | `AUTH_MODE=dev DATABASE_URL=… node server/index.mjs` (trusts an `x-dev-email` header: never in production) |

## Troubleshooting

- **App says "Could not load data… No successful calculation run"**: the engine has
  not finished a run yet (Step 2).
- **Alerts tab says "Connecting to the server…" forever**: `VITE_TA_SERVER_URL` is
  wrong, or the Vercel URL is missing from the server's `APP_ORIGINS` (a CORS
  refusal shows in the browser console).
- **Telegram: "This Telegram account is not linked"**: do Step 6 with a fresh code
  (codes last 15 minutes and work once).
- **Bot: "The Technical Analysis server rejected the agent"**: `TA_API_SECRET`
  differs between the agent and the TA server.
- **Bot answers technical questions from the web instead of the app**: the agent
  is missing `TA_API_URL` / `TA_API_SECRET`, so the `ta_*` tools are not loaded.
