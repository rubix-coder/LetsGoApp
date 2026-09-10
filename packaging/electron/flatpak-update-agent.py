#!/usr/bin/env python3
"""Flatpak self-update agent for the LetsGo desktop shell.

Why a Python child process and not Node: the update portal
(org.freedesktop.portal.Flatpak) hands out a PRIVATE update-monitor object and
delivers its signals only to the D-Bus connection that asked for it. A shelled
out `gdbus call` creates the monitor on a connection that dies with the
command, and `gdbus monitor` cannot eavesdrop on another connection's signals
inside the sandbox. So the monitor has to live on one long-lived connection —
and the freedesktop 24.08 runtime already ships python3 + PyGObject, whereas
Node has no D-Bus in its standard library. No new dependency either way.

Two detectors, because the portal alone is too slow to be useful:

  1. The portal's UpdateMonitor. Authoritative — it is the only thing that
     knows whether an update is already DEPLOYED under the running app — but
     it polls twice an hour (DEFAULT_UPDATE_POLL_TIMEOUT_SEC in flatpak's
     portal/flatpak-portal.c), so it can be nearly 30 minutes late. That is
     what made a freshly published update look like nothing had shipped.
  2. The OSTree remote summary, polled here every few minutes: parse
     `<repo>/summary`, read the commit for this app's ref, and compare it with
     the running commit from /.flatpak-info. This catches BOTH a new publish
     and an update installed underneath us, within minutes rather than half an
     hour, and needs nothing but GLib — which is already here for D-Bus.

Update() does not depend on either detector: it runs a real FlatpakTransaction
(portal/flatpak-portal.c, do_update_child_process), so it refreshes and pulls
whatever is actually needed, and finishes as "empty" when the new commit was
already deployed and only a restart is owed.

Protocol (newline-delimited JSON, so the shell can parse it without a lib):
  stdout   {"type":"ready"}
           {"type":"available","running":…,"local":…,"remote":…,
            "restartOnly":bool,"source":"portal|repo"}
           {"type":"progress","percent":0-100,"status":"running|empty|done|failed",
            "message":str|null}
  stdin    "update\n"  → ask the portal to install the pending update
           "quit\n"    → exit

`restartOnly` is the case that prompted all this: the update was already
deployed under a running app (running-commit != local-commit), so there is
nothing to download — the app only has to restart. Only the portal can tell
us that, so a repo-sourced report never claims it.
"""

import json
import sys
import threading
import urllib.request

import gi

gi.require_version("Gio", "2.0")
from gi.repository import Gio, GLib  # noqa: E402

PORTAL = "org.freedesktop.portal.Flatpak"
PORTAL_PATH = "/org/freedesktop/portal/Flatpak"
MONITOR_IFACE = "org.freedesktop.portal.Flatpak.UpdateMonitor"

# Portal's Progress status enum.
STATUS = {0: "running", 1: "empty", 2: "done", 3: "failed"}

# How often to re-read the remote summary. Small (a few KB) and only over the
# link the app already uses, so this is cheap; the point is to be minutes late
# instead of half an hour.
REPO_POLL_SEC = 180
SUMMARY_TIMEOUT_SEC = 15

# GVariant signature of an OSTree repo summary: a list of
# (ref, (size, commit-checksum, metadata)) plus repo metadata.
SUMMARY_TYPE = "(a(s(taya{sv}))a{sv})"

_emit_lock = threading.Lock()


def emit(payload):
    """One JSON object per line, flushed — the parent reads this as a stream.
    Locked because the repo poller runs on its own thread."""
    with _emit_lock:
        sys.stdout.write(json.dumps(payload) + "\n")
        sys.stdout.flush()


def flatpak_info():
    """The [Application]/[Instance] keys the sandbox publishes about itself:
    which app this is, which commit is RUNNING (not which is deployed), and
    the arch/branch that complete its ref."""
    info = {}
    try:
        with open("/.flatpak-info", encoding="utf-8") as handle:
            for line in handle:
                if "=" in line:
                    key, _, value = line.partition("=")
                    info.setdefault(key.strip(), value.strip())
    except OSError:
        return {}
    return info


def app_ref(info):
    name = info.get("name")
    if not name:
        return None
    return f"app/{name}/{info.get('arch', 'x86_64')}/{info.get('branch', 'master')}"


def remote_commit(repo_url, ref):
    """The commit the remote currently publishes for `ref`, or None if the
    summary cannot be fetched or read. Never raises: a host that is asleep or a
    repo mid-republish must not take the agent down with it."""
    url = repo_url.rstrip("/") + "/summary"
    try:
        with urllib.request.urlopen(url, timeout=SUMMARY_TIMEOUT_SEC) as response:
            data = response.read()
        variant = GLib.Variant.new_from_bytes(
            GLib.VariantType(SUMMARY_TYPE), GLib.Bytes.new(data), False)
        refs = variant.get_child_value(0)
        for i in range(refs.n_children()):
            entry = refs.get_child_value(i)
            if entry.get_child_value(0).get_string() != ref:
                continue
            checksum = bytes(entry.get_child_value(1).get_child_value(1).unpack())
            return checksum.hex()
    except Exception:  # noqa: BLE001 — offline, 404, or a summary we cannot read
        return None
    return None


class Agent:
    def __init__(self, repo_url=None):
        self.bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
        self.monitor_path = None
        self.loop = GLib.MainLoop()
        self.repo_url = repo_url
        self.info = flatpak_info()
        self.ref = app_ref(self.info)
        self.running_commit = self.info.get("app-commit")
        # Last commit reported, so a poll every few minutes does not re-announce
        # the same update over and over.
        self.reported = None

    def start(self):
        result = self.bus.call_sync(
            PORTAL, PORTAL_PATH, PORTAL, "CreateUpdateMonitor",
            GLib.Variant("(a{sv})", ({},)),
            GLib.VariantType("(o)"), Gio.DBusCallFlags.NONE, 10_000, None,
        )
        self.monitor_path = result.unpack()[0]
        self.bus.signal_subscribe(
            PORTAL, MONITOR_IFACE, "UpdateAvailable", self.monitor_path, None,
            Gio.DBusSignalFlags.NONE, self._on_available, None,
        )
        self.bus.signal_subscribe(
            PORTAL, MONITOR_IFACE, "Progress", self.monitor_path, None,
            Gio.DBusSignalFlags.NONE, self._on_progress, None,
        )
        emit({"type": "ready"})
        threading.Thread(target=self._read_commands, daemon=True).start()
        if self.repo_url and self.ref and self.running_commit:
            self._poll_repo_async()
            GLib.timeout_add_seconds(REPO_POLL_SEC, self._poll_repo_async)
        self.loop.run()

    def _on_available(self, _bus, _sender, _path, _iface, _signal, params, _data):
        info = params.unpack()[0]
        running = info.get("running-commit")
        local = info.get("local-commit")
        emit({
            "type": "available",
            "running": running,
            "local": local,
            "remote": info.get("remote-commit"),
            # Already deployed underneath us — a restart is the whole fix.
            "restartOnly": bool(running and local and running != local),
            "source": "portal",
        })

    def _on_progress(self, _bus, _sender, _path, _iface, _signal, params, _data):
        info = params.unpack()[0]
        status = STATUS.get(info.get("status", 0), "running")
        emit({
            "type": "progress",
            "percent": int(info.get("progress", 0)),
            "status": status,
            "message": info.get("error_message") or info.get("error") or None,
        })

    def _poll_repo_async(self):
        threading.Thread(target=self._poll_repo, daemon=True).start()
        return True  # keep the timeout armed

    def _poll_repo(self):
        commit = remote_commit(self.repo_url, self.ref)
        if not commit or commit == self.running_commit or commit == self.reported:
            return
        self.reported = commit
        emit({
            "type": "available",
            "running": self.running_commit,
            # Whether it is already deployed is the portal's to know; claiming
            # either way from here would put the wrong label on the button.
            "local": None,
            "remote": commit,
            "restartOnly": False,
            "source": "repo",
        })

    def _update(self):
        try:
            self.bus.call_sync(
                PORTAL, self.monitor_path, MONITOR_IFACE, "Update",
                GLib.Variant("(sa{sv})", ("", {})),
                None, Gio.DBusCallFlags.NONE, 10_000, None,
            )
        except GLib.Error as err:
            emit({"type": "progress", "percent": 0, "status": "failed", "message": err.message})
        return False

    def _read_commands(self):
        for line in sys.stdin:
            command = line.strip()
            if command == "update":
                # Marshal onto the main loop: the D-Bus connection is not
                # thread-safe to drive from the stdin reader.
                GLib.idle_add(self._update)
            elif command == "quit":
                GLib.idle_add(self.loop.quit)
                return
        # stdin closed: the shell is gone, so this agent has nothing left to
        # report to. Without this the loop keeps running and every app launch
        # leaves another agent behind polling the repo forever — three were
        # found alive at once on a single desktop.
        GLib.idle_add(self.loop.quit)


if __name__ == "__main__":
    try:
        # argv[1], when given, is the OSTree repo this app was installed from.
        Agent(sys.argv[1] if len(sys.argv) > 1 else None).start()
    except Exception as exc:  # noqa: BLE001 — any failure means "no self-update here"
        emit({"type": "error", "message": str(exc)})
        sys.exit(1)
