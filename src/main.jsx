import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

import { resolveTheme } from "./lib/theme.js";

document.documentElement.dataset.theme = resolveTheme((() => { try { return JSON.parse(localStorage.getItem("gqta.v1.settings"))?.theme || "dark"; } catch { return "dark"; } })());
if ("serviceWorker" in navigator && import.meta.env.PROD) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
