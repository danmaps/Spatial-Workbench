# Upgrade and verify the serving Node runtime

Tracks #153. Node 24.22.1 is the tested baseline for CI, local development and
production; `engines` permits later patches/minors within Node 24. Node 22 has
patched releases too, but this project deliberately uses one line.

Security release: https://nodejs.org/en/blog/vulnerability/october-2026-security-releases

## Before restarting

1. Record the current commit, process manager/service name, startup command and
   Node executable. Inspect the actual unit, container or hosting configuration,
   rather than assuming the interactive shell's `node` is what serves requests.
2. Install Node 24.22.1 using the host's existing version manager. With nvm:
   `nvm install && nvm use`. For a container, change its base to
   `node:24.22.1-alpine`, build with `--pull --no-cache`, and record its image ID.
3. Run `node --version`, `npm run check:runtime`, `npm ci`,
   `npm test -- --runInBand`, `npm run test:headless`, `npm run demo:headless`,
   `npm run validate:headless-artifact`, `npm run build`, and `npm run spec:check`.

## Deploy the actual process

The repo documents a user systemd service but does not contain the live unit.
Inspect `systemctl --user cat <actual-unit>` and set its `ExecStart` to an absolute
path to the patched Node binary running this checkout's `server.js`. Preserve
the existing working directory, environment, port, keys, and resource settings.
Do not rely on nvm initialization or PATH in a login shell for a systemd unit.
Then `systemctl --user daemon-reload` and restart the actual unit. For managed
hosting, select Node 24.22.1+ and redeploy; for containers, recreate from the new
image and compare `docker inspect --format '{{.Image}}' <container>` with the
rebuilt image ID. Do not restart unrelated services.

On Linux/systemd, record the actual MainPID and `/proc/<pid>/exe`; run that
binary with `--version`. In a container, run `node --version` in the recreated
container. These checks complement the running process metadata below.

## Acceptance evidence

```bash
node scripts/verify-deployed-runtime.js http://127.0.0.1:3003
node scripts/verify-deployed-runtime.js https://workbench.dannymcvey.com
HEADLESS_API_URL=https://workbench.dannymcvey.com npm run demo:headless
```

Use the actual local port. `/api/state` reports `process.versions.node` and
OpenSSL from the process handling that request and sets `Cache-Control: no-store`.
The verifier rejects missing metadata, old versions, HTTP failures and redirects.
Verify each replica/origin when applicable. Smoke the landing page, GIS page and
headless-demo page too. Save the source commit, service/executable or image ID,
reported runtime, full test result and live headless receipt.

## Certificate checks before October 27, 2026 Pacific

Inventory Caddy/reverse-proxy and Tailscale Serve hostnames. For each name:

```bash
host=workbench.dannymcvey.com
openssl s_client -connect "$host:443" -servername "$host" \
  -showcerts -verify_return_error -verify_hostname "$host" </dev/null
```

Inspect all subjects and issuers, and resolve the final trust anchor with
`openssl verify -show_chain` against a current CA store. Roots are normally
omitted from the server-sent chain. Reissue any chain ending at
**emSign ECC Root CA - G3** under a different trusted hierarchy, reload the
proxy and repeat verification. A connection failure is an incomplete check.

## Rollback and completion

Retain the prior app commit and service configuration. Roll back application
code if needed while retaining patched Node 24; Node 20 is not an acceptable
final rollback. Do not close #153 until the live runtime and TLS evidence pass.
Updating CI alone does not establish that production is patched.
