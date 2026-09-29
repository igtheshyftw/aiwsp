# AiWSP — Urgent Functions Needed

Text of `AiWSP_Urgent_Functions_Combined.docx` (the latest requirements document), kept here so the code can refer to it. How each point is implemented is in [traceability.md](traceability.md).


## Companies account

- Set up a separate account for each company: English and Chinese names, address, contact person, email and phone.
- WSP System Admin is the ultimate authority over all companies and functions. Allow multiple named System Admins; do not use a shared login. WSP staff only access assigned companies, contacts and eFiles.
- System Admin assigns/replaces each company’s Chief Admin. Chief Admin has all company-level authority; if none is assigned, System Admin manages the company.
- Chief Admin selects who manages users: Chief Admin/User Admin, or System Admin if granted authorization in the company settings. User-management permission alone does not grant eFile access.
- Keep companies separate by default. Client-to-client connections require both companies’ confirmation. Chief Admin/User Admin, or System Admin if granted authorization in the settings, can designate connected departments/staff and manage connection settings. Finding a contact does not grant access to their eFiles.

## Users account

- Set four authorization levels by function checkboxes; Level 3 is the default and Level 4 is temporary. Allow individual adjustments. Separate view, edit, download/export, approval and administration rights; users cannot elevate themselves or grant beyond their authority.
- Register through the company QR code: globally unique username, password entered twice and mobile number clearly labelled for WeCom. QR codes must expire and be revocable.
- After registration, the user can immediately log in and use the system with the company’s default authorization and settings. Notify Chief Admin/User Admin/System Admin, whichever is applicable under the company settings. That administrator decides whether to change the user’s authorization, groups/departments/divisions or other settings, immediately or later; prior approval is not required.
- Chief Admin/User Admin manages company groups. Show which eFiles a group grants access to before adding members. Restrict external group members to the contacts approved for connection.
- List each user’s eFiles and roles: eFile User, eFile Admin and Approval User. Allow removal or replacement by an eligible user. Revoke departing users’ sessions/access immediately; retain their historical actions and reassign unfinished approvals.
- Temporary accounts require expiry and a responsible administrator. Require secure password reset and administrator multi-factor authentication; never display stored passwords.

## eFiles

- List accessible eFiles and items, with a “Created by me” filter. Each eFile belongs to one company; users only see records they are authorized to access.

**Creation/edit page:**

- Fill in eFile name.
- Select users/groups and their rights. Cross-company users must be within the permitted connection; sharing one eFile does not expose other eFiles.
- Select one or more eFile Admins. Keep an active administrator or Chief Admin/System Admin fallback.
- Select whether to display date and amount columns. If amounts are enabled, select a standard currency code; do not relabel existing amounts by changing currency.
- Select whether approval is required. Set ordered step names and eligible approvers; allow additional steps as needed. Workflow changes apply to future submissions, not existing approval history.
- Provide an edit page for name, members, administrators and settings. Hiding a column must not delete stored values.

**Create item page:**

- Fill in item name; give each item a unique system ID.
- Enter amount/date only if enabled. Keep an unentered amount blank; zero means an actual entered zero.
- Enable attachments with file-size/type limits and malware checks. Block unsafe files; protect both previews and downloads with access checks.
- Allow admin lock/unlock for drafts. Submitted items follow the approval-lock rules below.
- Recurring items by interval/date can be added later; each occurrence creates a new item without carrying over old approvals.

**Display of each item:**

- Show date, item name, amount with currency code/symbol, attachment icon and current approval-step number. Click the number to view the full process.
- Hide date/amount columns when no displayed items contain those values; zero counts as an amount.
- Default order: dated items newest first, then undated items by name ascending. If no dates exist, sort all by name; use item ID to break ties.
- Detect simultaneous edits to prevent overwriting changes. Access removal must also block old item and attachment links.

## Approval

- Approve step by step. Each step identifies the responsible approver. Only the active step can act; block duplicate decisions and self-approval by the item’s creator/submitter/editor.
- Automatically lock the submitted item and attachments. On completion of each step, notify the next approver; on final completion, notify all process participants.
- Allow Approve, Return for correction and Reject. Return/rejection requires a reason. Corrections create a new version and restart approval from step 1; preserve earlier versions and decisions.
- Allow the submitter to withdraw a pending submission with a reason. If an approver leaves or loses access, pause the process until an authorized administrator assigns an eligible replacement; never silently skip a step.
- Administrators cannot overwrite a submitted/approved version. WSP System Admin may reopen or override, but must record the reason and notify participants. Show an override separately from normal approval; never record it as another user’s decision.
- For eFiles without approval, show “No approval required”, not “Approved”. Archive completed records; do not silently delete submitted items or approval history.

## Notification system

- Create in-system notifications for registration, assigned approval steps, returns/rejections, completion, access changes and administrator overrides. Keep pending tasks visible even if delivery fails.
- Retry failed notifications without duplicate workflow actions. Restrict notification content and links to the recipient’s access. Reminders must not automatically approve or skip steps.
- WeCom/WeChat notification integration can be added later. Verify account binding before sending; a collected phone number alone does not establish a working connection.

## System stored on Alicloud

- Keep company data and attachments private, maintain backups, and log user/permission changes, edits, downloads, approvals and System Admin overrides. Preserve historical attribution when users are replaced or removed.

## Main loopholes addressed

- WSP staff inheriting ultimate access; user admins escalating privileges; cross-company search exposing files; unlocking invalidating approvals; former staff retaining access; unsafe attachments; blank amounts treated as zero; missing audit history.
