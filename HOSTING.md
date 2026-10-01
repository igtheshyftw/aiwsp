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
| `COMPANY_NAME` / `COMPANY_NAME_CN` / `COMPANY_CODE` | The operator company (e.g. WSP), created on the first start |
| `REQUIRE_ADMIN_MFA` | `true` (administrators must use an authenticator app) |
| `CLAMAV_HOST` | Host name of a clamd server for attachment scanning |

5. Deploy one instance. Open the host's URL and sign in.

Never put secrets into GitHub files or frontend environment variables. Enter them in your hosting service's secret/environment controls. Public hosting must use HTTPS. Only localhost development permits HTTP. The configured origin must match the address users open, or write requests will be rejected.

## First business setup

1. Sign in as the first System Admin and set up an authenticator app when asked (Google Authenticator, Microsoft Authenticator, or similar).
2. **Account → User** (in WSP): add your other System Admins by name. Do not share one login.
3. **Account → Company → ＋**: add each client company with its English and Chinese names, address, contact person, email and phone.
4. On that company's row menu, choose **User List**, add the person who will run it, then **Assign Chief Admin**.
5. The Chief Admin signs in, sets up an authenticator, and then:
   - checks the four levels (**Account → Role**)
   - appoints User Admins
   - decides in **Company → Edit** whether WSP System Admins may manage the company's users or connections
   - prints the **Registration QR Code** for staff
   - creates eFiles with their approval steps (**Set Confirmation**)

## Hosting in mainland China

- **ICP filing (备案):** a website on a mainland server, reached by a domain name on ports 80/443, needs an ICP filing before the provider will open it. Your cloud provider (Alibaba Cloud, Tencent Cloud, Huawei Cloud) runs the filing for you; allow a few weeks. A **Hong Kong** server needs no filing and is usually fast enough from the mainland.
- **Downloads during the build:** Docker Hub, npm and GitHub are slow or blocked from many mainland servers. Set `NODE_IMAGE` and `NPM_REGISTRY` in `.env` to the mirrors shown in `.env.example`. For Caddy, either pull `caddy:2` through the same mirror, or use the provider's load balancer for HTTPS. To get the code onto the server, upload a ZIP, or mirror the repository to Gitee.
- **HTTPS certificates:** Caddy's automatic Let's Encrypt certificates normally work from the mainland once DNS points at the server and ports 80/443 are open. Alternatively, use the free certificate from your cloud provider.
- **The application itself** has no outside dependencies at run time (no Google fonts, CDNs or foreign APIs), so pages load normally in China. The only outside services it calls are the ones you configure: WeCom, your mail server and your agent.
- **Notifications by WeCom (企业微信):** in the WeCom admin console (管理后台 → 应用管理), create a self-built app (自建应用) for IMS. Put its **Corp ID** (我的企业 → 企业ID), the app's **Secret** and **AgentId** into `.env` as `WECOM_CORP_ID`, `WECOM_SECRET` and `WECOM_AGENT_ID`, and add the server's public IP under the app's **企业可信IP** (trusted IP), or WeCom refuses the calls. Set the app's visible range to the staff who should receive messages. Each user is found in WeCom by the mobile number on their IMS account, or by the WeCom user ID an administrator enters on the user form. Messages carry only the notification title and a link back into IMS.
- **Notifications by email:** set `SMTP_URL` (for example Tencent Exmail `smtps://ims@yourfirm.com:password@smtp.exmail.qq.com:465`, or Alibaba Mail `smtps://…@smtp.qiye.aliyun.com:465`) and `SMTP_FROM`. Cloud servers usually block outgoing port 25, so use port 465. Everyone chooses WeCom, email, both or neither under My Profile → Notifications; System Admins see delivery status there.
- **Personal data:** staff names, phones and emails are personal information under China's PIPL. Keep the server and its backups in a region you are comfortable with, and restrict who holds the admin account.

## Malware scanning, backups and Alibaba Cloud

- **ClamAV.** `compose.production.yaml` runs a `clamav` container, and the app scans every attachment with it. While ClamAV is starting (it downloads its virus database on first start) or unavailable, uploads are refused with a message rather than stored unscanned. It needs about 2–3 GB of memory. In mainland China, set `CLAMAV_IMAGE` to a mirror, as shown in `.env.example`.
- **Backups.** `docker compose -f compose.production.yaml exec aiwsp node scripts/backup.mjs` writes a consistent copy of the database and attachments to `/data/backups/ims-<date>/` while the site keeps running. Copy these off the server every day. On Alibaba Cloud, install `ossutil` on the host and add a cron job such as:
  ```
  15 3 * * * docker compose -f /srv/ims/compose.production.yaml exec -T aiwsp node scripts/backup.mjs && ossutil cp -r /var/lib/docker/volumes/ims_aiwsp_data/_data/backups oss://YOUR-BUCKET/ims-backups/ --update
  ```
  Use a private OSS bucket in the same region. Delete old local backups periodically, and test a restore occasionally.
- **Restore.** Stop the app, put the backup's `ims.sqlite` in the data directory as `aiwsp.sqlite` and its `uploads/` folder beside it, then start the app.
- **Administrator authenticators.** If an administrator loses their phone, another administrator above them uses **Reset Authenticator** on the user's row menu. Keep at least two System Admins so one can always help the other.

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
- Forgotten password: an administrator uses **Reset Password** in the user's row menu and sends the one-time link (valid one hour). System Admins reset each other, so keep at least two.
- Repeated login attempts are rate-limited. A proxy may make several people share the same apparent address; do not forward untrusted client IP headers into the app.

