# Spine Scale — Internal Ops CRM

Single-user internal tool for running the Spine Scale agency: sales pipeline,
signed clients with delivery checklists, weekly KPI reporting, and a reference
library. Runs locally against a SQLite file — no external services.

## Run it locally

```bash
cp .env.example .env   # then edit APP_PASSWORD in .env
npm install
npm run dev
```

Open http://localhost:3000. `npm run dev` applies the database
migrations automatically, so the SQLite file (`prisma/dev.db`) is created with
the correct schema and zero rows on first run.

## Setting / changing the login password

The app is protected by a single password read from the `APP_PASSWORD`
environment variable, set in `.env` (created by copying `.env.example`;
the real `.env` is gitignored and never committed):

```
APP_PASSWORD="your-password-here"
```

Change the value and restart the dev server. Changing the password also
invalidates any existing browser session (the session cookie is derived from
the password), so you'll be asked to sign in again.

## Where the data lives

Everything is stored in `prisma/dev.db` (gitignored). Back it up by copying
that one file. To start over from scratch, delete it and run `npm run dev`
again.

## Sections

- **Dashboard** — four KPI cards (active clients, MRR, open pipeline value,
  follow-ups due in 7 days), then two panels side by side and three cards
  below.

  **Now** carries **Today's focus**: one merged list of everything that wants
  doing today, drawn from four places and ordered by urgency — calls scheduled
  for today or already overdue (soonest first), then onboarding items that are
  holding up a launch or a kickoff, then follow-ups due or overdue, then any
  client that has just crossed into Needs attention or At risk, then the rest
  of the onboarding checklist. There is no item cap; once the list passes seven
  rows the routine (non-blocking) onboarding items fold behind a "show more"
  toggle, so everything time-bound or blocking stays on screen. Which checklist
  items block a launch is a per-item flag, seeded from the standard set and
  toggleable from the client record.

  **US business hours** is the four-zone strip: local time and an open /
  opening-soon / closed badge per zone, on 9–5 local Monday to Friday. It
  deliberately does not suggest a best time to prospect — nothing in the
  reporting data supports one yet.

  **Recent activity** is the milestone feed (below), **Client health** ranks
  the live clients worst-first with a sparkline of recent show rate, and
  **Pipeline snapshot** breaks open pipeline value down by stage as a donut.
  Because pipeline stages are a sequence rather than unrelated categories, the
  donut uses an ordered ramp derived from the brand palette — deep blue through
  the primary `#126DFB` to a tint of the secondary teal `#3FD1C8` — stepped by
  lightness so neighbouring segments stay apart, with every segment named and
  valued in the legend.

- **Activity feed** — an internal log of milestones, newest first, on the
  dashboard card and in full at `/activity`. Six events are logged and nothing
  else: a lead converted to a client, a weekly report generated (the first time
  that week is filed, not later corrections), a contract marked signed, an
  invoice marked paid, a health status change, and onboarding completed by
  reaching the end of the wizard. Routine field edits are deliberately not
  logged — a log of everything is a log of nothing.
- **Pipeline** — leads as a drag-and-drop Kanban board or a sortable/filterable
  table. Each lead has an append-only timestamped activity log and an **ICP
  scorecard**: five Layer 1 disqualifiers (any one stops the scoring), then
  four scored categories out of 10 — Staff Size Fit, Package/Economics, Budget
  Signal, and Automation Gap — banding the lead A-tier (8–10), B-tier (5–7) or
  C-tier (0–4). The tier shows as a badge on board cards and table rows. Only
  the raw answers are stored; the total and tier are derived in
  `src/lib/icp.ts`, so re-tuning the framework needs no migration. Marking a
  lead Won enables one-click **Convert to Client**, which pre-fills a client
  record (including the estimated deal value as the monthly fee), archives the
  lead, and opens the onboarding wizard.
- **Clients** — signed clinics with package/fee/contract details, GHL and Meta
  Ads reference links, an invoice log, and a per-client delivery checklist
  (seeded with the standard Disc Relief Pipeline OS items, fully editable per
  client). The segmented capsule bar shows delivery progress at a glance. Each
  client carries a **time zone** (one of the four US zones), shown as a live
  local-time badge on the client page and in the clients table.

- **Client health** — for **Active** clients the flat status badge is replaced
  by a health status with a trend arrow, in the clients table, on the client
  record and on the dashboard. Onboarding clients keep showing their percentage
  progress instead; paused and churned clients keep the plain status badge.

  Health is **derived on read** from the client's last three weekly reports
  (`src/lib/health.ts`) — like the ICP tier, nothing is stored that a
  recalculation could contradict, so re-tuning the rules needs no migration.
  The rules:

  - **Show rate is the core metric.** Nothing reads Healthy while show rate is
    under target. CPL never drives the status on its own — a cheap lead that
    never turns up is not a healthy account — and lead-to-booked is a secondary
    signal that can pull a clean week down to Needs attention but never to At
    risk by itself.
  - **Small numbers are read as counts, not percentages.** Below eight booked
    consults across the window a week is judged on how many shows it is short
    of target: one short is a dip, two or more is a miss. Below five booked
    consults the window is not judged at all.
  - **Four states.** *Healthy*, *Needs attention* (a soft dip — look at the
    account, no client conversation implied), *At risk* (the core metric missed
    in two or more weeks, or an operational break — reach out proactively) and
    *Ramping* (fewer than two full reporting weeks since going Active, or too
    little booked volume to score). Ramping is a distinct neutral badge: it
    never defaults to green or red.
  - **`healthOverride`** on the client record forces At risk whatever the
    metrics say, for an operational break the numbers have not caught up with
    — ad account down, tracking dead, access revoked. Set it from **Health
    override** on the client page; clearing it hands the status back to the
    computation.

  A health change is written to the activity feed, and a client that has just
  crossed into Needs attention or At risk surfaces in Today's focus for a week.
- **Onboarding wizard** — a five-step step-through that runs after a lead is
  converted: confirm details and time zone, contract status plus a link to the
  signed document, an invoice log with a running total collected, the kickoff
  call, and handoff to the delivery checklist. The current step is stored on
  the client (`onboardingStep`), so leaving mid-way and coming back picks up
  where you left off — from the client record, the clients table, or the
  wizard URL. **Skip onboarding wizard** is available on every step and jumps
  straight to the normal client page, and the wizard can be re-run later from
  the client record.

  The wizard hands off to Google rather than integrating with it: the contract
  and invoice steps open a pre-filled **Gmail compose** window (editable
  subject and body, you send it), and the kickoff step opens a pre-filled
  **Google Calendar** event. The kickoff step shows the chosen time in your
  zone and the client's side by side. Google Calendar only creates a Meet link
  through its own interface, so the event draft carries a reminder to click
  "Add Google Meet" rather than pretending the link can do it.
- **Calls** — a log of scheduled and held calls, on both lead and client
  records. Each call has a date and time, a type (Check-in, Discovery, Kickoff,
  Other), a status (Scheduled, Completed, No-show, Cancelled) and notes, and
  belongs to exactly one lead or one client. The record's Calls section splits
  them into what is still on the books and what has been closed out; the
  dashboard's **Calls due** list rolls up everything still marked Scheduled in
  the next 7 days across leads and clients. A scheduled call whose time has
  passed is flagged overdue in red, the same as an overdue follow-up.

  This is deliberately separate from a lead's **next follow-up** date: that
  stays the single date the pipeline sorts and reminds on, and the call log
  sits alongside it. Times are stored as instants and shown in your own zone.
- **Reporting** — one entry per client per week. CPL, lead-to-booked rate, and
  show rate are calculated automatically and flagged green/yellow/red against
  targets (CPL $10–35, lead→booked 20–40%, show rate 50–70%). Per-client trend
  charts and full weekly history. The same target bands feed client health, so
  the two never disagree about what "on target" means.
- **Ad Hub** — where ad concepts get built, in the order the framework works:
  research → persona → desire → benefit → concept → creative → compliance →
  launch → performance. Nothing in it is generated; every field is typed in by
  hand, and there is no ad-platform integration anywhere — performance numbers
  are entered manually.

  - **Browse** is the section's home: an accordion of personas, each expanding
    to its concepts, each concept expanding to its creatives, with a status
    badge at every level (a persona has no status of its own, so it shows the
    strongest state among its concepts). Any row navigates to that record.
  - **Concepts** are the strategic unit — persona + desire + benefit +
    positioning. Positioning is an **awareness level** (Unaware → Most Aware)
    and a **market sophistication stage** (1–5), each carrying the framework's
    strategy guidance as helper text at the point of choosing, the same way the
    ICP scorecard spells out what each score means.
  - **Desires are shared, not owned.** A want statement lives on its own and is
    reused across personas and concepts; benefits hang off the desire they
    answer. Both are managed on **Desires & benefits**, and a desire or benefit
    a concept is built on cannot be deleted out from under it.
  - **The new-concept wizard** is five steps — pick or create a persona, then a
    desire, then a benefit, then positioning, then name it and set a batch
    number. Unlike the onboarding wizard nothing is written until the last
    step, so abandoning it half way leaves no orphaned personas or desires
    behind. **The new-creative wizard** is four — type, hook plus ad headline
    (with the 40–50 character guideline and a live count), ad copy, CTA — and
    creates the creative in Draft with its compliance checklist seeded.
  - **The compliance gate is mandatory.** Every creative carries the five fixed
    pre-launch checks, and **Ready** is unavailable in the status dropdown until
    all five are ticked — enforced in the server action, not just hidden in the
    UI. Unticking one later drops a Ready creative back to Compliance review
    rather than leaving it claiming a check that no longer holds.
  - **Iterating beats killing.** *Duplicate as variation* creates a new
    creative under the same concept, pre-filled with the same copy, linked to
    its parent through `parentCreativeId` and reset to Draft with a fresh,
    unchecked compliance list — the check has to be about this creative, not
    the one it came from.
  - **Research notes** is a filterable list of freeform notes typed Internal /
    External / Mechanism / Desire — the same shape as the Library, but its own
    thing inside Ad Hub rather than another Library category.
- **Library** — markdown notes in five fixed categories. Starts empty by
  design; it fills up with real material as you write it.

## Deploying to Vercel + hosted Postgres (later)

The app is built so the move is a datasource swap, not a rewrite:

1. **Create a Postgres database** at [Neon](https://neon.tech) or
   [Supabase](https://supabase.com) and copy its connection string.
2. **Switch the Prisma datasource** in `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
3. **Regenerate migrations for Postgres.** The existing migrations in
   `prisma/migrations/` were generated for SQLite; delete that folder and run
   `npx prisma migrate dev --name init` once with `DATABASE_URL` pointing at
   the new Postgres database (a branch/dev database on Neon works well).
4. **Push the repo to GitHub** and import it into Vercel.
5. **Set environment variables** in the Vercel project settings:
   - `DATABASE_URL` — the Postgres connection string
   - `APP_PASSWORD` — your login password
6. **Deploy.** The build script already runs `prisma migrate deploy` before
   `next build`, so the schema is applied on deploy. (Prisma Client generation
   runs via the `postinstall` hook.)

Note: keep using SQLite locally or point local `.env` at the same Postgres —
either works, but they are separate databases; data doesn't sync between them.

## Stack

Next.js 14 (App Router) · TypeScript · Prisma + SQLite · Tailwind CSS ·
Recharts. Auth is a single password + HMAC session cookie — no accounts, no
roles, single-user by design.
