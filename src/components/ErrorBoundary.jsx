// Catches a render / effect error in one page so the rest of the app (menu,
// search, other pages) keeps working instead of the whole screen going blank.
import { Component } from "react";

const CHUNK_RE = /dynamically imported module|Importing a module script failed|Loading chunk|error loading dynamically/i;

export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error("[page error]", error, info?.componentStack);
    // a new version was deployed while this tab was open: the old page file is gone, so reload once
    if (CHUNK_RE.test(String(error?.message))) {
      try {
        const last = Number(sessionStorage.getItem("gqta.chunkReload") || 0);
        if (Date.now() - last > 30000) { sessionStorage.setItem("gqta.chunkReload", String(Date.now())); window.location.reload(); }
      } catch { /* storage blocked */ }
    }
  }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.silent) return null;
    return (
      <div className="card crash" role="alert" style={{ maxWidth: 720, margin: "24px auto" }}>
        <h2 style={{ marginTop: 0 }}>{this.props.title || "This page hit a problem"}</h2>
        <p className="muted">Nothing is lost. The rest of the app still works: pick another page from the menu, or try this one again.</p>
        <div className="note warn mono small" style={{ wordBreak: "break-word" }}>{String(error?.message || error)}</div>
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button className="btn primary" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn" onClick={() => window.location.reload()}>Reload the app</button>
        </div>
      </div>
    );
  }
}
