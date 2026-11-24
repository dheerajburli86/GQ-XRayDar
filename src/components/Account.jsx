// Sign-in gate and the signed-in account. Anyone may create an account (owner, 2026-11-24): email + password.
// Accounts are created by the TA server already confirmed (no confirmation email), then the browser signs in.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { auth, LOGIN_REQUIRED, SERVER_ON, api, startSync } from "../lib/server.js";

const Ctx = createContext({ session: null, me: null, serverOn: false });
export const useAccount = () => useContext(Ctx);

export function AccountProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [me, setMe] = useState(null);
  const [meError, setMeError] = useState(null);

  useEffect(() => {
    if (!auth) { setSession(null); return; }
    auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data } = auth.onAuthStateChange((_e, s) => setSession(s || null));
    return () => data.subscription.unsubscribe();
  }, []);

  const refreshMe = useCallback(async () => {
    if (!SERVER_ON) return null;
    try { const m = await api("GET", "/api/me"); setMe(m); setMeError(null); return m; }
    catch (e) { setMeError(e.message); return null; }
  }, []);

  useEffect(() => {
    if (!SERVER_ON) return;
    if (LOGIN_REQUIRED && !session) { setMe(null); return; }
    refreshMe().then((m) => { if (m) startSync().catch((e) => console.warn(`[sync] ${e.message}`)); });
  }, [session, refreshMe]);

  const signOut = async () => { await auth?.signOut(); setMe(null); };
  const value = { session, me, meError, serverOn: SERVER_ON, refreshMe, signOut, email: session?.user?.email || me?.email || null };

  if (LOGIN_REQUIRED) {
    if (session === undefined) return <div className="loading-screen"><div className="box card">Checking sign-in…</div></div>;
    if (!session) return <SignIn />;
    if (SERVER_ON && meError && /disabled/i.test(meError)) return <Blocked text={meError} onSignOut={signOut} />;
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function Brand({ sub }) {
  return <div className="brand"><div className="logo">GQ</div><div><div className="t1">GQ XRayDar</div><div className="t2">{sub}</div></div></div>;
}
function Blocked({ text, onSignOut }) {
  return <div className="loading-screen"><div className="box card stack" style={{ maxWidth: 420 }}><Brand sub="Account" /><div className="note warn">{text}</div><button className="btn" onClick={onSignOut}>Sign out</button></div></div>;
}

/** Sign in / create account / forgot password. */
export function SignIn() {
  const [mode, setMode] = useState("in"); // in | up | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [note, setNote] = useState(null);
  const go = (m) => { setMode(m); setErr(null); setNote(null); };

  const signIn = async (e, p) => {
    const { error } = await auth.signInWithPassword({ email: e.trim(), password: p });
    if (error) throw new Error(/invalid login/i.test(error.message) ? "Wrong email or password." : error.message);
  };
  const submit = async (ev) => {
    ev?.preventDefault();
    if (busy) return;
    setErr(null); setNote(null);
    const e = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setErr("Enter a valid email address."); return; }
    setBusy(true);
    try {
      if (mode === "in") await signIn(e, password);
      else if (mode === "up") {
        if (name.trim().length < 2) throw new Error("Enter your name (at least 2 characters).");
        if (password.length < 8) throw new Error("Use a password of at least 8 characters.");
        if (password !== password2) throw new Error("The two passwords are different.");
        await api("POST", "/api/auth/signup", { email: e, password, name: name.trim() });
        await signIn(e, password);
      } else {
        const { error } = await auth.resetPasswordForEmail(e, { redirectTo: window.location.origin + window.location.pathname });
        if (error) throw new Error(error.message);
        setNote(`If ${e} has an account, a reset link is on its way. If nothing arrives in a few minutes, ask an XRayDar admin to set a temporary password for you.`);
      }
    } catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="loading-screen"><form className="box card stack signin" style={{ maxWidth: 400, width: "100%" }} onSubmit={submit}>
      <Brand sub={mode === "up" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Sign in"} />
      {mode !== "forgot" && (
        <div className="seg" role="tablist">
          <button type="button" className={mode === "in" ? "on" : ""} onClick={() => go("in")}>Sign in</button>
          <button type="button" className={mode === "up" ? "on" : ""} onClick={() => go("up")}>Create account</button>
        </div>
      )}
      {mode === "up" && <label className="stack" style={{ gap: 4 }}><span className="small muted">Your name (shown to other people)</span><input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></label>}
      <label className="stack" style={{ gap: 4 }}><span className="small muted">Email</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      {mode !== "forgot" && <label className="stack" style={{ gap: 4 }}><span className="small muted">Password{mode === "up" ? " (at least 8 characters)" : ""}</span><input type="password" autoComplete={mode === "up" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></label>}
      {mode === "up" && <label className="stack" style={{ gap: 4 }}><span className="small muted">Password again</span><input type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} /></label>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset link"}</button>
      {err && <div className="note warn" role="alert">{err}</div>}
      {note && <div className="note">{note}</div>}
      <div className="row between small">
        {mode === "forgot" ? <a href="#" onClick={(e) => { e.preventDefault(); go("in"); }}>Back to sign in</a> : <a href="#" onClick={(e) => { e.preventDefault(); go("forgot"); }}>Forgot password?</a>}
      </div>
    </form></div>
  );
}

/** The account menu in the top bar: name, change name / password, sign out. */
export function AccountMenu() {
  const acct = useAccount();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState(null);
  if (!acct.session && !acct.me) return null;
  const label = acct.me?.displayName || acct.email?.split("@")[0] || "Account";
  const saveName = async () => { try { await api("PATCH", "/api/me", { displayName: name }); await acct.refreshMe(); setMsg("Name saved."); } catch (e) { setMsg(e.message); } };
  const savePw = async () => {
    if (pw.length < 8) { setMsg("Use at least 8 characters."); return; }
    const { error } = await auth.updateUser({ password: pw });
    setMsg(error ? error.message : "Password changed."); if (!error) setPw("");
  };
  return (
    <span className="acct-menu">
      <button className="btn sm ghost" onClick={() => { setOpen(!open); setName(acct.me?.displayName || ""); setMsg(null); }} title={acct.email || ""}>👤 {label}</button>
      {open && (
        <div className="acct-pop card stack" onMouseLeave={() => setOpen(false)}>
          <div className="small muted">{acct.email}{acct.me?.isAdmin ? " · admin" : ""}</div>
          <label className="stack" style={{ gap: 4 }}><span className="small muted">Name shown to others</span>
            <div className="row"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} style={{ flex: 1 }} /><button className="btn sm" onClick={saveName}>Save</button></div></label>
          {auth && <label className="stack" style={{ gap: 4 }}><span className="small muted">New password</span>
            <div className="row"><input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1 }} /><button className="btn sm" onClick={savePw}>Change</button></div></label>}
          <div className="small muted">GQ Agent: {acct.me?.agentAccess?.enabled ? "on" : "off (an admin can switch it on)"}</div>
          {msg && <div className="small">{msg}</div>}
          {acct.session && <button className="btn sm" onClick={acct.signOut}>Sign out</button>}
        </div>
      )}
    </span>
  );
}
