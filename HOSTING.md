# Hosting IMS from your GitHub repository

## Option 1: your server with Docker and a domain

Use a Linux server with Docker and Docker Compose installed. The server must have persistent storage. Point your domain's DNS record to this server and allow inbound TCP ports 80 and 443.

1. Clone your GitHub repository onto the server and enter its directory.
2. Copy `.env.example` to `.env`. Set a strong `ADMIN_PASSWORD`, your administrator name and, optionally, an email. Add `DOMAIN=your-real-domain.example` using your actual domain. Do not include `https://` in `DOMAIN`.
3. Run:

```sh
docker compose -f compose.production.yaml up --build -d
```

4. Open `https://YOUR_DOMAIN`. Sign in with the `ADMIN_USERNAME` from `.env` and the password you chose.

This production configuration includes Caddy for HTTPS. The application container has no directly published network port. Certificate issuance requires working DNS and external connectivity. The host, domain and any provider charges are yours to configure; this ZIP does not provision a server.

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
| `ADMIN_USERNAME` | The first administrator's user name |
| `ADMIN_PASSWORD` | Your own strong password, at least 8 characters |
| `ADMIN_NAME` | Your administrator display name |
| `ADMIN_EMAIL` | Optional contact email |
| `COMPANY_NAME` / `COMPANY_NAME_CN` / `COMPANY_CODE` | Your company, created on the first start |

5. Deploy one instance. Open the host's URL and sign in.

Never put secrets into GitHub files or frontend environment variables. Enter them in your hosting service's secret/environment controls. Public hosting must use HTTPS. Only localhost development permits HTTP. The configured origin must match the address users open, or write requests will be rejected.

## First business setup

1. **Account → Company:** check your company's name, type, code and city.
2. **Account → Role:** adjust the two standard roles, or add your own.
3. **Account → User:** add each person, with their Chinese and English names, department and roles.
4. **Account → User Group:** group people who share eFiles, e.g. "Management Team".
5. **IMS → My eFile → ＋:** create eFiles, then use the row menu for Set Confirmation, Set Grand Balance/Sum and Set Process.

## Hosting in mainland China

- **ICP filing (备案):** a website on a mainland server, reached by a domain name on ports 80/443, needs an ICP filing before the provider will open it. Your cloud provider (Alibaba Cloud, Tencent Cloud, Huawei Cloud) runs the filing for you; allow a few weeks. A **Hong Kong** server needs no filing and is usually fast enough from the mainland.
- **Downloads during the build:** Docker Hub, npm and GitHub are slow or blocked from many mainland servers. Set `NODE_IMAGE` and `NPM_REGISTRY` in `.env` to the mirrors shown in `.env.example`. For Caddy, either pull `caddy:2` through the same mirror, or use the provider's load balancer for HTTPS. To get the code onto the server, upload a ZIP, or mirror the repository to Gitee.
- **HTTPS certificates:** Caddy's automatic Let's Encrypt certificates normally work from the mainland once DNS points at the server and ports 80/443 are open. Alternatively, use the free certificate from your cloud provider.
- **The application itself** has no outside dependencies at run time (no Google fonts, CDNs or foreign APIs), so pages load normally in China.
- **Personal data:** staff names, phones and emails are personal information under China's PIPL. Keep the server and its backups in a region you are comfortable with, and restrict who holds the admin account.

## Update from GitHub

Back up the data first, then pull your new commit and run the same `docker compose ... up --build -d` command. Preserve the named volume. Do **not** use `docker compose down --volumes`: that deletes the stored database and attachments.

## Backup and restore

Back up the whole `/data` directory, including the SQLite database and uploads. For a simple consistent backup, stop the application container first, copy its `/data` directory to protected backup storage, then restart it. Keep backups off the hosting disk. To restore, stop the application and replace the entire data directory with a matched backup, preserving permissions; then start it and verify both records and attachments. Do not copy only the SQLite main file while the server is running; WAL files may contain recent writes.

## If sign-in or saving fails

- First boot exits: check that `ADMIN_PASSWORD` is at least 8 characters and `/data` is writable.
- Login form loads but saving is rejected: check `PUBLIC_URL` exactly matches your HTTPS origin.
- Login does not persist: check HTTPS and browser cookie settings.
- Data disappears after redeploy: the data directory was not attached to persistent storage.
- Existing administrator password does not change with `.env`: expected; use **your name (top right) → Change Password**.
- Forgotten password: a user with the User permission can use **Reset Password** in the user's row menu. Only the first (system) administrator can reset the system administrator's password, so keep it safe.
- Repeated login attempts are rate-limited. A proxy may make several people share the same apparent address; do not forward untrusted client IP headers into the app.

