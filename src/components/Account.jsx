// Sign-in gate and the signed-in account (feature 6.3: only the team can sign in).
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { auth, LOGIN_REQUIRED, SERVER_ON, ALLOWED_DOMAINS, emailAllowed, api, startSync } from "../lib/server.js";

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
    if (LOGIN_REQUIRED && !session) return;
    refreshMe().then((m) => { if (m) startSync().catch((e) => console.warn(`[sync] ${e.message}`)); });
  }, [session, refreshMe]);

  const signOut = async () => { await auth?.signOut(); setMe(null); };
  const value = { session, me, meError, serverOn: SERVER_ON, refreshMe, signOut, email: session?.user?.email || me?.email || null };

  if (LOGIN_REQUIRED) {
    if (session === undefined) return <div className="loading-screen"><div className="box card">Checking sign-in…</div></div>;
    if (!session) return <SignIn />;
    if (!emailAllowed(session.user.email)) return <SignIn blocked={session.user.email} onSignOut={signOut} />;
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function SignIn({ blocked, onSignOut }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);
  const redirectTo = window.location.origin + window.location.pathname;
  const google = async () => { setErr(null); const { error } = await auth.signInWithOAuth({ provider: "google", options: { redirectTo, queryParams: { hd: ALLOWED_DOMAINS[0] } } }); if (error) setErr(error.message); };
  const link = async () => {
    setErr(null);
    if (!emailAllowed(email)) { setErr(`Use your @${ALLOWED_DOMAINS.join(" / @")} email.`); return; }
    const { error } = await auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true } });
    if (error) setErr(error.message); else setSent(true);
  };
  return (
    <div className="loading-screen">
      <div className="box card stack" style={{ maxWidth: 420 }}>
        <div className="brand"><div className="logo">GQ</div><div><div className="t1">GQ XRayDar</div><div className="t2">GQuants team sign-in</div></div></div>
        {blocked ? (
          <>
            <div className="note warn">{blocked} is not allowed to use this app. Sign in with your @{ALLOWED_DOMAINS[0]} account.</div>
            <button className="btn" onClick={onSignOut}>Sign out</button>
          </>
        ) : sent ? (
          <div className="note">Check {email}: we sent you a sign-in link. Open it on this device.</div>
        ) : (
          <>
            <button className="btn primary" onClick={google}>Sign in with Google</button>
            <div className="small muted" style={{ textAlign: "center" }}>or get a sign-in link by email</div>
            <div className="row"><input style={{ flex: 1 }} type="email" placeholder={`you@${ALLOWED_DOMAINS[0]}`} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && link()} /><button className="btn" onClick={link}>Send link</button></div>
          </>
        )}
        {err && <div className="note warn">{err}</div>}
      </div>
    </div>
  );
}
