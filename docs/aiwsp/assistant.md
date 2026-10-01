# AiWSP Assistant — connecting your agent

The **AiWSP Assistant** is the chat in the left menu. Clients ask questions there. Your agent answers, and WSP professionals can review, take over and reply. This page is for whoever builds and connects the agent.

## What is already built

**For clients** (any user of a client company):
- conversations with suggested first questions
- answers that appear as they are written
- sources shown under an answer
- 👍/👎 on each answer
- **Talk to a WSP professional**
- close and reopen a conversation

**For WSP professionals** (Client Conversations):
- an inbox with filters: Needs attention, To review, Waiting for WSP, Mine, Open, Closed
- **Approve / Edit / Discard** for answers held for review
- **Take over**: the assistant stops answering, and you reply as WSP
- **Hand back** to the assistant
- **Internal notes**: never shown to the client, never sent to the agent
- **Retry**: ask the agent the latest question again
- **Create item** on any client message: pick an eFile (the client's own first), name, target date and responsible person. The message becomes the item's first comment, the item and conversation link to each other, and an internal note records it. The client is not told.
- a **My clients** filter for the clients whose service team you are on

**Safeguards:**
- **Who sees conversations:**
  - A client sees only their own conversations.
  - WSP staff need the *Client conversations* function (Levels 1–2 by default), and see a company's conversations only if they are designated on a confirmed connection with that company (Account → Connection), or are on the service team of WSP's client record for that company (IMS → Client Management). The service team is notified first.
  - System Admins see all conversations and manage the settings.
- **Review:** the "review every answer" switch (Settings), or `AGENT_REVIEW_BELOW` to hold only low-confidence answers. While an answer is held, the client sees "An answer is being prepared and checked by a WSP professional."
- **Failures:** if the agent fails or times out (`AGENT_TIMEOUT_MS`, default 60 s), the client is told a professional will follow up. The conversation then moves to *Waiting for WSP* and staff are notified.
- **Records:** every conversation is stored in the database. Starts, takeovers, reviews and setting changes are in the System Log (module 客户咨询).
- **Rate limit:** 15 client messages per minute per user.

## Two ways to plug in the agent

### 1. As a web service (recommended)
Set these environment variables on the IMS server:

| Variable | Meaning |
|---|---|
| `AGENT_URL` | Where IMS POSTs each question, e.g. `https://agent.internal.example/answer` |
| `AGENT_TOKEN` | Optional; sent as `Authorization: Bearer <token>` |
| `AGENT_TIMEOUT_MS` | Optional, default `60000` |
| `AGENT_REVIEW_BELOW` | Optional, e.g. `0.7`; answers with a lower `confidence` wait for review |

**Request (JSON, POST):**
```json
{
  "conversation": {"id": "…", "title": "What documents do you need this month?"},
  "client": {"id": "…", "name": "Staff A", "company": "Demo Client", "company_id": "…"},
  "context": {
    "client_record": {"code": "DEMO01", "name": "Demo Client", "service_team": ["WSP Professional"]},
    "open_items": [
      {"efile": "Demo Client - Annual Filing 2026", "name": "Prepare draft return", "status": "No approval required", "target_date": "2026-10-02", "overdue": false, "responsible": "wsp-staff", "step": ""}
    ]
  },
  "messages": [
    {"role": "client", "content": "What documents do you need this month?", "author": "Staff A", "at": "2026-09-30T02:15:00Z"},
    {"role": "agent",  "content": "…", "author": "", "at": "…"},
    {"role": "staff",  "content": "…", "author": "WSP Professional", "at": "…"}
  ],
  "question": "the client's latest message"
}
```
`messages` holds only what the client has seen: no internal notes, no drafts still under review, and no discarded drafts.

`context` is what the agent may tell this client about their work, so it can answer "what is the status of…" questions:
- `client_record`: WSP's client record linked to the client's company (IMS → Client Management), with the people serving them; `null` if none is linked.
- `open_items`: up to 80 open items (not completed, approved, rejected or archived), earliest target date first, from
  - eFiles the client user takes part in, and
  - WSP eFiles for this client whose administrator ticked **Share item status with the client** in eFile Setup.

  Only names, status (with the current approval step), target date, overdue flag and responsible person are sent. Amounts, attachments and comments never are. WSP's internal eFiles stay private unless they are shared this way.

**Reply, option A: one JSON response**
```json
{"reply": "text shown to the client", "handoff": false, "sources": [{"title": "Monthly checklist", "url": "https://…"}], "confidence": 0.92}
```
- Only `reply` is required.
- `handoff: true` brings in a professional (the reply is still shown).
- Replies may use blank lines for paragraphs, `- ` bullet lines, `**bold**` and plain links.

**Reply, option B: streaming** (`Content-Type: text/event-stream`)
```
data: {"delta":"For the monthly "}
data: {"delta":"bookkeeping we need…"}
data: {"done":true,"handoff":false,"sources":[…],"confidence":0.9}
```
The client sees the text as it arrives (unless review is on). IMS sends `Accept: text/event-stream, application/json`, so the agent may answer either way.

### 2. Inside the IMS server
Replace the body of `answer()` in [`server/agent.ts`](../../server/agent.ts) with your own code. It receives the same request, can call `onDelta(textSoFar)` while streaming, and returns the same reply object. The rest of the app does not need to change.

## Try it without your agent

```sh
npm run build
node scripts/example-agent.mjs &   # a stand-in that answers a few FAQ questions
AGENT_URL=http://127.0.0.1:3100/agent npm run demo
```

`npm run demo` starts the example agent by itself. Sign in as **client-staff**, open **AiWSP Assistant** and ask "What documents do you need?". Then sign in as **wsp-staff** to see the Client Conversations inbox.

## Advice for the agent itself

- **Professional behaviour:** the settings page holds the assistant's name, welcome message and disclaimer. The tone and scope of answers are up to your agent. Start with review switched on, so a professional approves every answer, and relax it once you trust the answers.
- **Context:** the request tells you who is asking and from which company. If the agent needs the client's eFiles, give it its own read-only access and keep to the same rule as the rest of AiWSP: answer only from records that client is allowed to see.
- **Hosting in mainland China:** if the agent calls a model hosted outside China, calls from a mainland server may be slow or blocked. Host the agent where it can reach its model, and let IMS reach the agent over HTTPS with `AGENT_TOKEN` set. Or use a model available in China.
- **Keep answers traceable:** return `sources`, and `confidence` if you have it. Staff see the confidence, and `AGENT_REVIEW_BELOW` can hold weak answers for review.
