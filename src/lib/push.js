// Phone / desktop pop-up alerts (feature 6.7) through Web Push.
// iPhone: works only for the app added to the Home Screen (iOS 16.4+).
import { api } from "./server.js";

const b64ToBytes = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

export async function enablePush(publicKey) {
  if (!pushSupported()) throw new Error(isIos() && !isStandalone() ? "On iPhone, first add this app to the Home Screen (Share → Add to Home Screen), open it from there, then enable notifications." : "This browser does not support push notifications.");
  if (!publicKey) throw new Error("Push is not configured on the server (VAPID keys).");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications were not allowed.");
  const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
  const j = sub.toJSON();
  await api("POST", "/api/push/subscribe", { endpoint: j.endpoint, keys: j.keys });
  return true;
}
