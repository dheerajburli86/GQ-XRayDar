// Chooses the data source. Supabase when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
// are set (and VITE_DATA_SOURCE is not "demo"); otherwise the synthetic demo.
import { createDemoApi } from "./demoApi.js";
import { createSupabaseApi } from "./supabaseApi.js";

const env = import.meta.env;
export const DATA_SOURCE = env.VITE_DATA_SOURCE === "demo" || !env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY ? "demo" : "supabase";

let instance = null;
const listeners = new Set();
export const onProgress = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function getApi() {
  if (instance) return instance;
  instance = DATA_SOURCE === "demo"
    ? createDemoApi((p) => listeners.forEach((f) => f(p)))
    : createSupabaseApi(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  return instance;
}
