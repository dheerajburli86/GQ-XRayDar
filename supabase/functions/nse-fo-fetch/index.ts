// Fetches one of NSE's public end-of-day derivatives files on behalf of the TA
// server, whose cloud IP the exchange's archive refuses. Only the four file
// families the collector uses are allowed: this is not a general proxy.
const ALLOWED = [
  /^\/content\/fo\/BhavCopy_NSE_FO_0_0_0_\d{8}_F_0000\.csv\.zip$/,
  /^\/content\/nsccl\/fao_participant_oi_\d{8}\.csv$/,
  /^\/content\/fo\/fo_secban_\d{8}\.csv$/,
  /^\/archives\/nsccl\/mwpl\/combineoi_\d{8}\.zip$/,
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

Deno.serve(async (req: Request) => {
  const path = new URL(req.url).searchParams.get("path") || "";
  if (!ALLOWED.some((re) => re.test(path))) return new Response("path not allowed", { status: 400 });
  let cookie = "";
  try {
    const h = await fetch("https://www.nseindia.com/", { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(15000) });
    cookie = (h.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
    await h.body?.cancel();
  } catch { /* the archive often answers without a cookie */ }
  try {
    const r = await fetch(`https://nsearchives.nseindia.com${path}`, { headers: { "User-Agent": UA, Accept: "*/*", Referer: "https://www.nseindia.com/", ...(cookie ? { Cookie: cookie } : {}) }, signal: AbortSignal.timeout(45000) });
    return new Response(r.body, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/octet-stream", "x-upstream-status": String(r.status) } });
  } catch (e) {
    return new Response(`upstream error: ${(e as Error).message}`, { status: 502 });
  }
});
