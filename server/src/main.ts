/* Entry point. Run with: node --experimental-sqlite --import tsx src/main.ts
   Env: PORT, DB_PATH (default ./letsgo.db in prod), ALLOW_SIGNUP, NODE_ENV. */

import { createApp } from "./app.ts";

const port = Number(process.env.PORT || 8787);
const app = createApp();
app.listen(port);
// eslint-disable-next-line no-console
console.log(`LetsGo server listening on :${port} (signup ${process.env.ALLOW_SIGNUP === "true" ? "open" : "closed"})`);
