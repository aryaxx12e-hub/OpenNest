# Self-hosting OpenNest

Status: implementation preview. This is not a supported production deployment
until the Stage E gate register closes the collaboration, MCP, AI egress, external
cryptography, E2EE, and hosted CI gates. See
`docs/stage-e-gate-register.md`.

This guide covers the single-user, single-process Node server that backs
optional sync, collaboration, and MCP. The browser PWA still works without this
server. The server is not OpenNest Cloud, does not provide public sharing, and
does not make an encryption-at-rest claim.

## Deployment shape

- One Node.js 24 process.
- One SQLite workspace database, one auth database, and one blob root under the
  data directory.
- One writer per data directory. Do not run multiple containers, replicas, or
  clustered workers against the same volume.
- TLS is terminated by a reverse proxy. The Node process listens on a private
  address or localhost.
- The public PWA and the API should share one origin so session cookies and CSRF
  checks work without cross-origin exceptions.

The server does not serve the Next.js PWA. The `deploy/compose.yaml` service
runs the API only. Build and run the PWA separately, or use one reverse proxy
that routes the PWA and the API under the same public origin.

## Requirements

- Node.js 24 or newer, matching `node:sqlite`.
- npm 10 or newer.
- A reverse proxy with TLS.
- A data directory writable only by the service account.
- A backup destination outside the data directory.

## Environment

| Variable               | Required                             | Meaning                                                       |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------- |
| `OPENNEST_DATA_DIR`    | Yes                                  | Directory for SQLite databases and blobs.                     |
| `OPENNEST_HOST`        | No                                   | Bind address, default `127.0.0.1`.                            |
| `OPENNEST_PORT`        | No                                   | Bind port, default `8787`.                                    |
| `OPENNEST_PUBLIC_URL`  | Yes in a container or behind a proxy | Exact public origin, for example `https://notes.example.com`. |
| `OPENNEST_MCP_ENABLED` | No                                   | `true` or `false`; default `false`.                           |

`OPENNEST_PUBLIC_URL` is an origin only: no path, query, credentials, or
fragment. It must match the browser origin used for collaboration. A mismatch
rejects the WebSocket handshake.

Never set `OPENNEST_HOST=0.0.0.0` without a reverse proxy, TLS, and a firewall.
The server does not trust forwarded headers for authentication.

## Data directory

The data directory contains:

- `workspace.sqlite`: workspace entities, sync authority, file versions, and
  collaboration snapshots.
- `auth.sqlite`: users, sessions, invites, audit records, and MCP token hashes.
- `blobs/workspaces/<workspaceId>/`: uploaded file bytes.

Set permissions to the service account only:

```bash
install -d -m 700 -o opennest -g opennest /var/lib/opennest
```

Do not place the data directory on a network filesystem that does not provide
reliable SQLite locking. Startup reconciliation assumes one writer.

## First start

Directly on a host:

```bash
OPENNEST_DATA_DIR=/var/lib/opennest \
OPENNEST_PUBLIC_URL=https://notes.example.com \
OPENNEST_HOST=127.0.0.1 \
OPENNEST_PORT=8787 \
node scripts/tsx.mjs apps/server/src/index.ts
```

With Docker Compose:

```bash
cd deploy
OPENNEST_PUBLIC_URL=https://notes.example.com docker compose up -d --build
```

Create the first owner before anyone can log in. The password is read from
standard input:

```bash
printf '%s\n' 'replace with a long password' |
  OPENNEST_DATA_DIR=/var/lib/opennest \
  node scripts/tsx.mjs apps/server/src/cli/bootstrap-owner.ts \
  --email owner@example.com
```

In the Compose container:

```bash
printf '%s\n' 'replace with a long password' |
  docker compose exec -T opennest \
  node scripts/tsx.mjs apps/server/src/cli/bootstrap-owner.ts \
  --email owner@example.com
```

The password is not echoed. Store it in a password manager. There is no
password-reset UI yet.

## Reverse proxy and TLS

Caddy example:

```caddyfile
notes.example.com {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
  }
  reverse_proxy 127.0.0.1:8787
}
```

Caddy proxies WebSocket upgrades by default. With nginx, include
`proxy_set_header Upgrade $http_upgrade;` and
`proxy_set_header Connection "upgrade";` on `/api/collaboration`. Do not cache
API responses. Keep the origin stable: changing the hostname invalidates the
configured public URL and collaboration handshakes.

Session cookies are marked `Secure`, so HTTPS is required for browser login.
HTTP on localhost is acceptable only for local tests with manual cookie handling.

## Backup

Back up the whole data directory, including both SQLite files and `blobs/`. The
auth database contains password hashes, session records, audit data, and MCP
token hashes. Treat a backup as a secret.

Stop the service for a consistent copy:

```bash
docker compose stop opennest
docker run --rm \
  -v opennest-data:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine:3.20 \
  sh -c 'tar -C /data -czf /backup/opennest-$(date +%Y%m%d-%H%M%S).tgz .'
docker compose start opennest
```

For a host install, use `tar` or another snapshot tool on the stopped data
directory. Do not copy only the SQLite file while uploads are in progress.

Test a restore at least once before relying on a backup. An untested backup is
not a recovery plan.

## Restore

Restore replaces live data. Make a fresh backup of the current directory first.

```bash
docker compose down
docker run --rm \
  -v opennest-data:/data \
  -v "$PWD/backups:/backup:ro" \
  alpine:3.20 \
  sh -c 'rm -rf /data/* /data/.[!.]* /data/..?* 2>/dev/null || true; tar -xzf /backup/opennest-YYYYMMDD-HHMMSS.tgz -C /data'
docker compose up -d
curl -fsS http://127.0.0.1:8787/health/ready
```

If readiness fails, stop the service and restore the pre-restore copy. Do not
start a second writer against the same volume while diagnosing.

## Upgrade and migration

1. Create a backup and record the running image tag or commit.
2. Read the changelog and release checklist for migration notes.
3. Stop the service.
4. Start the new version and wait for `/health/ready`.
5. Check logs for migration or reconciliation errors.
6. Test login, a note read, a file download, and a collaboration connection if
   enabled.

Schema migrations run at startup through the existing SQLite adapter. There is
no automatic downgrade. A failed migration may leave the database unusable until
the pre-upgrade backup is restored.

## Rollback

1. Stop the service.
2. Restore the pre-upgrade backup.
3. Start the previous image tag or commit.
4. Verify readiness and login.

Rolling back only the code without restoring the database is not supported when
a migration has already run. Keep backups until the new version has been
accepted.

## Delete all data

Delete-all is an operator action, not a browser button for server data.

```bash
docker compose down -v
```

This removes the named volume and every database, blob, session, audit record,
and MCP token in it. It does not remove backups, reverse-proxy logs, or copies
on the host. Delete those separately if the request covers them.

For a host install, stop the service and remove the configured data directory.
Confirm the path before running `rm -rf`. There is no undo.

## MCP

MCP is disabled by default. Leave `OPENNEST_MCP_ENABLED` unset or set it to
`false` to keep `/api/mcp` and `/api/mcp/tokens` absent.

To disable MCP after use:

1. Revoke tokens through the owner-only token routes.
2. Set `OPENNEST_MCP_ENABLED=false`.
3. Restart the service.
4. Confirm both routes return 404.

MCP token rows remain in `auth.sqlite` after disabling. They cannot authenticate
while the routes are absent, but they remain sensitive metadata. Do not enable
MCP in production until the security review in `docs/adr/0020-mcp-server.md` is
complete.

## Operational checks

- `/health/live` returns 200 when the process is running.
- `/health/ready` returns 200 only when the workspace, auth, sync, file, and
  enabled MCP schemas are ready.
- Keep one process per data directory. Startup removes unreferenced blobs and
  stale temporary files and is not safe under concurrent writers.
- Limit access at the proxy. The server has no administrative UI.
- Keep Node, the base image, and dependencies patched.
- Do not log request bodies. The server's audit records are metadata only.

## Security and privacy limits

- There is no encryption at rest in this deployment. SQLite files, blobs,
  filenames, titles, tags, and sync metadata are plaintext on disk. Use
  full-disk encryption if the host threat model requires it.
- Shared workspace content is visible to the server operator and anyone with
  access to the data directory.
- AI document Q&A sends selected content to the configured provider after
  per-request consent. It is not confidential and not E2EE.
- Optional browser workspace encryption has not been independently reviewed and
  does not cover server-side collaboration or metadata.
- The server is single-tenant and rejects MCP token management unless exactly
  one workspace exists. It is not a multi-user hosting product.
- No public sharing links, federation, OpenNest Cloud, multi-process deployment,
  or object-storage adapter is supported.
