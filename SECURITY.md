# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/rubix-coder/LetsGoApp/security/advisories/new)
on this repository. If that is unavailable to you, open a normal issue saying
only that you have a security report and asking for a private channel — no
details in the issue itself.

Please include what you can: affected version, platform, reproduction steps,
and the impact you believe it has. Expect an initial response within a week.

## Supported versions

LetsGo is developed on a rolling basis. Fixes land in the **latest release**;
there are no long-term support branches.

## Scope notes

LetsGo is local-first and ships with no backend, so most of the attack surface
is local or belongs to infrastructure **you** host:

- **The vault** is encrypted client-side before any sync target sees it. Issues
  in that encryption, key handling, or in the plugin sandbox are in scope.
- **Your own server** (`server/`, WebDAV, reverse proxy) is deployment
  configuration. Bugs in the code in this repo are in scope; a misconfigured
  deployment is not.
- **Google Calendar sync** uses an OAuth client ID that you supply. Never paste
  a client secret into an issue or a config file in this repo.
