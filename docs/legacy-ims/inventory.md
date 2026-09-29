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

- Single "Name" column with a checkbox per row for bulk actions; row background colours (blue, teal, green, white) look user-assigned.
- Icons after a name: ⚙⚙ (probably an approval workflow or automation) and ✱ (probably favourite or required). **❓ confirm what they mean.**
- Header toolbar, left to right: ＋ add, ▦ (view/columns?), 📁 folder, ◌ (loading/refresh?), red 🔨/pin, ⚙ settings, ✱. **❓ hover or click each one and capture.**
- A search box with a 🔒 "locked search" button.
- Page header has its own search and refresh.
- Sample eFiles: DEMO, Test ×2, Expense Claim Demo A/B, Payment eFile, Project summative, Tasks that need intern's assistance.

AiWSP: ✅ eFile lists, folders, favourites, pinning, locked searches, colour. 🟡 toolbar parity and icon meanings to be confirmed.

## IMS → Client Management (`Client List`)

- Columns: **Code**, **CN Name**, **EN Name**, row actions. Green **＋Add** button and ⚙ settings. The list was empty.

AiWSP: ❌ no client entity. **❓ Need the Add Client form (all its fields).**

## Account → Company (`Company List › IMS`)

- Columns: Name (Chinese), English Name, **Type** (e.g. "Communicative"), **Code** (e.g. `L002SH`), **City**, **Status** (Normal). Checkbox, row menu, ＋ add.

AiWSP: 🟡 companies have `name`, `chineseName`, address, contact, email, phone, active. Missing: **type**, **code**, **city**, and a status wider than active/suspended. **❓ Need the add/edit company form and the list of Type values.**

## Account → User (`User List › <company>`)

- Filter **State** (All / …). Columns: Name (login), CN Name, EN Name, **Sex**, **Dept/Position** (multiple values allowed), Email, **Mobile**, **Role** (multiple roles allowed, e.g. "A/C Administrator, Standard - Administrator"), row menu, ⚙.

AiWSP: 🟡 users have name, username, email, role (fixed enum), level, permissions, expiry. Missing: CN/EN names, sex, dept/position, mobile, **several custom roles per user**. **❓ Need the add/edit user form and the State filter values.**

## Account → Role (`Role List`)

- Columns: Role Name, Description, **Share**, Company. Examples: "A/C Administrator: company account administrator with all authorisation"; "Standard users: cannot set up company accounts, users, roles or user groups, or view the system log." Header ⚙▾ dropdown.

AiWSP: 🟡 fixed roles (system/chief/useradmin/member) plus levels 1–4 and per-user permission overrides. Legacy uses **named, company-defined roles**. **❓ Need the role edit screen (the permission matrix) and what "Share" means.**

## Account → User Group (`Group List`)

- Columns: **Name** (e.g. "Management Team"), **Share**, row menu. Header ⚙▾ dropdown.
- Row "≡" menu: **Edit**, **Delete**, **User List** (group members), **Group eFile** (eFiles shared with the group).
- The row menus on other lists probably follow the same pattern (Edit / Delete / related lists).

AiWSP: 🟡 groups have name and members. Missing: **Share**, delete, and the "Group eFile" view. **❓ Need the Edit form, the User List view and the Group eFile view.**

## Account → System Log

- Not captured yet. AiWSP: ✅ audit log. **❓ Capture it.**

## Most valuable next captures

1. Inside an eFile: click a row such as "Expense Claim Demo - A" and capture the item list, an item form and the approval flow.
2. The row "≡" menu on each list (what actions it offers).
3. Add/edit forms for Client, Company, User and Role, including the role permission matrix.
4. User Group edit form, its User List and Group eFile views, and the System Log list.
5. What **Share** means on Role and User Group (open an edit form that has it).
6. Each top-bar badge opened, and the user dropdown.
7. The eFile toolbar icons, and the ⚙⚙ / ✱ markers explained.
