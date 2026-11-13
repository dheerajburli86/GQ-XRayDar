import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

document.documentElement.dataset.theme = (() => { try { return JSON.parse(localStorage.getItem("gqta.v1.settings"))?.theme || "dark"; } catch { return "dark"; } })();
createRoot(document.getElementById("root")).render(<StrictMode><App /></StrictMode>);
