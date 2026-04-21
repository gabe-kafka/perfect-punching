import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

function showBootstrapError(label: string, err: unknown): void {
  const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ""}` : String(err);
  const root = document.getElementById("root") ?? document.body;
  root.innerHTML = `
    <div style="padding:24px;font:12px ui-monospace,monospace;color:#900;white-space:pre-wrap">
      <div style="font-weight:700;font-size:14px;margin-bottom:12px">Bootstrap error (${label})</div>
      ${msg.replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'} as Record<string,string>)[c])}
    </div>`;
  // eslint-disable-next-line no-console
  console.error(`[${label}]`, err);
}

window.addEventListener("error",           (e) => showBootstrapError("window.onerror",       e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => showBootstrapError("unhandledrejection", e.reason));

(async () => {
  try {
    const { default: App } = await import("./App");
    const el = document.getElementById("root");
    if (!el) throw new Error("no #root element in index.html");
    ReactDOM.createRoot(el).render(<React.StrictMode><App /></React.StrictMode>);
  } catch (e) {
    showBootstrapError("render", e);
  }
})();
