# IMS — eFile system

A rebuild of the original IMS ("2015 © IMS") eFile system: the same screens, menus and workflow, running as one small Node.js server with a SQLite database.

The screen-by-screen notes the rebuild follows are in [docs/legacy-ims/inventory.md](docs/legacy-ims/inventory.md). The data model is described in [docs/legacy-ims/data-model.md](docs/legacy-ims/data-model.md).

## What it does

- **eFile (home) / To Do**: items waiting for your confirmation, and process stages where you are the executor.
- **IMS → My eFile**: coloured eFile list with the original toolbar:
  - New eFile, Expand eFile, System Link, Recently Updated, To Do
  - bulk actions: My eFile, MTT (move to top), share, share balance, hide, password, add/remove/replace users, rename, colour, eFile Link, archive
  - views: My Process, My Confirmation, eFile Link, Hide List, eFile Explorer, Archive List, Filter By Color
- **eFile row menu**: View, Edit, Delete, Set Confirmation (up to five titled sign-off steps), Set Process, X Process Set, Set Grand Balance/Sum, eFile Process Monitor, Copy And Share, Cancel Share, Copy eFile.
- **Item List**:
  - Balance/Sum and Notional Balance/Sum rows, with their aliases
  - markers: star, ①–⑤ confirmation steps, process stage, C = all confirmed
  - filters: Uncompleted, Completed, Special Marking, All, per step, eFile Process, eFile Completed Process, Not Lock Auto Link
  - bulk actions, CSV export
- **Edit Item**:
  - name, amount; Highlight, Move to Top, Special Marking
  - **Auto Link**, **Conditional Auto Link**, **Split Link**, **Auto Copy**, **Auto Share** and **Bind**, with **Change Sign**
  - which confirmation steps apply; Item Date and Target Date
- **Confirmation**: steps are signed in order by their assigned users. A confirmer can also return the item.
- **Processes**: a chain of eFiles, each stage with an executor. With Auto Commit ticked, an item moves on by itself once its confirmations are done; otherwise the executor commits it.
- **Items** also have attachments and comments.
- **Account**:
  - Company, User (with the hand-over tools: participant/admin/process transfer, copy, insert, replace, reset password, invalid), Role (named, per company, with permissions), User Group (with User List and Group eFile), System Log
  - the log records logins and eFile views as well as changes
- **IMS → Client Management** and **System Link**.

qChat, Service Team and WeChat sync appear in the menus as in IMS, but they are not implemented yet.

## Try it with sample data

With Node.js 24 or newer:

```sh
npm ci
npm run build
npm run demo
```

Open http://localhost:3000. Sign in as **Michael**, **john**, **Michelle** or **William**, with the password `demo-password`. The sample data lives in `./demo-data`; delete that folder to start over.

## Run it for real

```sh
cp .env.example .env
```

Edit `.env`:
- Set `ADMIN_PASSWORD` (at least 8 characters).
- Set the administrator's user name, and your company's name and code.

Then start it, with Docker:

```sh
docker compose up --build -d
```

or without Docker:

```sh
npm ci && npm run build && npm start
```

Open **http://localhost:3000** and sign in with `ADMIN_USERNAME` and the password you chose. The administrator and the company are created on the first start only. Then add users under **Account → User**, and give them roles. The two standard roles are:
- **A/C Administrator**: everything.
- **Standard users**: eFiles and clients, no Account menu.

See [HOSTING.md](HOSTING.md) for putting it on a server with HTTPS.

## Develop

```sh
npm run typecheck
npm run build
npm test
```

`npm test` starts the built server on a temporary database. It runs the whole claim → payment → banking flow, plus the permission checks.

## Layout

| Path | What |
| --- | --- |
| `server/db.ts` | SQLite schema |
| `server/auth.ts` | sessions, passwords, first-run setup |
| `server/ctx.ts` | permissions, system log |
| `server/access.ts` | who may open an eFile |
| `server/actions/` | the API actions (account, efile, item/process) |
| `app/` | the React interface: `ui.tsx` shared parts, `pages/` one file per menu area, `ims.css` the IMS look |

Data (the SQLite file and uploaded attachments) lives in `DATA_DIR`. Run one instance per data directory.

Earlier versions of this repository stored data as a single workspace document. That data is not carried over; the new schema starts empty.
