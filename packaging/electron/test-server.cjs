/* Tests for server.cjs: static serving, SPA fallback, cache headers, wasm
   mime, and the /api proxy (pass-through, cookie forwarding, Set-Cookie
   Secure-strip, 502 on dead upstream). Plain node — `node test-server.cjs`. */

const assert = require("node:assert");
const http = require("node:http");
const path = require("node:path");
const { createServer, stripSecure } = require("./server.cjs");

const DIST = path.join(__dirname, "..", "..", "webapp", "dist");

function get(port, urlPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, ...opts }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function main() {
  // Mock NAS upstream: echoes method/path/cookie, sets a Secure cookie.
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "sid=abc; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600; Secure",
      });
      res.end(JSON.stringify({
        method: req.method, url: req.url,
        cookie: req.headers.cookie ?? null, body: Buffer.concat(chunks).toString(),
      }));
    });
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const upPort = upstream.address().port;

  const srv = createServer({ root: DIST, nasUrl: `http://127.0.0.1:${upPort}` });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;

  // 1. index
  let r = await get(port, "/");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /text\/html/);
  assert.equal(r.headers["cache-control"], "no-cache");

  // 2. SPA fallback
  r = await get(port, "/todo/schedule/deep/link");
  assert.equal(r.status, 200);
  assert.match(r.body, /<div id="root">/);

  // 3. fingerprinted asset → immutable
  const asset = (await get(port, "/")).body.match(/assets\/[^"]+\.js/)[0];
  r = await get(port, `/${asset}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.match(r.headers["content-type"], /javascript/);

  // 4. wasm mime (zxing barcode decoder)
  const wasm = (await get(port, `/${asset}`)).body.match(/assets\/[^"']+\.wasm/);
  if (wasm) {
    r = await get(port, `/${wasm[0]}`);
    assert.equal(r.headers["content-type"], "application/wasm");
  }

  // 5. path traversal stays inside dist
  r = await get(port, "/../../../etc/passwd");
  assert.equal(r.status, 200);
  assert.match(r.body, /<div id="root">|<!doctype/i);

  // 6. proxy pass-through: method, path, body, cookie
  r = await get(port, "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "sid=abc" },
    body: JSON.stringify({ username: "u" }),
  });
  assert.equal(r.status, 200);
  const echoed = JSON.parse(r.body);
  assert.equal(echoed.method, "POST");
  assert.equal(echoed.url, "/api/auth/login");
  assert.equal(echoed.cookie, "sid=abc");
  assert.match(echoed.body, /"username":"u"/);

  // 7. Set-Cookie: Secure stripped, rest intact
  const sc = r.headers["set-cookie"][0];
  assert.doesNotMatch(sc, /secure/i);
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Lax/);
  assert.match(sc, /Max-Age=1209600/);

  // 8. stripSecure never eats a substring
  assert.deepEqual(stripSecure(["a=1; SecureNot; Secure"]), ["a=1; SecureNot"]);

  // 9. /webdav proxied too (vault sync), non-standard methods intact
  r = await get(port, "/webdav/letsgo-web/vault.json", {
    method: "PROPFIND",
    headers: { authorization: "Basic dTpw" },
  });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).method, "PROPFIND");
  assert.equal(JSON.parse(r.body).url, "/webdav/letsgo-web/vault.json");

  // 10. dead upstream → 502 with a JSON error
  upstream.close();
  await new Promise((r2) => setTimeout(r2, 50));
  r = await get(port, "/api/auth/me");
  assert.equal(r.status, 502);
  assert.match(r.body, /NAS unreachable/);

  srv.close();

  // 11. /__shell/update — absent without a shell hook (browser/PWA parity),
  //     reporting and applying when the desktop shell wires one in.
  const noShell = createServer({ root: DIST });
  await new Promise((r2) => noShell.listen(0, "127.0.0.1", r2));
  const noShellPort = noShell.address().port;
  r = await get(noShellPort, "/__shell/update");
  assert.equal(r.status, 404);
  assert.equal(JSON.parse(r.body).supported, false);
  noShell.close();

  let applied = 0;
  const withShell = createServer({
    root: DIST,
    shellUpdate: {
      status: () => ({ supported: true, available: true, restartOnly: true, progress: null }),
      apply: async () => { applied++; return { ok: true }; },
    },
  });
  await new Promise((r2) => withShell.listen(0, "127.0.0.1", r2));
  const shellPort = withShell.address().port;

  r = await get(shellPort, "/__shell/update");
  assert.equal(r.status, 200);
  assert.equal(r.headers["cache-control"], "no-store");
  assert.deepEqual(JSON.parse(r.body), { supported: true, available: true, restartOnly: true, progress: null });

  r = await get(shellPort, "/__shell/update", { method: "POST" });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).ok, true);
  assert.equal(applied, 1);

  // A failed install answers 500 with the portal's own reason, so the bar can
  // show it instead of a shrug.
  const failing = createServer({
    root: DIST,
    shellUpdate: {
      status: () => ({ supported: true, available: true, restartOnly: false, progress: null }),
      apply: async () => ({ ok: false, error: "portal said no" }),
    },
  });
  await new Promise((r2) => failing.listen(0, "127.0.0.1", r2));
  const failPort = failing.address().port;
  r = await get(failPort, "/__shell/update", { method: "POST" });
  assert.equal(r.status, 500);
  assert.equal(JSON.parse(r.body).error, "portal said no");
  failing.close();

  // The route must not shadow the SPA: a normal client route still gets the app.
  r = await get(shellPort, "/todo/events");
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /text\/html/);
  withShell.close();

  console.log("server tests: 11/11 OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
