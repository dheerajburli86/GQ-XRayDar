// Task list (features 5.1, 5.3, 4.8): jobs for the GQ Agent such as "check
// these 20 stocks and tell me which are rising" or "every Monday summarise my
// list". With the server connected they run there on a schedule and report on
// Telegram; without it they run here, once, when you press Run.
import { useEffect, useState } from "react";
import { useData } from "../data/store.jsx";
import { PageHead, Select, Badge, Seg, Pct, StockLink, Empty } from "../components/ui.jsx";
import { InstrumentPicker } from "../components/pickers.jsx";
import { useAccount } from "../components/Account.jsx";
import { api } from "../lib/server.js";
import { usePersistent, uid } from "../lib/storage.js";
import { parseCommand } from "../../engine/nl.js";
import { runScreen, FIELD } from "../../engine/fields.js";

const KINDS = [
  { value: "review_list", label: "Which names in a list are rising" },
  { value: "screen", label: "Run a screen (plain English)" },
  { value: "summary", label: "Market summary" },
  { value: "compare", label: "Compare two stocks" },
  { value: "analyze", label: "Analyse one stock" },
];
const STATUS = { pending: "", running: "a", done: "g", failed: "r", paused: "" };

/** Same rule as the server's review: weekly MMA bullish, or weekly uptrend above the 50-day. */
function reviewLocal(d, ids) {
  const rows = ids.map((id) => d.rowById.get(id)).filter(Boolean);
  const rising = (r) => r.flat.mmaBullW === true || (r.flat.trendUpW && r.flat.above50);
  const items = rows.map((r) => ({ id: r.id, symbol: r.sec.symbol, rising: !!rising(r), ret1M: r.flat.ret1M, ret3M: r.flat.ret3M, weeklyMma: r.flat.mmaW, stage: r.flat.stage }));
  return { asOf: d.info.asOf, rising: items.filter((x) => x.rising), notRising: items.filter((x) => !x.rising), rule: "Rising = weekly MMA in bullish alignment, or price in a weekly uptrend and above its 50-day EMA" };
}

export default function Tasks() {
  const d = useData();
  const acct = useAccount();
  const remote = acct.serverOn && acct.me;
  const [wls] = usePersistent("watchlists", {});
  const [local, setLocal] = usePersistent("tasks.local", []);
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  const [f, setF] = useState({ kind: "review_list", title: "", watchlist: null, query: "", scope: "G", a: null, b: null, symbol: null, when: "once", time: "08:45", dow: "mon" });

  const load = () => api("GET", "/api/tasks").then(setList).catch((e) => setErr(e.message));
  useEffect(() => { if (remote) { load(); const t = setInterval(load, 15000); return () => clearInterval(t); } }, [remote]);

  const params = () => {
    if (f.kind === "review_list") return { watchlist: wls[f.watchlist]?.name, ids: undefined };
    if (f.kind === "screen") return { query: f.query, limit: 25 };
    if (f.kind === "summary") return { scope: f.scope };
    if (f.kind === "compare") return { a: d.secById.get(f.a?.id)?.symbol, b: d.secById.get(f.b?.id)?.symbol };
    return { symbol: d.secById.get(f.symbol?.id)?.symbol };
  };
  const ready = f.kind === "review_list" ? !!f.watchlist : f.kind === "screen" ? !!f.query.trim() : f.kind === "compare" ? f.a && f.b : f.kind === "analyze" ? !!f.symbol : true;
  const schedule = f.when === "once" ? null : f.when === "weekly" ? `weekly ${f.dow} ${f.time}` : `${f.when} ${f.time}`;
  const title = f.title || `${KINDS.find((k) => k.value === f.kind).label}${f.kind === "review_list" && f.watchlist ? `: ${wls[f.watchlist]?.name}` : f.kind === "screen" ? `: ${f.query}` : ""}`;

  const create = async () => {
    setErr(null);
    if (remote) {
      try { await api("POST", "/api/tasks", { kind: f.kind, title, params: params(), schedule }); load(); } catch (e) { setErr(e.message); }
    } else {
      setLocal([{ id: uid(), title, kind: f.kind, params: { ...params(), watchlistId: f.watchlist }, status: "pending", created_at: new Date().toISOString() }, ...local]);
    }
  };
  const runLocal = (t) => {
    let result;
    if (t.kind === "review_list") result = reviewLocal(d, wls[t.params.watchlistId]?.ids || []);
    else if (t.kind === "screen") { const c = parseCommand(t.params.query, { securities: d.secs, countries: d.countries }); const rows = runScreen(d.rows, { conditions: c.conditions, scope: c.scope }); result = { total: rows.length, understood: c.understood, results: rows.sort((a, b) => (FIELD.score.get(b) ?? -1) - (FIELD.score.get(a) ?? -1)).slice(0, 25).map((r) => ({ id: r.id, symbol: r.sec.symbol, name: r.sec.name, country: r.sec.country })) }; }
    else result = { error: "This kind of task runs on the server (it needs Telegram or the GQ agent). Use the GQ Agent panel to ask it now." };
    setLocal(local.map((x) => (x.id === t.id ? { ...x, status: result.error ? "failed" : "done", result, last_run: new Date().toISOString() } : x)));
  };
  const act = async (t, patch) => { try { if (patch === "delete") await api("DELETE", `/api/tasks/${t.id}`); else await api("PATCH", `/api/tasks/${t.id}`, patch); load(); } catch (e) { setErr(e.message); } };
  const tasks = remote ? list || [] : local;

  return (
    <div className="stack">
      <PageHead title="Tasks" sub={remote ? `Jobs run on the server${acct.me.telegramLinked ? " and report to you on Telegram when they finish" : " (link Telegram under Alerts to get progress messages)"}. You can also create them by asking the GQ Agent, e.g. "every weekday at 8:45 tell me which of my Core list are rising".` : "Without the server, tasks run here when you press Run. Connect the TA server for schedules and Telegram progress messages."} />
      <div className="card stack">
        <h3 style={{ margin: 0 }}>New task</h3>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <Select label="Job" value={f.kind} options={KINDS} onChange={(kind) => setF({ ...f, kind })} />
          {f.kind === "review_list" && <Select label="Watchlist" value={f.watchlist} options={Object.entries(wls).map(([k, v]) => ({ value: k, label: `${v.name} (${v.ids.length})` }))} onChange={(watchlist) => setF({ ...f, watchlist })} allowEmpty="Pick" />}
          {f.kind === "screen" && <input style={{ minWidth: 340 }} placeholder="e.g. India stocks weekly MMA bullish and RSC rising" value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} />}
          {f.kind === "summary" && <Select label="Market" value={f.scope} options={[{ value: "G", label: "Global" }, ...d.regions.map((r) => ({ value: `R:${r}`, label: r })), ...d.countries.map((c) => ({ value: `C:${c}`, label: c }))]} onChange={(scope) => setF({ ...f, scope })} />}
          {f.kind === "compare" && <><InstrumentPicker allowIndex={false} value={f.a} onChange={(a) => setF({ ...f, a })} width={200} /><InstrumentPicker allowIndex={false} value={f.b} onChange={(b) => setF({ ...f, b })} width={200} /></>}
          {f.kind === "analyze" && <InstrumentPicker allowIndex={false} value={f.symbol} onChange={(symbol) => setF({ ...f, symbol })} width={240} />}
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <Seg value={f.when} options={[{ value: "once", label: "Once now" }, ...(remote ? [{ value: "daily", label: "Daily" }, { value: "weekdays", label: "Weekdays" }, { value: "weekly", label: "Weekly" }] : [])]} onChange={(when) => setF({ ...f, when })} />
          {f.when === "weekly" && <Select value={f.dow} options={["mon", "tue", "wed", "thu", "fri", "sat", "sun"]} onChange={(dow) => setF({ ...f, dow })} />}
          {f.when !== "once" && <label className="lbl-ctl">at (IST)<input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>}
          <input placeholder="Title (optional)" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} style={{ width: 220 }} />
          <button className="btn primary sm" disabled={!ready} onClick={create}>Add task</button>
        </div>
        {err && <div className="note warn small">{err}</div>}
      </div>
      {!tasks.length ? <Empty>No tasks yet.</Empty> : tasks.map((t) => (
        <div key={t.id} className="card stack" style={{ gap: 6 }}>
          <div className="row between">
            <div className="row"><b>{t.title}</b><Badge kind={STATUS[t.status]}>{t.status}{t.status === "running" && t.progress ? ` ${t.progress}%` : ""}</Badge>{t.schedule && <Badge>{t.schedule} IST</Badge>}{t.source === "telegram" && <Badge>from Telegram</Badge>}</div>
            <div className="row">
              {remote ? <>
                <button className="btn sm" onClick={() => act(t, { runNow: true })}>Run now</button>
                {t.schedule && <button className="btn sm" onClick={() => act(t, { status: t.status === "paused" ? "pending" : "paused" })}>{t.status === "paused" ? "Resume" : "Pause"}</button>}
                <button className="btn sm ghost" onClick={() => confirm("Delete this task?") && act(t, "delete")}>✕</button>
              </> : <>
                <button className="btn sm" onClick={() => runLocal(t)}>Run</button>
                <button className="btn sm ghost" onClick={() => setLocal(local.filter((x) => x.id !== t.id))}>✕</button>
              </>}
            </div>
          </div>
          <div className="small muted">{t.last_run ? `Last run ${new Date(t.last_run).toLocaleString()}` : "Not run yet"}{t.next_run && t.schedule ? ` · next ${new Date(t.next_run).toLocaleString()}` : ""}{t.error ? ` · error: ${t.error}` : ""}</div>
          {t.result && <TaskResult kind={t.kind} r={t.result} />}
        </div>
      ))}
    </div>
  );
}

const S = ({ d, id, symbol }) => <StockLink sec={d.secById.get(id)}>{symbol}</StockLink>;

function TaskResult({ kind, r }) {
  const d = useData();
  if (r.error) return <div className="note warn small">{r.error}</div>;
  if (kind === "review_list") return (
    <div className="small stack" style={{ gap: 4 }}>
      <div><b className="pos">Rising ({r.rising.length}):</b> {r.rising.map((x, i) => <span key={x.id}>{i ? ", " : ""}<S d={d} {...x} /> <Pct v={x.ret1M} /></span>)}</div>
      <div><b>Not rising ({r.notRising.length}):</b> {r.notRising.map((x, i) => <span key={x.id}>{i ? ", " : ""}<S d={d} {...x} /></span>)}</div>
      <div className="muted">{r.rule} · data to {r.asOf}</div>
    </div>);
  if (kind === "screen") return <div className="small">{r.total} matches{r.understood?.length ? ` (${r.understood.join(", ")})` : ""}: {r.results.map((x, i) => <span key={x.id}>{i ? ", " : ""}<S d={d} {...x} /></span>)}</div>;
  if (kind === "summary") return <div className="small">{r.scope} to {r.asOf}: CW 1W <Pct v={r.cwIndex?.chg1W} />, 1M <Pct v={r.cwIndex?.chg1M} />{r.breadth ? ` · ${r.breadth.pctAbove50d}% above 50-day · ${r.breadth.newHighs} new highs / ${r.breadth.newLows} new lows` : ""}{r.regime ? ` · ${r.regime.label}` : ""}</div>;
  if (kind === "compare") return <div className="small">{r.left?.symbol}: 3M <Pct v={r.left?.returns?.["3M"]} />, weekly MMA {r.left?.weeklyMma}, stage {r.left?.stage} · {r.right?.symbol}: 3M <Pct v={r.right?.returns?.["3M"]} />, weekly MMA {r.right?.weeklyMma}, stage {r.right?.stage}</div>;
  if (kind === "analyze") return r.instrument ? <div className="small"><S d={d} id={r.instrument.id} symbol={r.instrument.symbol} />: {r.stage?.label}; weekly MMA {r.timeframes?.weekly?.mma}; 3M <Pct v={r.returnsLocalPct?.["3M"]} /></div> : <div className="small">{JSON.stringify(r).slice(0, 300)}</div>;
  return null;
}
