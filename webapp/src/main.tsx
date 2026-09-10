import React from "react";
import ReactDOM from "react-dom/client";
import "./theme.css";
import { App } from "./App";
import { registerSw } from "./lib/notify";
import { isNative } from "./lib/native/platform";

async function boot(): Promise<void> {
  // Native setup must finish first: it refills localStorage from the durable
  // mirror, and hasVault()/unlockMode() read localStorage synchronously.
  if (isNative) await (await import("./lib/native/boot")).initNative();
  registerSw();

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
