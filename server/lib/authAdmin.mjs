// Account creation and password changes in XRayDar's own Supabase Auth project (admin API, service key).
// The service key never leaves the server.
import { HttpError } from "./http.mjs";

export function createAuthAdmin(cfg, fetchImpl = fetch) {
  const call = async (method, path, body) => {
    let r;
    try {
      r = await fetchImpl(`${cfg.authUrl}/auth/v1/admin${path}`, {
        method, signal: AbortSignal.timeout(15_000),
        headers: { apikey: cfg.authServiceKey, authorization: `Bearer ${cfg.authServiceKey}`, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new HttpError(503, "the sign-in system did not answer; try again in a moment"); }
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  };
  return {
    async createUser(email, password, name) {
      const { status, j } = await call("POST", "/users", { email, password, email_confirm: true, user_metadata: { full_name: name } });
      if (status === 422 && /exist|registered/i.test(`${j.error_code} ${j.msg} ${j.message}`)) throw new HttpError(409, "An account with this email already exists. Sign in instead.");
      if (status >= 400 || !j.id) throw new HttpError(status === 422 ? 400 : 502, j.msg || j.message || "could not create the account");
      return j.id;
    },
    async setPassword(userId, password) {
      const { status, j } = await call("PUT", `/users/${userId}`, { password });
      if (status === 404) return false;
      if (status >= 400) throw new HttpError(status === 422 ? 400 : 502, j.msg || j.message || "could not set the password");
      return true;
    },
  };
}
