# Spine Scale — Internal Ops CRM

Single-user internal tool for running the Spine Scale agency: automated lead
discovery, sales pipeline, signed clients with delivery checklists, weekly KPI
reporting, and a reference library. Runs locally against a SQLite file. It can
talk to two external services and only when pointed at them: Apify, for the
import and the enrichment run, and DeepSeek, for the scoring. Leave
`APIFY_API_TOKEN` and `DEEPSEEK_API_KEY` unset and nothing in the app calls out
anywhere.

The funnel is Discovery → Pipeline → Clients. Everything scraped lands in
Discovery, gets enriched and scored against the ICP framework there, and only
what scores 5 or more out of 10 becomes a lead.

## Run it locally

```bash
cp .env.example .env   # then edit APP_PASSWORD in .env
                       # APIFY_API_TOKEN is optional — only the Apify import
                       #   and the enrichment run need it
                       # DEEPSEEK_API_KEY is optional — only the discovery
                       #   queue's scoring and the lead scorecard's assist
                       #   need it
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

- **Calendar** — a month grid over dates that already live on other records:
  every call (scheduled or held, on leads and clients alike), every lead's next
  follow-up date, and every invoice due date. Nothing is created here — a date
  is set on the record it belongs to, and every row on the calendar links
  straight back to it.

  Cells stay deliberately quiet: the date, and a coloured dot per thing
  happening — brand blue `#126DFB` for calls, the secondary teal `#3FD1C8` for
  follow-ups, and violet `#7C3AED` for invoice due dates, explained by a legend
  under the grid. Violet is the third colour rather than amber or red because a
  due date arriving is not a warning; being *late* is, and that is what the
  overdue treatment says. A day with more kinds than dot slots always shows one
  of each colour present before it shows a second of anything, so a busy day
  cannot hide a whole category behind the "+n".

  Clicking a day opens the agenda beside the grid: the day's items in order,
  timed calls first (they are the ones that cannot move), then follow-ups, then
  invoices. Anything past its date and not closed out — a call still marked
  Scheduled, an unpaid invoice, a follow-up that has slipped — carries the same
  red and "Overdue" tag the rest of the app uses.

  A call is stored as an instant, so which day it falls on and whether it has
  slipped both depend on the viewer's zone; the server renders its own reading
  and the browser corrects it on mount, the same way every clock in the app
  does. Follow-up and due dates are date-only, so they read the same everywhere.
- **Activity feed** — an internal log of milestones, newest first, on the
  dashboard card and in full at `/activity`. Six events are logged and nothing
  else: a lead converted to a client, a weekly report generated (the first time
  that week is filed, not later corrections), a contract marked signed, an
  invoice marked paid, a health status change, and onboarding completed by
  reaching the end of the wizard. Routine field edits are deliberately not
  logged — a log of everything is a log of nothing.
- **Discovery** — the qualification step in front of the pipeline, and the rule
  it exists to enforce: *nothing reaches Pipeline unscored.* Every import lands
  here as a candidate, not a lead. A candidate becomes a lead by scoring 5 or
  more out of 10 on the ICP framework, and by nothing else.

  The list is the pipeline table's pattern pointed at candidates — search, a
  status filter, sortable columns, a checkbox per row and one in the header,
  and a bar that rides the top of the screen once anything is selected.
  Selection only ever covers rows currently on screen, so filtering something
  out of view takes it out of the selection too. The one bulk action is delete:
  promotion is what the queue decides, and the single override on it lives on
  the rejected list where the reasoning being overruled is on screen next to
  it.

  A candidate carries six statuses — **Pending**, **Enriching**, **Scored**,
  **Promoted**, **Rejected**, **Failed** — and its own page carries the whole
  record: the fields the chain runs on (editable), what the actors brought back
  (dated), and the reasoning behind whatever the queue decided (not editable).
  That split is the shape of the record. A candidate is evidence plus a
  judgement made from it, and the only honest way to change the judgement is to
  change the evidence and run the queue again.

  **Import candidates** bulk-adds prospects from a CSV export — built for Apify
  LinkedIn scrapes, but nothing in it is specific to one. The file is parsed in
  the browser, its real headers are listed, and each column is pointed at a
  candidate field by hand: no column name or order is ever assumed, because two
  actors scraping the same thing export different ones. The first five mapped
  rows are shown before anything is written. Imported candidates start
  **Pending** and are sourced **LinkedIn** unless the CSV maps a source column
  of its own, and a row whose clinic name and contact name already exist — as a
  candidate *or* as a lead — is skipped, so re-importing the same export
  creates nothing and nothing gets scored twice.

  A location column can be mapped to **Time zone (auto-detected from state)**.
  The US state is read out of whatever the column holds — "Austin, TX",
  "Portland, Oregon" — and the candidate gets that state's zone, with the text
  kept as the location for the enrichment run to search on. The eight states
  the zone line runs through take the zone most of their people live in, and a
  location with no state the lookup recognises — "Greater Boston Area",
  anything Canadian — imports with no zone at all rather than a guess. The
  preview says how many of those there are before anything is written.

  **Import from Apify** is the same import with a live source. Give it an actor
  or task ID and the actor's input as JSON, and the server calls Apify's
  `run-sync-get-dataset-items` — one request that starts the run, waits for it,
  and returns the dataset — then hands the items to the same mapping step. The
  dataset's JSON keys are the columns, nested objects flattened to dotted paths
  (`company.name`), the keys of every item pooled so a field only some records
  carry is still offered. From there it is identical to the CSV path: map,
  preview five rows, confirm, same duplicate check.

  **Process queue** is the whole qualification, run one candidate at a time. It
  picks up everything that has not reached a settled outcome — every Pending
  candidate, every Failed one from last time, and anything a closed tab left
  part-way through — oldest first.

  **It runs in the tab, in the foreground, while you watch it.** There is no
  job runner in this app and the dialog does not pretend otherwise: it says so
  before it starts anything, and pressing the button opens a plan rather than
  starting a run. Each candidate is four actor runs and a model call billed to
  live accounts, so a queue of forty is a real spend and the person pressing
  the button is the one who should decide to make it. Close the tab, navigate
  away, or sleep the machine and the queue stops after whatever candidate is in
  flight; everything it never reached is exactly as it was, and pressing it
  again picks up where it left off. *Stop after this one* does the same
  deliberately — the candidate in flight finishes on the server, because its
  actors are already running.

  Per candidate, in order:

  1. **Enrich** — the same four actors the lead page runs (*Enrich this lead*,
     below), from the same module, against this candidate's own fields. The one
     difference is what happens when the company lookup or the Maps search
     comes back with several possible clinics: on a lead that asks a human, and
     here it writes nothing and says so. There is nobody watching to pick which
     of three clinics this is, and picking the wrong one would put another
     clinic's review count on the record where it would read as a fact.
  2. **Score what can be computed.** Staff Size Fit reads the headcount onto
     the framework's own bands (3–15 = 2, 2 or 16–20 = 1, 1 or 20+ = 0). Budget
     Signal reads the ads signal and the review count: ads running now = 2,
     no ads but 25+ Google reviews = 1, neither = 0. No model is involved in
     either, so the same data scores the same way every time.
  3. **Ask DeepSeek for the rest** — the five hard disqualifiers (flagged only
     where the evidence states the thing plainly, each with the sentence it is
     read off), Package/Consult Economics 0–3 with a reason, and all three
     Automation Gap boxes. The gaps are **keyword pre-checked first**: a plain
     substring scan of the website notes looks for what a clinic says when it
     *has* online booking, a review-request pattern, or a lead magnet, and the
     model is shown what the scan found and asked to confirm or overturn it.
     Neither half is trusted alone — the scan cannot read context, and the
     model cannot be relied on to notice a booking widget it was not looking
     for. Both halves end up in the stored reason.
  4. **Combine** into a total out of 10 and a tier on the framework's own bands
     (8–10 A, 5–7 B, 0–4 C), and store the breakdown: every disqualifier, every
     category, every gap, each with its points, its one-line reason, and a chip
     saying whether that answer was computed or came from the model.
  5. **Disqualified** → Rejected, with the disqualifiers that fired named. The
     category scores are still computed and kept — *disqualified, and would
     have scored 8* is the shape of the one clinic somebody will want to look
     at again.
  6. **A-tier or B-tier (5+)** → a real **Lead** at stage New, with every
     matching field copied across (including the enrichment, so promotion does
     not re-run four actors to arrive at the same four values) and its ICP
     scorecard **pre-filled from the breakdown** — visible, editable, and not
     locked, with the full reasoning written into the card's own notes. The
     card is scored, so the lead carries its tier badge into the pipeline from
     the moment it lands. The candidate goes to Promoted and keeps a link to
     the lead it became.
  7. **C-tier, not disqualified** → Rejected, reason *Scored C-tier: 3/10*.

  **A candidate's score is stored, not derived.** This is the one place the app
  breaks its own rule that the framework owns the bands and everything else is
  computed on read. A lead's tier is derived from its stored answers, so
  re-tuning `src/lib/icp.ts` re-tiers every lead. A candidate's breakdown is
  the transcript of one automated run against the evidence it had that day,
  including what a model said and why — re-tuning the framework must not
  silently rewrite the reason a clinic was rejected last month. It should be
  re-run.

  **Failed** is its own outcome and a deliberate one. An actor that fails
  outright, a model call that is refused or answers in a shape that doesn't
  read as scores, or a candidate with no URL for any actor to work from, all
  stop that candidate before anything is scored — because scoring on half a
  run's evidence is exactly what this flow exists to prevent. The error is kept
  verbatim and shown on the record, whatever the actors *did* bring back is
  still stored (storing evidence is not scoring it, and throwing away three
  good results because a fourth failed makes the retry cost four runs where it
  needed one), and the next *Process queue* picks it up again from the top.

  **Rejected** is a filterable list of its own — all of them, or just the
  disqualified, or just the C-tier, highest score first because that is where a
  decision worth overruling would be. Each one shows its reasoning in full
  rather than a summary, because the only useful thing to do with that page is
  disagree with something on it, and a row reading *Rejected — C-tier* and
  nothing else would give nobody grounds to press **Promote anyway**. That
  override creates the lead exactly as a promotion would, with the scorecard
  this run produced — flags and all, still editable. It says "pursue this
  anyway", not "the evidence was different".

  `APIFY_API_TOKEN` lives in `.env` beside `APP_PASSWORD` and is read only in
  `src/lib/apify.ts`, which is server-side and sends it as a bearer header —
  never in a URL, never in a payload the browser sees. A missing token, a
  rejected one, an unknown actor, an input Apify won't accept, spent credits,
  and a run that overruns its two minutes each come back as their own sentence
  saying what to do about it. Leave the token unset and only the CSV import
  works; nothing else in the app changes.

- **Pipeline** — leads as a sortable/filterable table or a drag-and-drop Kanban
  board. **The table is what loads**: it is the view that answers the questions
  asked most often of a pipeline — who is where, what is scored, what is due —
  and it reads at forty rows as well as at four. The board is one press away on
  the toggle and is still where a stage gets changed by dragging.

  The table selects: a checkbox per row and one in the header, and with
  anything selected a bar rides the top of the screen offering a bulk stage
  change and a bulk delete (which names the count before it does it). Selection
  only ever covers rows currently on screen — filtering something out of view
  takes it out of the selection too — and it is state and nothing else, so
  navigating away or refreshing starts again with nothing selected.

  Nothing is bulk-added here. Leads arrive one of two ways: promoted out of
  **Discovery** with a score already on them, or typed in by hand with *New
  lead*.

  Each lead has an append-only timestamped activity log and an **ICP
  scorecard**: five Layer 1 disqualifiers (any one stops the scoring), then
  four scored categories out of 10 — Staff Size Fit, Package/Economics, Budget
  Signal, and Automation Gap — banding the lead A-tier (8–10), B-tier (5–7) or
  C-tier (0–4). The tier shows as a badge on board cards and table rows. Only
  the raw answers are stored; the total and tier are derived in
  `src/lib/icp.ts`, so re-tuning the framework needs no migration. A lead
  promoted out of Discovery arrives with that card already filled in from the
  scoring run — visible, editable, and not locked — and an enriched lead can
  have three of those answers suggested by a model at any time, pre-selected,
  reasoned, and saved by nobody but you (*Suggest remaining scores*, below).
  Marking a
  lead Won enables one-click **Convert to Client**, which pre-fills a client
  record (including the estimated deal value as the monthly fee), archives the
  lead, and opens the onboarding wizard.

  **Enrich this lead**, on a lead's own page, is one press that runs four named
  actors in turn — a LinkedIn company lookup, the Facebook ads library, a
  website crawl, and a Google Maps search — and writes what they say onto the
  lead already open. There is nothing to fill in: the actor IDs are fixed in
  `src/lib/leadEnrich.ts`, and each input is built from a field the lead
  already carries (Company LinkedIn URL, Facebook URL, Website URL, and the
  clinic name with its location). Those fields are edited on the lead like any
  other, and each actor's whole integration — its ID, the input its schema
  expects, the output fields it is read from — is one entry in that file.

  A missing input is a skip, not an error. A lead with no Facebook page still
  gets its website crawled, and the run reports *skipped Facebook Ads Library:
  no Facebook URL set* rather than failing the batch. One actor's failure is
  its own for the same reason: each of the four reports separately — written,
  skipped, failed, or ran and returned nothing readable — and the ones that
  worked still write.

  Because the four output shapes are known, there is no mapping step: staff
  count, Meta ads signal, review count and website notes are read out and
  written directly. The ads signal is built from the whole result rather than
  one item of it — the ad count and the earliest start date make *3 active ads,
  running 4mo*. The one thing the run will not decide for itself is identity:
  when the company lookup or the Maps search comes back with several candidate
  clinics, that actor's fields are left unwritten and the candidates are listed
  to choose from. Writing another clinic's review count onto this lead is the
  one mistake here that would look like a fact afterwards.

  The **website URL** is the one field the run both reads and writes. A record
  scraped off LinkedIn usually arrives without one, which would skip the crawl
  forever for want of a field two of the other actors already know — so the
  company lookup and the Maps search each report it, and it is filled from
  whichever answers first. The company lookup runs before the crawler, so a
  website found there is a website crawled by the same run. It is only ever
  *filled*, never overwritten: a URL somebody typed in is a decision, and an
  actor's idea of which site belongs to a clinic of this name is not a good
  enough reason to replace it. Anything that isn't an http(s) address with a
  real host is discarded rather than stored, because the value goes on to be
  requested.

  A scraped headcount is stored as `staffCountRaw`, deliberately alongside the
  scorecard's 0–2 Staff Size Fit band rather than instead of it. On a lead it
  **suggests** a band (3–15 = 2, 2 or 16–20 = 1, 1 or 20+ = 0), pre-selected
  and editable until the card is saved; in Discovery the queue scores that band
  outright, because the whole point of the queue is that it decides.

  What it writes is shown apart from the editable details, because it is a
  different kind of fact: a reading taken on a day, not a field somebody keeps
  current. *Enriched 2d ago* under the clinic name is the headline, because it
  is the one thing that says what the rest is worth today. The review count
  keeps its own date alongside it, since a run where the Maps actor was skipped
  or failed leaves that number older than the run above it. Nothing here
  refreshes itself.

  **Suggest remaining scores**, on the lead's ICP scorecard, is the one place
  a model is asked anything. It sends what the enrichment run gathered —
  website notes, the Meta ads signal, the review count — to DeepSeek
  (`deepseek-v4-flash`) along with the framework's own text, and asks for three
  things: a Package/Consult Economics score with a one-sentence reason, the two
  Automation Gap boxes the evidence can speak to (booking widget, review
  pattern) with the same, and two or three sentences on overall fit. The button
  is disabled until the lead has been enriched, because without that there is
  nothing to read and a model asked anyway would write three confident
  sentences about nothing.

  **It suggests; it never scores.** What comes back is pre-selected on the card
  with its reasoning printed beside it, in the same brand-tinted note the
  staff-count suggestion uses, and stored by nothing until somebody presses *Save
  scorecard* — the server action makes no write at all. A suggestion that
  landed on top of an answer already there says so (*it replaced the 1 pt you
  had*), so nothing changes quietly. The reasoning is shown because a score
  with no reason is not reviewable, which would make the review the button
  insists on into a formality.

  Three things are deliberately out of its reach. The third Automation Gap box
  — follow-up/remarketing evidence — is judged on a retargeting pixel and
  recurring ad creative, neither of which the enrichment run brings back, so it
  is never suggested. A disqualified lead switches the whole scoring section
  off, the assist with it. And an answer the evidence cannot support comes back
  as null and leaves that category exactly as it was, because the prompt asks
  for null rather than a guess.

  `DEEPSEEK_API_KEY` lives in `.env` beside the other two and is read only in
  `src/lib/deepseek.ts`, which is server-side and sends it as a bearer header. A
  missing key, a rejected one, a key without access to the model, spent credit,
  a rate limit, a request that times out, an answer that arrives cut off, and
  an answer that isn't in a shape that reads as scores each come back as their
  own sentence in a red note on the card, with the card left exactly as it was.
  Leave the key unset and the lead scorecard is scored by hand, and the
  discovery queue fails every candidate at step 3 rather than scoring one on
  half a framework.

  Leads carry the **LinkedIn URLs** they were imported with through to where
  outreach happens: *View LinkedIn profile* and *View company page* on the lead record,
  and a small LinkedIn glyph on each pipeline table row that has one (the
  contact's profile, or the company page when that is all there is). They open
  LinkedIn in a new tab and nothing else — this is a launchpad for outreach
  done by hand, not automated outreach.

  What the app does keep is a record that the outreach happened. *Mark
  connection request sent* sits in that same row and stamps the moment it is
  pressed; from then on it reads *Connection sent 3d ago*, with an undo for the
  misclick. A green check beside the LinkedIn glyph carries it onto the
  pipeline table, so a list of forty rows says which of them have already been
  approached without forty pages being opened to find out. Nothing sends a
  request — this is a note that a person did, kept where it stops the same
  clinic being approached twice.
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
  signed document, an invoice log with a running total collected (each invoice
  takes an optional due date, which is what puts it on the calendar and what
  turns it red once it has passed unpaid), the kickoff
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
    and a **market sophistication stage** (1–5), each carrying the course's own
    strategy guidance as helper text at the point of choosing, the same way the
    ICP scorecard spells out what each score means. That copy is verbatim from
    the course and lives as plain constants in `src/lib/adhub.ts` — only the
    integer stage and the awareness key are stored, so re-wording the guidance
    is a text edit with no migration and no backfill.
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
