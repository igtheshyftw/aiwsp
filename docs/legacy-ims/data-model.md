# IMS rebuild: proposed data model

Status: **implemented** (see section 11 for the choices the build made where IMS was unclear). It is based on the screens in [inventory.md](inventory.md). Items marked **Assumption** are guesses that still need a screenshot or the owner's confirmation. Section 9 lists them all.

## 1. Storage approach

AiWSP currently keeps the whole workspace as **one JSON document** in SQLite (`workspace.body`), rewritten on every change and capped at about 8M characters.
IMS is ledger-shaped: many items, links between eFiles, running totals, and a log that records every view. That does not fit one document.

**Proposal:** normal SQLite tables (still `node:sqlite`, still one file in `DATA_DIR`, so hosting stays the same), with each action in a transaction. Sessions, throttling and attachment storage in `server/storage.ts` stay as they are.

Conventions: `id TEXT` (UUID) primary keys; `company_id` on every tenant-owned row; `created_at` / `updated_at` ISO timestamps; soft delete (`deleted_at`) where IMS offers "Delete" but history must survive.

## 2. Accounts (Account menu)

### company
| column | notes |
|---|---|
| name_cn, name_en | "LSK 仲诚投资管理有限公司" / "LSK & Partners Limited" |
| type | e.g. "Communicative". **Assumption:** a fixed list; values still needed |
| code | e.g. `L002SH`, unique |
| city | |
| status | `normal` / `suspended` (only "Normal" seen) |

### user
| column | notes |
|---|---|
| company_id | |
| username | login name ("Michael", "williamleong") |
| name_cn, name_en | |
| sex | `M` / `F` |
| email, mobile | |
| state | `active` / `invalid` (the "Invalid" action). The State filter's other values are unknown |
| password_hash, totp_secret | reuse the current auth |

**user_position**(user_id, text): Dept/Position, several per user ("LSK Management, Management").

### role, user_role
Roles are **named per company**, with a description, and a user can hold several.
- **role**(company_id, name, description, share)
- **role_permission**(role_id, permission_key)
- **user_role**(user_id, role_id)

The permission keys come from the role edit screen, which hasn't been captured yet. Known so far: set up company account, users, roles and user groups, and view the system log (the "Standard users" description lists exactly these as denied).
**Share:** meaning unknown. **Assumption:** the role or group is visible to connected companies.

### user_group, user_group_member
- **user_group**(company_id, name, share)
- **user_group_member**(group_id, user_id)

The row menu has "User List" and "Group eFile". "Group eFile" is a query (eFiles whose participant groups include this group), not a table.

### client (IMS → Client Management)
**client**(company_id, code, name_cn, name_en). **Assumption:** more fields are on the Add form, which hasn't been captured yet.

## 3. eFiles

### efile
| column | from screen |
|---|---|
| company_id | |
| name | *Name |
| tag | Tag |
| item_template_folder | Item Template Folder. **Assumption:** points to a folder of item templates |
| select_type | `user_and_group` (the only option seen) |
| highlight | bool |
| color | named palette entry, e.g. `personalised_3` |
| report_name | |
| item_type | `number` (the only value seen) |
| balance, balance_alias | opening Balance/Sum and its label ("Amount Payable to A") |
| notional_balance, notional_balance_alias | |
| currency | CNY in the item list header. **Assumption:** stored per eFile |
| password_hash | "Set Password" / "Cancel Password" |
| archived_at | "Archive" |
| wechat_sync | Sync With Wechat settings. The integration itself is out of scope for now |

- **efile_member**(efile_id, user_id | group_id, kind): `kind` is `participant` or `admin`. Separate rows handle the "Sync With Wechat: Participants/Group" lists (`kind = wechat_participant | wechat_group`).
- **efile_confirmation_step**(efile_id, position 1–5, title, user_id): e.g. 1 "Michelle submission" → Michelle. The same user may appear on more than one step.

### Per-user eFile state
**user_efile**(user_id, efile_id, in_my_efile, hidden, mtt, color_override)
Covers Add/Remove from My eFile, Hide/Cancel Hide, MTT-MyeFile (**meaning unknown**) and personal colour.

**efile_link**(owner_user_id, efile_id, position): the "eFile Link" shortcuts ("Add to eFile Link", "Assign eFile Link" on a user).
**system_link**(company_id, name, target, …): the System Link page. It was empty, so its fields are unknown.

### Sharing
**efile_share**(efile_id, to_user_id | to_company_id, share_balance): "Copy And Share", "Share"/"Cancel Share", "Share Balance".

## 4. Items

### item
| column | from screen |
|---|---|
| efile_id | |
| name | multi-line text |
| amount | `NUMERIC` stored as integer cents to avoid float drift; shown with 2 decimals |
| item_date | |
| target_date | due date |
| highlight, move_to_top, special_marking | flags |
| favorite | ☆. **Assumption:** per user, so it belongs in `user_item_star(user_id,item_id)` |
| status | `uncompleted` / `completed` |
| process_run_id | set while the item is moving through a process (§6) |
| created_by, created_at, updated_at | |

- **item_confirmation**(item_id, step_position, required, confirmed_by, confirmed_at): the item ticks which of the eFile's steps apply, and each is recorded when signed. The ①–④ markers render from this.
- **item_attachment**(item_id, storage_key, filename, size). **Assumption:** the boxed number marker is an attachment count.
- **item_comment**(item_id, user_id, body, at). **Assumption:** the blue and green row counters are comments and attachments.

### Balances
The eFile's "Sum" and the two pinned rows are **computed**, not stored:
`balance + SUM(amount of items in scope)`, and likewise for the notional balance.
**Assumption:** which items count towards "notional" versus actual is unclear. Perhaps completed items only count towards the actual balance, and all items towards the notional one.

## 5. Links between items (the core ledger mechanism)

A single **item_link** table covers all six options on the item form:

| column | notes |
|---|---|
| source_item_id | the item being edited |
| kind | `auto_link`, `conditional_auto_link`, `split_link`, `auto_copy`, `auto_share`, `bind` |
| target_efile_id | |
| target_item_id | the mirrored or copied item created in the target eFile (for `bind`, the chosen existing item) |
| change_sign | bool; the target amount is negated |
| split_amount | for `split_link` only |
| process_step_efile_id | for `conditional_auto_link`: create the link only once the source reaches this stage |
| locked | "Not Lock Auto Link" filter implies links can be locked |

Behaviour per kind (**Assumption** for each; confirm):
- **auto_link**: create a mirrored item in the target eFile, and keep its name, date and amount (± sign) in sync with the source.
- **conditional_auto_link**: the same as auto_link, but only once the source reaches `process_step_efile_id`.
- **split_link**: create a mirrored item carrying `split_amount` instead of the full amount. The splits should add up to the source amount.
- **auto_copy**: a one-time independent copy (± sign). It does not stay in sync.
- **auto_share**: no new item; the same item also appears in the target eFile's list.
- **bind**: a reference to an existing item only; no amounts move.

This is what makes "a 300 claim appears as −300 against Amount Payable to A".

## 6. Processes (Set Process / Process Monitor)

- **process**(company_id, name): e.g. "Expense Claim Demo - A".
- **process_stage**(process_id, position, efile_id, executor_user_id, auto_commit, confirm_balance)
- **process_stage_notify**(stage_id, user_id): Notify Others.
- **process_run**(process_id, item_id, current_stage, status): one item's journey.

Flow (**Assumption**, confirm):
1. An item created in the stage 1 eFile starts a run.
2. When the item's required confirmations are all signed, the stage is ready:
   - if `auto_commit` is on, the item moves to the next stage automatically;
   - otherwise it shows in the executor's **To Do → Process Executor**, and the executor commits it.
3. "Moving" means the item appears in the next stage's eFile. Whether this is a new linked item or the same item is **unknown**.
4. At a stage with `confirm_balance`, the eFile balance is confirmed or updated.
5. After the last stage, the run is `completed`, and the item shows under the "eFile Completed Process" filter.

The Process Monitor's per-stage count is `COUNT(process_run WHERE current_stage = n)`.
The "Relevant eFile List" tab lists the processes whose stages include this eFile.

## 7. Notifications and To Do

- **notification**(user_id, kind, efile_id, item_id, read_at). There are four top-bar counters. **Assumption:** they correspond to chat, connection requests, announcements and messages, but their exact meaning is unconfirmed.
- **To Do → Confirm** = items where the user holds the next unsigned required step.
- **To Do → Process Executor** = eFiles where the user is executor of a stage with items waiting.

Both are queries, not stored.

## 8. System log

**system_log**(at, company_id, user_id, module, function, source, content)
- module: `login`, `efile`, … (IMS shows 用户登录/注销, eFile)
- function: `add`, `modify`, `view`, `delete` (新增 / 修改 / 查看)
- source: `web` (others probably existed, e.g. mobile)
- content: e.g. "Opened eFile: Test"

**Views are logged**, not just changes. There are filters for user, date range and content text.
The current AiWSP `audit` rows migrate into this table.

## 9. Open questions (need screenshots or answers)

1. **Confirming an item**: what the confirmer sees; can they reject or comment?
2. **Executor**: what "commit" looks like; does the item move as-is or as a new linked item?
3. Does **Auto Commit** fire when the confirmations complete?
4. The **red dot** on stage 2 in Set Process.
5. Notional versus actual balance: which items count towards each?
6. The **C** marker and the boxed number on items; the blue and green row counters.
7. **Share** on Role and User Group; **MTT** in MTT-MyeFile.
8. The role permission list (role edit screen).
9. The Company, User and Client edit forms; the State and Type value lists.
10. **Service Team** and **qChat** (named in the User menu); the four top-bar badges.
11. **System Link** entries: what one contains.
12. Item templates ("Item Template Folder").

## 10. Suggested build order

1. **Storage migration**: tables above, and a one-time importer from the current JSON workspace.
2. **Accounts**: company, user, role, group and system log. These are almost fully mapped and unblock everything else.
3. **eFiles and items**: list, setup form, item form with confirmations, and balances.
4. **Links**: auto link and change sign first (they drive the ledgers), then the others.
5. **Processes**: Set Process, runs, executor To Do, and the monitor.
6. Then: sharing, eFile links, System Link, notifications, and WeChat.

## 11. Choices made in the build (please correct any that differ from IMS)

| Question | What the rebuild does |
|---|---|
| When is a confirmation step signed? | In order. Only the users on the next unsigned step can sign. A confirmer (or eFile admin) can **Return** the item, which clears all signatures. |
| What is **Auto Commit**? | When an item at that stage has at least one required step and all are signed, it moves to the next stage by itself. Otherwise the stage **Executor** commits it from the item menu. |
| Does the item move, or is it copied? | Each stage keeps its own copy: committing creates the item in the next stage's eFile (it needs that eFile's own confirmation steps), and the earlier copy becomes Completed. |
| Balance/Sum vs Notional | Balance/Sum = opening balance + every item in the eFile. Notional = notional opening balance + items not yet Completed. |
| Completed / Uncompleted | Completed = all required steps are signed and the item is not waiting at a process stage, or it has moved on or finished its process. |
| Item markers | ☆ star (per user); ①–⑤ steps (filled when signed); boxed number = current process stage; ⚙⚙ = in a process; boxed **C** = all confirmations signed. |
| Blue / green counters on items | Comments / attachments. |
| eFile markers | ⚙⚙ = the eFile is a stage in a process; ✱ = the eFile is shared; 🔒 = password. |
| Red dot in Set Process | The stage's executor cannot open that eFile (add them as a participant). |
| **MTT-MyeFile** | "Move To Top" in My eFile. |
| **Expand eFile** | Shows each eFile's tag and last update under its name. |
| **System Link** | Company-wide list of named web links. |
| **Share** (eFile) | Shared users can open the eFile. **Share Balance** also shows them the balance rows. |
| **Share** (Role, User Group) | Stored and shown; it has no effect yet. |
| User "Role" column | Role names plus "Standard - Normal User / Administrator". The Administrator level can open every eFile of the company (eFile Explorer). |
| Links on items | Auto Link and Split Link keep the linked item in step with the original (unless locked). Auto Copy copies once. Auto Share shows the same item in another eFile. Bind only records a reference. Conditional Auto Link is created when the item reaches the chosen process stage. |
| System log | Module and function are shown in the original Chinese labels (用户登录/注销, 查看, 新增, 修改, 删除). |
| Not built yet | qChat, Service Team, WeChat sync, Item Template Folder. They appear in the menus and say they are unavailable. |
