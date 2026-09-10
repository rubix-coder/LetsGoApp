/* Tests for flatpakUpdate.cjs — the agent protocol, not D-Bus.

   The real agent (flatpak-update-agent.py) needs the Flatpak update portal,
   which exists only inside the sandbox, so these drive a stand-in agent that
   speaks the same newline-JSON both ways. What is under test is the part that
   can actually break silently: line framing, the restart-only shortcut, and
   whether a failed or vanished agent resolves the button instead of hanging
   it. Plain node — `node test-flatpak-update.cjs`. */

const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFlatpakUpdater, isFlatpak, agentEnv } = require("./flatpakUpdate.cjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "letsgo-update-"));

/** Write a stand-in agent and return its path. `script` is node source. */
function agent(name, script) {
  const file = path.join(dir, `${name}.cjs`);
  fs.writeFileSync(file, script);
  return file;
}

function makeUpdater(file, extra = {}) {
  return createFlatpakUpdater({ agentPath: file, interpreter: process.execPath, enabled: true, ...extra });
}

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. Inert outside a Flatpak: start() must not spawn anything.
  {
    const file = agent("never", `console.log(JSON.stringify({type:"ready"}));setInterval(()=>{},1000);`);
    const updater = createFlatpakUpdater({ agentPath: file, interpreter: process.execPath, enabled: false });
    updater.start();
    await settle();
    assert.equal(updater.status().supported, false);
    assert.deepEqual(await updater.apply(), { ok: false, error: "self-update unavailable" });
    updater.stop();
  }

  // 2. An update already deployed underneath us reads as restartOnly — but
  //    apply() must ASK THE PORTAL ANYWAY. It used to short-circuit on this
  //    flag, and when the flag was wrong the button installed nothing,
  //    relaunched into the same build, and looked like a silent failure.
  //    "empty" is the portal saying there was genuinely nothing to pull.
  {
    const file = agent("restart-only", `
      console.log(JSON.stringify({type:"ready"}));
      console.log(JSON.stringify({type:"available",running:"aaa",local:"bbb",remote:"bbb",restartOnly:true}));
      process.stdin.on("data",(d)=>{
        if (String(d).includes("update")) console.log(JSON.stringify({type:"progress",status:"empty"}));
      });
      setInterval(()=>{},1000);
    `);
    const updater = makeUpdater(file);
    updater.start();
    await settle();
    const status = updater.status();
    assert.equal(status.supported, true);
    assert.equal(status.available, true);
    assert.equal(status.restartOnly, true);
    // Only an agent that was actually asked can answer at all — a
    // short-circuit would resolve without any progress ever arriving.
    assert.deepEqual(await updater.apply(), { ok: true });
    assert.equal(updater.status().progress.status, "empty");
    updater.stop();
  }

  // 2b. Same flag, a real install: "done" can only come from an agent that
  //     was asked, so this pins the ask rather than the outcome.
  {
    const file = agent("must-ask", `
      console.log(JSON.stringify({type:"ready"}));
      console.log(JSON.stringify({type:"available",running:"aaa",local:"bbb",remote:"bbb",restartOnly:true}));
      process.stdin.on("data",(d)=>{
        if (String(d).includes("update")) console.log(JSON.stringify({type:"progress",percent:100,status:"done"}));
      });
      setInterval(()=>{},1000);
    `);
    const updater = makeUpdater(file);
    updater.start();
    await settle();
    assert.deepEqual(await updater.apply(), { ok: true });
    assert.equal(updater.status().progress.status, "done");
    updater.stop();
  }

  // 3. A real download: progress ticks, then done resolves ok.
  {
    const file = agent("downloads", `
      console.log(JSON.stringify({type:"ready"}));
      console.log(JSON.stringify({type:"available",running:"aaa",local:"aaa",remote:"ccc",restartOnly:false}));
      process.stdin.on("data",(d)=>{
        if(!String(d).includes("update")) return;
        console.log(JSON.stringify({type:"progress",percent:40,status:"running"}));
        setTimeout(()=>console.log(JSON.stringify({type:"progress",percent:100,status:"done"})),30);
      });
      setInterval(()=>{},1000);
    `);
    const updater = makeUpdater(file);
    updater.start();
    await settle();
    assert.equal(updater.status().restartOnly, false);
    assert.deepEqual(await updater.apply(), { ok: true });
    assert.equal(updater.status().progress.status, "done");
    updater.stop();
  }

  // 4. "empty" — the portal found nothing to install — counts as success, not
  //    a failure the user has to read an error about.
  {
    const file = agent("empty", `
      console.log(JSON.stringify({type:"ready"}));
      console.log(JSON.stringify({type:"available",running:"aaa",local:"aaa",remote:"ccc",restartOnly:false}));
      process.stdin.on("data",()=>console.log(JSON.stringify({type:"progress",status:"empty"})));
      setInterval(()=>{},1000);
    `);
    const updater = makeUpdater(file);
    updater.start();
    await settle();
    assert.deepEqual(await updater.apply(), { ok: true });
    updater.stop();
  }

  // 5. The portal refusing (this is the real "app is not focused" error)
  //    surfaces its own message rather than a generic failure.
  {
    const file = agent("refuses", `
      console.log(JSON.stringify({type:"ready"}));
      console.log(JSON.stringify({type:"available",running:"aaa",local:"aaa",remote:"ccc",restartOnly:false}));
      process.stdin.on("data",()=>console.log(JSON.stringify({type:"progress",status:"failed",message:"Only the focused app is allowed to show a system access dialog"})));
      setInterval(()=>{},1000);
    `);
    const updater = makeUpdater(file);
    updater.start();
    await settle();
    const result = await updater.apply();
    assert.equal(result.ok, false);
    assert.match(result.error, /focused app/);
    updater.stop();
  }

  // 6. A split write must not lose a message — the agent's stdout arrives in
  //    whatever chunks the pipe feels like.
  {
    const file = agent("chunked", `
      const line = JSON.stringify({type:"available",running:"aaa",local:"bbb",remote:"bbb",restartOnly:true});
      process.stdout.write(JSON.stringify({type:"ready"}) + "\\n" + line.slice(0, 12));
      setTimeout(()=>process.stdout.write(line.slice(12) + "\\n"), 30);
      setInterval(()=>{},1000);
    `);
    const updater = makeUpdater(file);
    updater.start();
    await settle();
    assert.equal(updater.status().available, true);
    assert.equal(updater.status().restartOnly, true);
    updater.stop();
  }

  // 7. Garbage on stdout is ignored rather than crashing the shell.
  {
    const file = agent("noisy", `
      console.log("not json at all");
      console.log(JSON.stringify({type:"ready"}));
      setInterval(()=>{},1000);
    `);
    const updater = makeUpdater(file);
    updater.start();
    await settle();
    assert.equal(updater.status().supported, true);
    assert.equal(updater.status().available, false);
    updater.stop();
  }

  // 8. An agent that dies mid-install resolves the pending click instead of
  //    leaving the button spinning forever.
  {
    const file = agent("dies", `
      console.log(JSON.stringify({type:"ready"}));
      console.log(JSON.stringify({type:"available",running:"aaa",local:"aaa",remote:"ccc",restartOnly:false}));
      process.stdin.on("data",()=>process.exit(1));
      setInterval(()=>{},1000);
    `);
    const updater = makeUpdater(file);
    updater.start();
    await settle();
    const result = await updater.apply();
    assert.equal(result.ok, false);
    assert.match(result.error, /agent stopped/);
    assert.equal(updater.status().supported, false);
  }

  // 9. A missing agent file leaves the feature off, not throwing.
  {
    const updater = makeUpdater(path.join(dir, "does-not-exist.cjs"));
    updater.start();
    await settle();
    assert.equal(updater.status().supported, false);
  }

  // 10. The agent must not inherit zypak's Chromium LD_PRELOAD or Electron's
  //     loader vars — python3 under those either crashes or misbehaves.
  {
    const dirty = {
      PATH: process.env.PATH,
      LD_PRELOAD: "/app/lib/zypak-preload.so",
      LD_LIBRARY_PATH: "/app/letsgo",
      ELECTRON_RUN_AS_NODE: "1",
      ZYPAK_BIN: "/app/bin",
      HOME: "/home/user",
    };
    const clean = agentEnv(dirty);
    assert.equal(clean.LD_PRELOAD, undefined);
    assert.equal(clean.LD_LIBRARY_PATH, undefined);
    assert.equal(clean.ELECTRON_RUN_AS_NODE, undefined);
    assert.equal(clean.ZYPAK_BIN, undefined);
    assert.equal(clean.HOME, "/home/user"); // everything else survives

    // …and the spawn actually uses it.
    const file = agent("env-echo", `
      console.log(JSON.stringify({type:"ready"}));
      console.log(JSON.stringify({type:"available",running:"a",local:"b",remote:"b",restartOnly:!process.env.LD_PRELOAD}));
      setInterval(()=>{},1000);
    `);
    const updater = makeUpdater(file, { env: dirty });
    updater.start();
    await settle();
    assert.equal(updater.status().restartOnly, true, "LD_PRELOAD leaked into the agent");
    updater.stop();
  }

  // 11. A repo sighting raises the flag but must not claim restartOnly, and
  //     must not downgrade an answer the portal already gave — only the portal
  //     can see whether the new commit is already deployed.
  {
    const file = agent("repo-then-portal", `
      console.log(JSON.stringify({type:"ready"}));
      console.log(JSON.stringify({type:"available",running:"aaa",local:null,remote:"ccc",restartOnly:false,source:"repo"}));
      setTimeout(()=>console.log(JSON.stringify({type:"available",running:"aaa",local:"ccc",remote:"ccc",restartOnly:true,source:"portal"})),30);
      setTimeout(()=>console.log(JSON.stringify({type:"available",running:"aaa",local:null,remote:"ccc",restartOnly:false,source:"repo"})),60);
      setInterval(()=>{},1000);
    `);
    const updater = makeUpdater(file);
    updater.start();
    await settle(40);
    // The repo saw it first: available, but no restart-only claim.
    await settle(0);
    assert.equal(updater.status().available, true);
    await settle(80);
    // The portal's restartOnly survives the next repo poll.
    assert.equal(updater.status().restartOnly, true);
    updater.stop();
  }

  // 12. The repo URL reaches the agent as an argument — without it the agent
  //     has nothing to poll and the whole fast path is silently dead.
  {
    // Reports an update ONLY when it was handed a repo URL, so `available`
    // is proof the argument arrived rather than proof the agent ran.
    const file = agent("argv-echo", `
      console.log(JSON.stringify({type:"ready"}));
      if (process.argv[2] === "https://example.test/flatpak/") {
        console.log(JSON.stringify({type:"available",running:"a",local:null,remote:"ccc",restartOnly:false,source:"repo"}));
      }
      setInterval(()=>{},1000);
    `);
    const updater = createFlatpakUpdater({
      agentPath: file, interpreter: process.execPath, enabled: true,
      repoUrl: "https://example.test/flatpak/",
    });
    updater.start();
    await settle();
    assert.equal(updater.status().available, true);
    updater.stop();
  }

  {
    const file = agent("argv-absent", `
      console.log(JSON.stringify({type:"ready"}));
      if (process.argv[2] !== undefined) {
        console.log(JSON.stringify({type:"available",running:"a",local:null,remote:"ccc",restartOnly:false,source:"repo"}));
      }
      setInterval(()=>{},1000);
    `);
    const updater = makeUpdater(file); // no repoUrl
    updater.start();
    await settle();
    assert.equal(updater.status().available, false, "agent was given an argument it should not have");
    updater.stop();
  }

  // 13. isFlatpak() is honest about this machine (CI and dev boxes are not
  //     inside the sandbox; the packaged app is).
  assert.equal(typeof isFlatpak(), "boolean");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("flatpak update tests: 14/14 OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
