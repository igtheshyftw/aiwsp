# IMS — eFile system

A rebuild of the original IMS ("2015 © IMS") eFile system: the same screens, menus and workflow, running as one small Node.js server with a SQLite database.

The screen-by-screen notes the rebuild follows are in [docs/legacy-ims/inventory.md](docs/legacy-ims/inventory.md). The data model is described in [docs/legacy-ims/data-model.md](docs/legacy-ims/data-model.md).

## What it does

The screens copy the original IMS. How it works follows the AiWSP requirements in [docs/aiwsp/urgent-functions.md](docs/aiwsp/urgent-functions.md) (from the latest Word document). [docs/aiwsp/traceability.md](docs/aiwsp/traceability.md) shows where each requirement is met.

- **Companies and administrators:**
  - The operator company (WSP) has one or more named **System Admins**.
  - Each client company has a **Chief Admin**, assigned by a System Admin, and **User Admins**, appointed by the Chief Admin.
  - The Chief Admin decides whether System Admins may manage the company's users and connections.
  - Managing users never gives access to eFiles.
  - Every administrator must use an authenticator app.
- **Users:**
  - Four authorization levels per company, made of function checkboxes (Account → Role), plus per-user adjustments. Level 3 is the default; Level 4 is temporary, with an expiry date and a responsible administrator.
  - Staff register themselves with the company's **QR code** (unique user name, password twice, WeCom mobile) and can work at once.
  - Password resets are one-time links.
  - The user menu has hand-over tools: transfer, replace, eFile List with remove/replace, and deactivate.
- **Connections:** companies are separate until both sides confirm a connection and each designates the staff who take part.
- **eFiles** (IMS → My eFile) keep the IMS list, toolbar, bulk actions, colours, processes, links and balances. Setup adds:
  - View or Edit rights per person and group
  - eFile Admins, with a Chief Admin fallback
  - optional date and amount columns
  - a standard currency
  - "approval required" with any number of named steps (Set Confirmation)
- **Items:**
  - Each item has a unique ID. A blank amount stays blank; zero is zero.
  - Default order: dated items newest first, then undated items by name.
  - A save is refused if someone else changed the item in the meantime.
  - Attachments are limited to safe types and 10 MB, content-checked, and malware-scanned with ClamAV in production.
- **Approval:**
  - Submit, then approve / return / reject step by step, with reasons for return and reject. Every submission goes through all of the eFile's steps. Nobody approves their own item.
  - A returned item is corrected into a new version and approval restarts from step 1.
  - The submitter can withdraw.
  - A step with no eligible approver pauses until an admin assigns one.
  - System Admin override is recorded separately.
  - Submitted history is never deleted, only archived.
- **AiWSP Assistant:**
  - Clients chat with your agent and can ask for a person.
  - WSP professionals review answers, take over, reply and keep internal notes in a Client Conversations inbox.
  - The agent plugs in through `AGENT_URL` or `server/agent.ts`; see [docs/aiwsp/assistant.md](docs/aiwsp/assistant.md).
- **Clients** (IMS → Client Management):
  - A client record is added in three steps and can be linked to the client's own company account.
  - Its **service team** (users or groups) is offered as participants of the client's new eFiles and gets the client's Assistant conversations first.
  - Each client has a page with its eFiles, open and overdue items, and conversations. The purple top-bar badge lists the clients you serve.
  - Service Team Transfer/Copy hand a departing user's clients to a colleague.
- **Deadlines:** the To Do **Deadlines** tab lists overdue items and those due within 7 days. Every morning (8:00 Shanghai time by default) the server reminds the people carrying items that are due soon or overdue (then weekly), approvers of steps waiting more than 3 days, and the administrators responsible for temporary accounts about to expire. Settings are in `.env.example`.
- **Responsible person:** each item can have one person carrying it (anyone who can edit in the eFile). They see it under To Do → **My Work** and get its reminders. Items of eFiles without approval are finished with **Mark complete** (and can be reopened); approval items finish when approved.
- **To Do** (home) has six tabs: Confirm, My Work, Deadlines, My Items, Paused, Process Executor. Notices show in the top bar. The **System Log** records logins, views, changes, downloads, approvals and overrides.

qChat, WeChat/WeCom delivery, item templates and recurring items are not built yet (the document allows WeCom and recurring items later).

## Try it with sample data

With Node.js 24 or newer:

```sh
npm ci
npm run build
npm run demo
```

Open http://localhost:3000 and sign in with the password `demo-password` as:
- **Michael**: Chief Admin of LSK
- **William**: User Admin
- **Michelle** or **john**: staff
- **wsp-admin**: WSP System Admin

Michelle's claims wait for Michael's approval, then William's. The demo also starts a stand-in agent, so the AiWSP Assistant answers a few questions. The demo turns off the authenticator requirement so you can look around; real installations keep it on. The sample data lives in `./demo-data`; delete that folder to start over.

## Run it for real

```sh
cp .env.example .env
```

Edit `.env`:
- Set `ADMIN_PASSWORD` (at least 8 characters).
- Set the first System Admin's user name.
- Set the operator company's name (e.g. WSP).

Then start it, with Docker:

```sh
docker compose up --build -d
```

or without Docker:

```sh
npm ci && npm run build && npm start
```

Open **http://localhost:3000** and sign in with `ADMIN_USERNAME` and the password you chose. You will be asked to set up an authenticator app. Then:
1. Add each client company under **Account → Company**.
2. Add its first user, and **Assign Chief Admin**.
3. The Chief Admin takes over from there: levels, User Admins, the registration QR code, groups, connections and eFiles.

See [HOSTING.md](HOSTING.md) for putting it on a server with HTTPS.

## Develop

```sh
npm run typecheck
npm run build
npm test
```

`npm test` starts the built server on a temporary database and checks the AiWSP rules end to end: authenticators, delegation, registration, levels, approvals, attachments, connections, processes, backups and the log.

`npm run backup` makes a consistent copy of the database and attachments into `BACKUP_DIR` while the server runs.

## Layout

| Path | What |
| --- | --- |
| `server/db.ts` | SQLite schema |
| `server/auth.ts` | sessions, passwords, first-run setup |
| `server/ctx.ts` | AiWSP authority rules (who manages what), levels, connections, system log |
| `server/access.ts` | who may open an eFile (membership only) and with which right |
| `server/actions/` | the API actions (account, efile, item/process) |
| `app/` | the React interface: `ui.tsx` shared parts, `pages/` one file per menu area, `ims.css` the IMS look |

Data (the SQLite file and uploaded attachments) lives in `DATA_DIR`. Run one instance per data directory.

Earlier versions of this repository stored data as a single workspace document. That data is not carried over; the new schema starts empty.
