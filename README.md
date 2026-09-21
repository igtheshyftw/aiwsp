# AiWSP — standalone website

This is the complete standalone application, with the eFile interface based on Mainpage-260907V1. It does not require ChatGPT sign-in, ChatGPT Sites, Cloudflare Workers, D1 or R2.

## Upload to GitHub

1. Extract the ZIP.
2. Create a GitHub repository, preferably private.
3. Upload the **contents of the `aiwsp` folder**, so `package.json`, `Dockerfile` and this README are at the repository root. Upload the extracted files, not the ZIP itself. Include `.github` if you want automatic checks.
4. Follow **[HOSTING.md](HOSTING.md)** to run the website.

**GitHub stores the code. GitHub Pages cannot host the full application:** it serves static files, while AiWSP needs a running server, database and upload storage. The included Docker setup runs all application functions on your own host.

## Try it on your computer

With Docker Desktop installed:

```sh
cp .env.example .env
```

Edit `.env` and set `ADMIN_PASSWORD` to your own password of at least 12 characters. Then:

```sh
docker compose up --build -d
```

Open **http://localhost:3000**. Sign in with **wsp-admin** and the password you chose. On Windows, copy `.env.example` to `.env` in your file manager instead of using `cp`.

No shared or default password is included. Administrator credentials initialize an empty database only; changing the environment later does not reset an existing account.

## What is included

- Company accounts and named System Admin, Chief Admin and User Admin roles.
- Immediate company registration at Level 3; later permission adjustments.
- eFile lists, personal folder hierarchy, favorites, pinning, recent updates and locked searches.
- Items, attachments, sequential approvals, revisions and audit records.
- Username/password sign-in, session revocation and optional authenticator codes.
- Persistent SQLite database and file storage, Docker files and GitHub checks.

The package starts with an empty workspace. Existing data from the ChatGPT-hosted site is **not** included or migrated. The existing published site is unchanged.

## Develop without Docker

Use Node.js 24 or newer. Copy and edit `.env` first, then:

```sh
npm ci
npm run typecheck
npm run build
npm test
npm start
```

For source edits, rebuild and restart the server. Tests use a separate temporary database and remove their own test data.

## Operating scope

Run **one application instance** against one persistent data directory. Do not use an ephemeral filesystem or scale this version across multiple containers. SQLite and attachment files live in `DATA_DIR` (Docker: `/data`). The current workspace document has an 8-million-character capacity limit; larger deployments need a normalized storage model and capacity planning.

WeCom delivery, recurring automation, malware scanning and independent scheduled backups are not configured. Audit history is protected by application rules, not an independent tamper-proof archive. The full Docker image could not be exercised in this environment; the same standalone Node server was built and tested locally, including restart persistence and attachments.

## References

- [GitHub Pages is static hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).
- [Node.js SQLite API](https://nodejs.org/api/sqlite.html).
- [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).
- [Docker Compose environment variables](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/).

Dependencies retain their own licenses. Review their license terms before redistributing the application. No license for your custom application is assigned by this package.
