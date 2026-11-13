// Regenerates docs/REQUIREMENTS_TRACE.md from src/requirements.js.
import fs from "node:fs";
import { REQUIREMENTS, STATUS_LABEL } from "../src/requirements.js";
const counts = REQUIREMENTS.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
const lines = [
  "# Requirement traceability",
  "",
  "Generated from `src/requirements.js` (`npm run trace`). Also shown in the app: *Data centre → Requirement trace*.",
  "",
  Object.entries(counts).map(([k, v]) => `**${STATUS_LABEL[k]}:** ${v}`).join(" · "),
  "",
  "| # | Tag | Requirement | Status | Where / notes |",
  "|---|---|---|---|---|",
  ...REQUIREMENTS.map((r) => `| ${r.id} | ${r.tag} | ${r.title} | ${STATUS_LABEL[r.status]} | ${r.where.replace(/\|/g, "\\|")} |`),
  "",
];
fs.writeFileSync(new URL("../docs/REQUIREMENTS_TRACE.md", import.meta.url), lines.join("\n"));
console.log(`wrote ${REQUIREMENTS.length} requirements`);
