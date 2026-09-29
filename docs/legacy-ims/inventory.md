# Legacy IMS: screen inventory and gap map

Captured from screenshots of the original "IMS" system (footer "2015 © IMS").
Each screen is compared with what AiWSP already implements (`lib/model.ts`, `app/`).
Personal details (emails, phone numbers) from the screenshots are deliberately left out.

**Direction:** the legacy IMS is the target design. Where AiWSP differs, AiWSP changes to match IMS.
Existing AiWSP code is reused only where it already fits.

Legend: ✅ already in AiWSP · 🟡 partly there · ❌ missing · ❓ need more captures

## Shell / layout

| Element | Legacy behaviour | AiWSP |
|---|---|---|
| Left sidebar | Groups: **eFile** (home), **IMS** → My eFile, Client Management; **Account** → Company, User, Role, User Group, System Log. Collapsible (hamburger). | 🟡 different navigation |
| Top bar counters | Four badge icons: chat/comments, org/connection requests, announcements (megaphone), messages/inbox (shown 11). | 🟡 `notices` exist, but as one list rather than four counters |
| User menu | Avatar + name dropdown (top right). | ❓ contents unknown |
| Tables | Page-size selector (50/100), search box, sortable columns, "Showing X to Y of Z", Prev/Next paging, purple "≡" row-action button. | 🟡 check each list |

## IMS → My eFile (`My eFile List`)

- Single "Name" column with a checkbox per row for bulk actions. Row background comes from the eFile's **Color** setting (named palette entries such as "Personalised 3"); **Highlight** probably makes the name bold.
- Owner's note: the markers and toolbar icons relate to **links to other eFiles**. The ⚙⚙ marker uses the "eFile Process Monitor" icon, so it most likely means "this eFile is part of a process". **❓ what ✱ on a name means (Payment eFile has both).**
- Header toolbar, left to right:
  - **＋** opens a blank **eFile Setup Adminstration** form (create eFile).
  - **▦**, **📁**, **◌**, **red 🔨**: **❓ not captured yet.**
  - **⚙** bulk-action menu for the ticked eFiles: Add to My eFile, Remove from My eFile, MTT-MyeFile, Cancel MTT-MyeFile, Share, Cancel Share, Share Balance, Cancel Share Balance, Hide, Cancel Hide, Set Password, Cancel Password, Add/Remove Users, Replace User, Replace eFile Name, Insert eFile Name, Add/Remove Color, **Add to eFile Link**, eFile Process Monitor, Archive.
  - **✱** views menu: Sync With Wechat, Filter By Color, **My Process**, **My Confirmation** (probably items waiting on me), **eFile Link**, Hide List, eFile Explorer, Archive List.
- A search box with a 🔒 "locked search" button. The page header has its own search and refresh.
- Implied concepts: "My eFile" is a personal list you add eFiles to or remove them from; eFiles can be hidden, archived or password-protected; eFile names can be bulk-edited (replace/insert text). **❓ what "MTT" stands for.**
- Row "≡" menu: **View**, **Edit**, **Delete**, **Set Confirmation**, **Set Process**, **X Process Set** (clear the process?), **Set Grand Balance/Sum**, **eFile Process Monitor**, **Copy And Share**, **Cancel Share**, **Copy eFile**.

AiWSP: 🟡 has eFile lists, folders, favourites, pinning, locked searches and colour, but its eFile model differs (see setup below).

## eFile setup (`eFile Setup Adminstration`, the Edit/View form)

The create form (＋) shows, in order: ***Name**, Tag, **Item Template Folder** (a picker button), Select Type (radio: User And Group), ***Participants**, ***Group**, ***Administrators**, **Sync With Wechat: Participants**, **Sync With Wechat: Group**, … (cut off). People and groups are chosen from a picker and can be cleared with ⊗. A green button top-right probably saves. `*` = required.

Fields seen in the View of an existing eFile (cut off after the last one):

| Field | Example | Notes |
|---|---|---|
| Name | Expense Claim Demo - A | |
| Tag | (empty) | free text? |
| Select Type | User And Group | who can take part: users, groups, or both |
| Participants | list of usernames | semicolon-separated in the display |
| Group | (empty) | user groups taking part |
| Administrators | list of usernames | subset of participants |
| Highlight | No | yes/no |
| Color | Personalised 3 | named palette |
| 1st–5th Confirmation | one user per step (Michelle, Michael, William, Michael) | **up to 5 sequential sign-off steps**; the same person can appear twice |
| Report Name | (empty) | |
| Item Type | Number | ❓ other values (text? date?) |
| Balance/Sum | 0.00 | opening balance |
| Balance/Sum Alias | Amount Payable to A | label of the running-total row |
| Notional Balance/Sum | 0.00 | second, "notional" total |
| Notional Balance/Sum Alias | … | |
| … | | **❓ scroll down and capture the rest** |

## eFile Process Monitor (from the eFile ≡ menu)

Two tabs:
- **eFile Process Monitor**: the chain of eFiles an item passes through, with the number of items at each stage. For Expense Claim Demo - A: 1 Expense Claim Demo - A (3) → 2 Payment eFile (0) → 3 Finance Manager Approval (0) → 4 WL Approval (0) → 5 Cashier Submission (0) → 6 WL Banking Approval (0). Below it is a greyed-out tile labelled 性能 ("performance"), probably an unused dashboard widget.
- **Relevant eFile List**: the processes this eFile belongs to. Columns: Process Name (link), 1st eFile Name, Item.

**Key insight:** a *process* is an ordered chain of eFiles, and an item moves from one eFile to the next (claim → payment → approvals → cashier → bank). This is separate from the 1st–5th Confirmation sign-offs inside a single eFile. **❓ need the Set Process dialog to see how a chain is defined, and what moves an item to the next eFile.**

## eFile → Item List (inside "Expense Claim Demo - A")

- Breadcrumb IMS › My eFile › <eFile>, tinted with the eFile's colour.
- Header: "Item List", status filter **Uncompleted**, **Sum: 0**. Toolbar: 🔍 search, ◻, ＋ add item, 💡, ⚙, ✱.
- Columns: checkbox, **Item Date**, **Name**, **Amount (CNY)**, then three small buttons per row: blue counter, green counter, purple (menu). **❓ what the blue and green counters count (comments? attachments?).**
- The two top rows are the eFile's **Balance/Sum** and **Notional Balance/Sum**, shown under their aliases in a darker blue.
- Name markers: ☆ favourite; ①②③④ the confirmation steps (4 here, matching the setup); a boxed 1 (attachment count?); ⚙⚙ link to another eFile; boxed **C** (completed/confirmed?). "A monthly claim - August" has no ①–④, so it may still be a draft. **❓ confirm.**
- Amounts can be negative (-300.00 claim vs +200.00 / +100.00).

AiWSP: 🟡 items with amount, date, currency and sequential approvals exist. Missing: fixed 5-slot confirmation setup, balance/notional-balance rows, per-row markers.

## IMS → Client Management (`Client List`)

- Columns: **Code**, **CN Name**, **EN Name**, row actions. Green **＋Add** button and ⚙ settings. The list was empty.

AiWSP: ❌ no client entity. **❓ Need the Add Client form (all its fields).**

## Account → Company (`Company List › IMS`)

- Columns: Name (Chinese), English Name, **Type** (e.g. "Communicative"), **Code** (e.g. `L002SH`), **City**, **Status** (Normal). Checkbox, row menu, ＋ add.

AiWSP: 🟡 companies have `name`, `chineseName`, address, contact, email, phone, active. Missing: **type**, **code**, **city**, and a status wider than active/suspended. **❓ Need the add/edit company form and the list of Type values.**

## Account → User (`User List › <company>`)

- Filter **State** (All / …). Columns: Name (login), CN Name, EN Name, **Sex**, **Dept/Position** (multiple values allowed), Email, **Mobile**, **Role** (multiple roles allowed, e.g. "A/C Administrator, Standard - Administrator"), row menu, ⚙.

- Row "≡" menu (mostly hand-over tools for when someone leaves): **Edit**, **eFile Participants Transfer**, **eFile Admin Transfer**, **eFile Process User Transfer**, **Service Team Transfer**, **Group Delete**, **eFile Copy**, **Service Team Copy**, **qChat Transfer**, **qChat Delete**, **Assign eFile Link**, **Reset Password**, **Invalid** (deactivate), **Replace**, **Insert**.
- "Service Team" and "qChat" are modules not seen yet. **❓ where do they appear?**

AiWSP: 🟡 users have name, username, email, role (fixed enum), level, permissions, expiry; `user.replace` covers part of the transfer tools. Missing: CN/EN names, sex, dept/position, mobile, **several custom roles per user**. **❓ Need the add/edit user form and the State filter values.**

## Account → Role (`Role List`)

- Columns: Role Name, Description, **Share**, Company. Examples: "A/C Administrator: company account administrator with all authorisation"; "Standard users: cannot set up company accounts, users, roles or user groups, or view the system log." Header ⚙▾ dropdown.

AiWSP: 🟡 fixed roles (system/chief/useradmin/member) plus levels 1–4 and per-user permission overrides. Legacy uses **named, company-defined roles**. **❓ Need the role edit screen (the permission matrix) and what "Share" means.**

## Account → User Group (`Group List`)

- Columns: **Name** (e.g. "Management Team"), **Share**, row menu. Header ⚙▾ dropdown.
- Row "≡" menu: **Edit**, **Delete**, **User List** (group members), **Group eFile** (eFiles shared with the group).
- The row menus on other lists probably follow the same pattern (Edit / Delete / related lists).

AiWSP: 🟡 groups have name and members. Missing: **Share**, delete, and the "Group eFile" view. **❓ Need the Edit form, the User List view and the Group eFile view.**

## Account → System Log (`Log List`)

- Filters: **User**, **Time** from/to (defaults to the last month), **Content**, then Search.
- Columns: **Time** (to the second), **User** (`CN name:EN name`), **Module**, **Function**, **Source**, **Content**.
- Values seen (the UI is in Chinese here):
  - Module: 用户登录/注销 (user login/logout), eFile
  - Function: 修改 (modify), 查看 (view), 新增 (add)
  - Source: Web (so there were probably other clients, e.g. a mobile app)
  - Content: `用户登录:<user>` (login), `访问eFile:<name>` (opened eFile), `新增eFile:<name>` (created eFile)
- **Views are logged too**, not only changes.

AiWSP: 🟡 has an audit log, but it records changes only and has no module/function/source columns or filters.

## Most valuable next captures

1. **Set Process** dialog (how an eFile chain is defined) and what moves an item to the next eFile.
2. **An item opened**: its form, its confirmation screen, and what happens at each step.
3. The rest of the eFile setup form (below "Sync With Wechat: Group").
4. The ▦, 📁, ◌ and red 🔨 toolbar icons, and what ✱ next to an eFile name means.
5. The ＋ add-item form, and the blue/green counters on an item row.
6. Add/edit forms for User, Role (permission matrix), User Group, Company and Client, and what **Share** means.
7. **Service Team** and **qChat**, each top-bar badge opened, and the user dropdown.
