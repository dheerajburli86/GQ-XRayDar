// Role-based access. Roles live on tas_user.role; ADMIN_EMAILS are always admin.
//   admin     everything, including roles, the audit log, operations and the F&O collector
//   analyst   read everything, own alerts / tasks / tokens / documents
//   viewer    read only: no alerts, tasks, tokens or agent tasks
//   disabled  signed out of the app and its API
import { HttpError } from "./http.mjs";

export const ROLES = ["admin", "analyst", "viewer", "disabled"];
export const PERMISSIONS = {
  read: ["admin", "analyst", "viewer"],
  write_docs: ["admin", "analyst", "viewer"],
  alerts: ["admin", "analyst"],
  tasks: ["admin", "analyst"],
  tokens: ["admin", "analyst"],
  agent: ["admin", "analyst", "viewer"],
  audit_own: ["admin", "analyst", "viewer"],
  admin: ["admin"],
};
export const can = (user, perm) => !!user && (PERMISSIONS[perm] || []).includes(user.role || "analyst");
export function need(user, perm) { if (!can(user, perm)) throw new HttpError(403, `your role (${user?.role || "none"}) cannot do this`); return user; }
