// Daily / weekly / monthly market briefs written from stored calculations.
import { useState } from "react";
import { useData } from "../data/store.jsx";
import { useAsync } from "../lib/useAsync.js";
import { PageHead, Seg, Loading } from "../components/ui.jsx";
import { writeBrief } from "../../engine/briefs.js";
import { breadthDivergence } from "../../engine/breadth.js";
import { downloadBlob } from "../lib/exporters.js";

export default function Briefs() {
  const d = useData();
  const [period, setPeriod] = useState("weekly");
  const { data, loading } = useAsync(async () => {
    const [gc, ge, br, rot, ewcw] = await Promise.all([d.api.indexSeries("CW|USD|G"), d.api.indexSeries("EW|USD|G"), d.api.breadth("G"), d.api.rotation("G"), d.api.ewcw()]);
    const regions = await Promise.all(d.regions.map(async (r) => ({ name: r, series: await d.api.indexSeries(`CW|USD|R:${r}`) })));
    const countries = await Promise.all(d.countries.map(async (c) => ({ name: c, series: await d.api.indexSeries(`CW|USD|C:${c}`) })));
    return { gc, ge, br, rot, ewcw, regions, countries };
  }, []);
  if (loading || !data) return <Loading what="brief inputs" />;
  const bars = { daily: 1, weekly: 5, monthly: 21 }[period];
  const since = data.br?.dates?.[Math.max(0, data.br.dates.length - 1 - bars)];
  const brief = writeBrief({ period, asOf: d.info.asOf, sinceDate: since, global: { CW: data.gc, EW: data.ge }, regions: data.regions.filter((r) => r.series), countries: data.countries.filter((c) => c.series),
    breadth: { global: data.br }, rotation: data.rot || [], regimes: d.regimes, ewcwGlobal: data.ewcw.find((e) => e.pairKey === "USD|G"), rows: d.rows, divergence: breadthDivergence(data.gc, data.br, bars < 5 ? 5 : bars) });
  const text = `${brief.title} — ${brief.asOf}\n\n${brief.sections.map((s) => `${s.title}\n${s.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n")}\n\n${brief.note}\n`;
  return (
    <div className="stack">
      <PageHead title="Market briefs" sub="Automated research summaries. Every number comes from the stored index, breadth, rotation and signal calculations for the date shown.">
        <Seg value={period} options={["daily", "weekly", "monthly"]} onChange={setPeriod} />
        <button className="btn sm" onClick={() => navigator.clipboard?.writeText(text)}>Copy</button>
        <button className="btn sm" onClick={() => downloadBlob(new Blob([text], { type: "text/markdown" }), `gq_${period}_brief_${brief.asOf}.md`)}>Download</button>
      </PageHead>
      <div className="card brief" style={{ maxWidth: 980 }}>
        <h2>{brief.title} · {brief.asOf}</h2>
        {brief.sections.map((s) => <div key={s.title} style={{ marginBottom: 10 }}><h3>{s.title}</h3>{s.lines.map((l, i) => <p key={i}>{l}</p>)}</div>)}
        <div className="small muted">{brief.note}</div>
      </div>
    </div>
  );
}
