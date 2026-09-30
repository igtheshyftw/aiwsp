# AiWSP requirements → implementation

Each line of [urgent-functions.md](urgent-functions.md) (from `AiWSP_Urgent_Functions_Combined.docx`), how the build meets it, and whether `npm test` checks it.
The screens keep the IMS look; where IMS and this document differed, **this document decides how things work**.

Legend: ✅ done and tested · ☑️ done (checked in the browser, not in the automated test) · ⏳ later, as the document allows · ⚠️ partly done (see note)

## Companies account

| Requirement | Implementation | Status |
|---|---|---|
| Separate account per company: EN/CN names, address, contact person, email, phone | `company` table; Account → Company → Edit | ✅ |
| WSP System Admin is the ultimate authority; multiple named System Admins, no shared login | The first System Admin comes from `.env`. Others are added in the WSP company with Position = System Admin. The last one cannot be demoted. | ✅ |
| WSP staff only access assigned companies, contacts and eFiles | eFile access comes only from eFile membership (`server/access.ts`). WSP staff reach client contacts only through connections. | ✅ System Admin sees no client eFiles |
| System Admin assigns/replaces each company's Chief Admin; with none, System Admin manages the company | Company row menu → Assign Chief Admin (`company.chief`). `companyAdmin()` / `managesUsers()` fall back to System Admins when there is no active Chief Admin. | ✅ |
| Chief Admin selects who manages users (Chief/User Admin, or System Admin if authorized) | Company settings (Chief Admin only): "Allow WSP System Admins to manage our users / connections". Only the Chief Admin appoints User Admins. System Admins can always add and delete accounts of any client company; without the setting they cannot otherwise change those accounts (User List shows "Add and delete only"). | ✅ |
| User-management permission does not grant eFile access | Managers see users, not eFiles | ✅ |
| Companies separate by default; client-to-client connections need both confirmations | Account → Connection: request → the receiving company accepts | ✅ |
| Chief/User Admin (or authorized System Admin) designate connected staff and manage settings | "Designate Our Staff" on each connection; revoke either side | ✅ |
| Finding a contact does not grant eFile access | Connected contacts appear only in pickers of designated staff and managers; each eFile is shared individually | ✅ |

## Users account

| Requirement | Implementation | Status |
|---|---|---|
| Four authorization levels by function checkboxes; Level 3 default; Level 4 temporary; individual adjustments | Account → Role shows Levels 1–4 per company (function checkboxes). The user form adds per-user adjustments. | ✅ |
| Separate view, edit, download/export, approval and administration rights | Functions: create eFile, create item, edit, download, export, submit, approve, eFile administration, client management. Viewing comes from membership; each eFile member also has View or Edit. | ✅ |
| Users cannot elevate themselves or grant beyond their authority | You cannot edit yourself or anyone of equal or higher standing. Managers cannot set a better level than their own or grant functions they lack. | ✅ |
| Register through company QR code: unique username, password twice, WeCom mobile; QR expires and is revocable | User → ⚙ → Registration QR Code (1–30 days, revoke); public `#/register` page | ✅ |
| Immediate use with default level; notify the applicable admin, who adjusts later | Registration creates a Level 3 user and signs them in. Notices go to the Chief/User Admins, or System Admins where the company allows. | ✅ |
| Chief/User Admin manage groups; show group's eFiles before adding members; external members only approved contacts | Group form lists the eFiles the group opens. Members are checked with `eligibleContact()`. | ✅ |
| List each user's eFiles and roles (eFile User, eFile Admin, Approval User); removal/replacement by eligible user | User row menu → eFile List, with Remove/Replace per role. A replacement must be eligible and hold the function. | ✅ |
| Revoke departing users immediately; keep history; reassign unfinished approvals | "Invalid" and "Replace" end sessions at once. History keeps the old name. "Replace" moves pending approvals; otherwise the step pauses. | ✅ |
| Delete accounts without losing history | User List → Delete. An account that never did anything is removed. Otherwise it is closed for good: sign-in, sessions, memberships and assignments are removed, the record stays so items, approvals, messages and log entries keep their author, and the name stays reserved. Its approval steps pause and eFile admins are told to reassign. | ✅ |
| Temporary accounts need expiry and a responsible administrator | Level 4 (or any expiry) needs a future date and a Chief/User Admin. Sign-in stops after expiry. | ✅ (expiry blocking is enforced in `sessionUser`/login) |
| Secure password reset; admin multi-factor authentication; never display stored passwords | Reset Password gives a one-time link valid for one hour. Administrators must enrol a TOTP authenticator before doing anything else. Passwords are PBKDF2-hashed and never shown. | ✅ |

## eFiles

| Requirement | Implementation | Status |
|---|---|---|
| List accessible eFiles and items with "Created by me" | eFile ✱ menu → Created by me; item filter → Created by me | ☑️ |
| Each eFile belongs to one company; users see only what they may | `efile.company_id`; every request re-checks access | ✅ |
| Name; users/groups with rights; cross-company only within connection; one eFile does not expose others | eFile Setup: participants and groups each View/Edit; pickers include connected contacts only | ✅ |
| One or more eFile Admins; keep an active admin or Chief/System fallback | Admins need the eFile administration function. With no live eFile Admin, the Chief Admin (or System Admin) administers it, and the form says so. | ✅ |
| Date/amount columns optional; standard currency code; changing currency doesn't relabel amounts | Setup checkboxes; ISO currency list; each item stores its own currency | ✅ |
| Approval on/off; ordered step names and eligible approvers; add steps; changes affect future submissions only | Set Confirmation: any number of named steps (up to 20). Submissions snapshot the steps and approvers. | ✅ |
| Edit page; hiding a column keeps values | Edit keeps stored amounts and dates when columns are hidden | ✅ |
| Item name; unique system ID | `item.seq` shown as #ID | ✅ |
| Amount/date only if enabled; blank ≠ zero | Amount is NULL when blank; "0" is stored as 0 | ✅ |
| Attachments: size/type limits, malware checks, block unsafe, protect previews and downloads | 10 MB limit; allow-list of types; content signature checks; executables and macro files blocked; ClamAV scan when `CLAMAV_HOST` is set (production compose runs it, and uploads are refused if it is down); preview and download re-check access; downloads need the download function | ✅ (ClamAV itself not in the automated test) |
| Admin lock/unlock drafts | Item menu → Lock / Unlock (eFile Admin, drafts only) | ☑️ |
| Recurring items | Not built; the document allows adding them later | ⏳ |
| Show date, name, amount with currency, attachment icon and current step number; click number for full process | Item List: step number in a circle opens the item page with the full process; paperclip icon; currency | ☑️ |
| Hide date/amount columns when no displayed item has values (zero counts) | `columns` in `item.list` | ✅ |
| Default order: dated newest first, undated by name, ID breaks ties | Server sort (IMS "Move to Top" still comes first) | ✅ |
| Detect simultaneous edits | Version numbers on eFiles and items; a stale save is refused | ✅ |
| Access removal blocks old item and attachment links | Every item and file request re-checks access | ✅ |

## Approval

| Requirement | Implementation | Status |
|---|---|---|
| Step by step; responsible approver; only the active step acts; no duplicate decisions; no self-approval by creator/submitter/editor | `item.decide`: eligibility check plus a single-row update | ✅ |
| Lock submitted item and attachments; notify the next approver; notify all participants at the end | Pending, approved and rejected items refuse edits and attachment changes; notifications at each step | ✅ |
| Every submission goes through all steps | The owner's choice (30 Sep): no per-item step selection | ✅ |
| Approve / Return / Reject; reason required for return and reject; corrections create a new version and restart at step 1; keep earlier versions and decisions | `item_version` snapshot per submission; `item_step` rows per round | ✅ |
| Submitter withdraws with a reason | Withdraw | ✅ |
| Approver leaves or loses access → pause until an admin assigns an eligible replacement; never skip | The step shows "Paused". The eFile Admin uses Assign approver; paused items are listed under To Do → Paused. | ✅ |
| Admins cannot overwrite submitted/approved versions; System Admin may reopen or override with a reason and notify; shown separately | Override: approve / reopen, System Admin only, reason required; shown in red in History and the System Log | ✅ |
| "No approval required" shown, not "Approved"; archive completed; no silent deletion of submitted items or history | Status label; only never-submitted items can be deleted; eFiles with submissions can only be archived | ✅ |

## Notification system

| Requirement | Implementation | Status |
|---|---|---|
| In-system notices for registration, approval steps, returns/rejections, completion, access changes, overrides | The blue envelope (messages) and the red badge (approvals waiting) | ✅ |
| Pending tasks visible even if delivery fails | To Do tabs are computed live, not from notices | ✅ |
| Retry failed notifications without duplicate workflow actions | In-system notices are written in the same transaction as the action, so there is no separate delivery to retry. External delivery (WeCom) will need a retry queue. | ⚠️ applies once WeCom is added |
| Content and links restricted to the recipient's access | Notices about eFiles the reader can no longer open are shown without their title or link | ✅ |
| WeCom/WeChat later; verify binding first | Not built; mobile numbers are only stored | ⏳ |

## System stored on Alicloud

| Requirement | Implementation | Status |
|---|---|---|
| Keep data and attachments private | Nothing is public: every page and file needs a signed-in session with access | ✅ |
| Maintain backups | `npm run backup` makes a consistent copy of the database and attachments; HOSTING.md shows a daily copy to Alibaba Cloud OSS | ✅ (the backup command is tested; the OSS upload is documented) |
| Log user/permission changes, edits, downloads, approvals and overrides; keep attribution | System Log (Chinese labels as in IMS); history keeps names after users leave | ✅ |

## Main loopholes addressed

| Loophole | Closed by |
|---|---|
| WSP staff inheriting ultimate access | Membership-only eFile access; delegation settings; tested |
| User admins escalating privileges | Rank and grant limits; tested |
| Cross-company search exposing files | Contacts only through confirmed connections and designated staff; tested |
| Unlocking invalidating approvals | Submitted/approved versions are immutable; corrections are new versions; admin lock only on drafts |
| Former staff retaining access | Invalid/Replace revoke sessions immediately; expiry for temporary accounts; tested |
| Unsafe attachments | Type allow-list, signature checks, macro and executable blocking, ClamAV; tested |
| Blank amounts treated as zero | NULL vs 0; tested |
| Missing audit history | System Log, item history, versions; tested |
