/* Local HTTP server for the desktop shell: serves the built webapp (static,
   SPA fallback, Vite-correct cache headers) and reverse-proxies /api to the
   self-hosted team backend so the webview talks to it SAME-ORIGIN — the server has no
   CORS on purpose and its session cookie is SameSite=Lax, so a cross-origin
   call could never work. This mirrors the nginx proxy on the NAS itself
   (webapp/DEPLOY.md §5). Node built-ins only. */

const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".wasm": "application/wasm", // zxing-wasm — the barcode scanner dies without this
  ".txt": "text/plain; charset=utf-8",
};

// Response headers that must not be copied verbatim from the upstream.
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "transfer-encoding", "upgrade",
  "proxy-authenticate", "proxy-authorization", "te", "trailer",
]);

/** The NAS runs with NODE_ENV=production → Secure cookies; the webview's
    origin is http://localhost, where WebKit/Chromium may refuse to store
    them. Same-origin via this proxy, the flag serves no purpose — strip it. */
function stripSecure(setCookie) {
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  return list.map((c) => c.replace(/;\s*secure(?=;|\s*$)/gi, ""));
}

function proxyApi(req, res, nasUrl) {
  if (!nasUrl) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "No NAS URL configured (config.json → nasUrl)" }));
    return;
  }
  const target = new URL(req.url, nasUrl);
  const mod = target.protocol === "https:" ? https : http;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  headers["accept-encoding"] = "identity"; // keep the pipe byte-transparent
  const up = mod.request(
    target,
    { method: req.method, headers, timeout: 30_000 },
    (upRes) => {
      const out = {};
      for (const [k, v] of Object.entries(upRes.headers)) {
        if (HOP_BY_HOP.has(k)) continue;
        out[k] = k === "set-cookie" ? stripSecure(v) : v;
      }
      res.writeHead(upRes.statusCode ?? 502, out);
      upRes.pipe(res);
    },
  );
  up.on("timeout", () => up.destroy(new Error("timeout")));
  up.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `NAS unreachable: ${e.code ?? e.message}` }));
  });
  req.pipe(up);
}

function serveStatic(req, res, root) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    pathname = "/";
  }
  let file = path.normalize(path.join(root, pathname));
  if (!file.startsWith(root)) file = path.join(root, "index.html");
  let stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat || stat.isDirectory()) {
    // SPA fallback: unknown paths are client-side routes.
    file = path.join(root, "index.html");
    stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("app files missing");
      return;
    }
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    "content-length": stat.size,
    // Vite fingerprints /assets/* → cache hard; everything else (index.html,
    // sw.js, manifest) must revalidate or an old bundle keeps running.
    "cache-control": file.includes(`${path.sep}assets${path.sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  if (req.method === "HEAD") { res.end(); return; }
  fs.createReadStream(file).pipe(res);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

/* /__shell/update — the shell's own seam, and deliberately an HTTP route
   rather than IPC: the window has no preload and no nodeIntegration by
   design (main.cjs), and this server is already the webapp's same origin. So
   the webapp asks with a plain fetch and needs no knowledge of Electron. A
   browser or PWA gets a 404 here and falls back to its reload banner.

   GET  → { supported, available, restartOnly, progress }
   POST → { ok } once the update is installed (or immediately, when it was
           already deployed and only a restart is owed). */
function shellUpdateRoute(req, res, shell) {
  if (!shell) return sendJson(res, 404, { supported: false });
  if (req.method === "GET") return sendJson(res, 200, shell.status());
  if (req.method === "POST") {
    shell.apply().then(
      (result) => sendJson(res, result.ok ? 200 : 500, result),
      (e) => sendJson(res, 500, { ok: false, error: e.message }),
    );
    return;
  }
  return sendJson(res, 405, { ok: false, error: "GET or POST" });
}

/** @param {{root: string, nasUrl?: string, shellUpdate?: {status: Function, apply: Function}}} opts */
function createServer(opts) {
  const root = path.resolve(opts.root);
  return http.createServer((req, res) => {
    const p = req.url ?? "/";
    if (p === "/__shell/update") return shellUpdateRoute(req, res, opts.shellUpdate);
    // /api → team backend; /webdav → vault-sync share (Unlock's "Restore
    // from NAS" + Settings sync use a same-origin WebDAV path). Both mirror
    // the NAS nginx origin so the webapp's same-origin defaults just work.
    const proxied = ["/api", "/webdav"].some((pre) => p === pre || p.startsWith(`${pre}/`));
    if (proxied) return proxyApi(req, res, opts.nasUrl);
    return serveStatic(req, res, root);
  });
}

module.exports = { createServer, stripSecure };
