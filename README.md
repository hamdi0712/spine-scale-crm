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

- **Dashboard** — a live world-clock strip across the four US time zones,
  active client count, MRR, open pipeline value, follow-ups due in the next 7
  days, and any client whose latest reported week has a red-flagged KPI.
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
- **Reporting** — one entry per client per week. CPL, lead-to-booked rate, and
  show rate are calculated automatically and flagged green/yellow/red against
  targets (CPL $10–35, lead→booked 20–40%, show rate 50–70%). Per-client trend
  charts and full weekly history.
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
