# Notes for Claude Code sessions on this repo

This is the **GQ AI-Powered Technical Analysis Software**, a standalone product. It is
NOT part of the heatmap dashboard and must not be wired into it.

## Hard rules

- **Never write to a heatmap-owned table** (instruments, price_history, returns_latest,
  fundamentals, fx_rates, glocom_latest, ...). The engine reads them; it writes only `tas_*`.
  Schema changes go in `supabase/migrations/` and only touch `tas_*` objects.
- **One engine.** Any number shown in the app comes from `engine/`. Do not re-implement
  maths in a page; add it to the engine (and a test in `tests/`).
- **Fields go through `engine/fields.js`.** Screens, heatmap colours, alerts and the NL
  parser read the registry; adding a screenable value means adding a field there (and it
  automatically joins the flat screen row).
- **Do not invent GLOCOM, LOCOM or IMB formulas.** GLOCOM is read from the heatmap's
  `glocom_latest`; the others wait for their definitions (requirements #35-37, #95).
- **Never label estimated data as observed.** Historical market caps (constant shares),
  carried FX and stale constituents are estimated / flagged; keep it that way.
- The demo is synthetic and must keep its "DEMO DATA" banner.

- **The server sends, the GQ agent polls.** `server/` uses the GQ agent's bot token for
  `sendMessage` only. Never add `getUpdates` / a webhook here: Telegram allows one poller.
- **Alerts fire on an edge, once.** `tas_alert_event`'s UNIQUE key is the de-duplication and
  the row is inserted BEFORE anything is sent; template rules seed silently on first sight.
  Do not move either into memory or reorder them.
- **User tables are server-only.** `tas_user*`, `tas_alert_event`, `tas_task`, `tas_push_sub`,
  `tas_digest_log` have RLS on and no policies; the browser reaches them only through
  `server/` (Supabase login + @gquants.com, or the agent secret).
- **Shared maths stays in `engine/`**: the chart read (`chartRead.js`) and the report card
  (`scorecard.js`) run in the browser and on the server from the same file.

## Checks before committing

```
npm test && npm run lint && npm run build
npm run test:server   # needs the local Postgres below with an engine run + 20261114 migration
```

Local end-to-end check of the batch engine against a throw-away Postgres:
`DATABASE_URL=postgres://postgres@localhost:5433/postgres node scripts/local-integration.mjs && node cli/run.mjs`
(the script refuses any non-local database).

## Gotchas

- Dates are ISO strings everywhere; never round-trip a session date through `new Date()`
  in the browser (timezones shift it).
- `periodKey(..., "W")` is cached; weekly candles are stamped with their LAST session.
- Supabase PostgREST returns at most 1000 rows per request; `supabaseApi.all()` pages.
- `tas_index_values` is per index-year; `tas_index_series(key)` unnests it for SQL users.
- Event rows are stored compact (`engine/eventCodec.js`); decode before use.
- The heatmap mutes India non-equities with `is_active=false`; the engine therefore skips
  inactive India rows but keeps inactive US / global ones (delisted companies).
