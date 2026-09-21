# Hosting AiWSP from your GitHub repository

## Option 1: your server with Docker and a domain

Use a Linux server with Docker and Docker Compose installed. The server must have persistent storage. Point your domain's DNS record to this server and allow inbound TCP ports 80 and 443.

1. Clone your GitHub repository onto the server and enter its directory.
2. Copy `.env.example` to `.env`. Set a strong `ADMIN_PASSWORD`, your administrator name and, optionally, an email. Add `DOMAIN=your-real-domain.example` using your actual domain. Do not include `https://` in `DOMAIN`.
3. Run:

```sh
docker compose -f compose.production.yaml up --build -d
```

4. Open `https://YOUR_DOMAIN`. Sign in with `wsp-admin` (or the username configured in `.env`) and the password you chose.

This production configuration includes Caddy for HTTPS. The AiWSP container has no directly published network port. Certificate issuance requires working DNS and external connectivity. The host, domain and any provider charges are yours to configure; this ZIP does not provision a server.

## Option 2: a Docker host connected to GitHub

On a hosting service that supports Docker **and persistent disks**:

1. Connect your GitHub repository and choose its root `Dockerfile`.
2. Set the application port to `3000` and health check to `/healthz`.
3. Attach a persistent writable disk at `/data`; ensure the container's `node` user (UID 1000) can write to it.
4. Set environment variables:

| Variable | Value |
| --- | --- |
| `PUBLIC_URL` | Your complete HTTPS origin, e.g. `https://your-domain.example`, with no subpath |
| `DATA_DIR` | `/data` |
| `PORT` | `3000` |
| `ADMIN_USERNAME` | `wsp-admin`, or a username you choose |
| `ADMIN_PASSWORD` | Your own strong password, at least 12 characters |
| `ADMIN_NAME` | Your administrator display name |
| `ADMIN_EMAIL` | Optional contact email |

5. Deploy one instance. Open the host's URL and sign in.

Never put secrets into GitHub files or frontend environment variables. Enter them in your hosting service's secret/environment controls. Public hosting must use HTTPS. Only localhost development permits HTTP. The configured origin must match the address users open, or write requests will be rejected.

## First business setup

1. **System Management → Account creation:** create your company.
2. Select that company in the top bar.
3. **User management → Invite users:** generate a registration link/QR code.
4. Registrants can sign in immediately at Level 3. Assign the Chief Admin and adjust permissions as required.
5. **eFile List → New eFile:** create records and select participants/approvers.

Favorites, pins, folder organisation and locked searches are personal. They do not grant access. Chief Admin/User Admin, or a System Admin authorized by company settings, manages company connections.

## Update from GitHub

Back up the data first, then pull your new commit and run the same `docker compose ... up --build -d` command. Preserve the named volume. Do **not** use `docker compose down --volumes`: that deletes the stored database and attachments.

## Backup and restore

Back up the whole `/data` directory, including the SQLite database and uploads. For a simple consistent backup, stop the AiWSP container first, copy its `/data` directory to protected backup storage, then restart it. Keep backups off the hosting disk. To restore, stop the application and replace the entire data directory with a matched backup, preserving permissions; then start it and verify both records and attachments. Do not copy only the SQLite main file while the server is running; WAL files may contain recent writes.

## If sign-in or saving fails

- First boot exits: check that `ADMIN_PASSWORD` is at least 12 characters and `/data` is writable.
- Login form loads but saving is rejected: check `PUBLIC_URL` exactly matches your HTTPS origin.
- Login does not persist: check HTTPS and browser cookie settings.
- Data disappears after redeploy: the data directory was not attached to persistent storage.
- Existing administrator password does not change with `.env`: expected; use **User setting → Edit profile & password**.
- Forgotten password: another authorized administrator can issue a reset link for ordinary users. This version has no self-service email recovery or emergency System Admin reset utility; retain administrator credentials securely and keep another named System Admin.
- Repeated login attempts are rate-limited. A proxy may make several people share the same apparent address; do not forward untrusted client IP headers into the app.

The ZIP changes the hosting and sign-in architecture; it is not a fix to Cloudflare's block on the previous URL. It provides a separately hosted installation.
