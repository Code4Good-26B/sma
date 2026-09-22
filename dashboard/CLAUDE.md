# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The Dashboard for **עמותת משפחות SMA ישראל** (SMA Israel Families Association) — the screen Michal, the association's director, uses to review Hebrew article summaries produced by the Processor and decide what gets published. The UI is in Hebrew with RTL layout.

**This app has never been run against the real database by anyone.** Treat anything not explicitly described here as unverified.

## Commands

```bash
npm run dev       # Start dev server (Vite HMR)
npm run build     # Production build
npm run lint      # ESLint
npm run preview   # Preview production build locally
```

No test runner is configured.

## Data flow

`src/App.jsx` fetches all rows from Supabase once on mount:

```js
supabase.from('content_items').select('*').order('published_at', { ascending: false })
```

and holds them in `articles` state, which it passes down to each page (`FeedPage`, `ArchivePage`, `StatsPage`) as a prop. `SettingsPage` does not receive `articles` — its one setting (`skipRejectConfirm`) lives in `localStorage`, not the database.

Writes go the other way: a page or `NewsCard` calls `onUpdate(id, changes)`, defined in `App.jsx`. `onUpdate` applies `changes` to local state immediately (optimistic update), then sends the same `changes` as a Supabase `.update(...).eq('id', id).select()`. If that call errors, or returns zero rows, `onUpdate` rolls the local state back to what it was before the optimistic update and shows a "השמירה נכשלה" (save failed) toast.

There is no polling and no realtime subscription — the fetch in `App.jsx` runs exactly once, on mount. Two browser tabs open on the dashboard at once will not see each other's changes until reloaded.

## Real column names

The database is Postgres, accessed here through the Supabase JS client with the anon key. `docs/db_contract.md` (in the repo root) is the authority on what each column means and which component owns it — read that, not this file, for column semantics. It is not restated here because a second copy of the schema is a second thing that goes stale.

Columns this app actually reads or writes, as a quick reference for navigating the code (not as documentation of meaning):

- Read: `id`, `source_name`, `source_url`, `published_at`, `created_at`, `title_he`, `summary_he`, `reviewed_title_he`, `reviewed_summary_he`, `review_status`, `processing_status`, `publish_target`
- Written by `onUpdate` calls in `NewsCard.jsx`: `review_status`, `publish_target`, `reviewed_title_he`, `reviewed_summary_he`, `reviewed_by` (hardcoded to the string `'michal'`), `reviewed_at`

`review_status` values used in the UI: `not_reviewed`, `needs_edit`, `approved`, `irrelevant` (there is no `draft`/`pending`/`rejected` — those were names from an earlier mock data shape and do not exist in the schema).

## What this app does NOT yet do

So the next reader is not misled by omission:

- It never reads `newsletter_text_he` (the Pass 2 output) anywhere.
- It never reads `collector_runs` — there is no health/status indicator for the pipeline in this UI.
- It never writes `newsletter_batch_id`, `published_to_website_at`, or `published_to_newsletter_at`. The "פירסום" (publish) button only sets `review_status = 'approved'` and `publish_target`; it does not generate a newsletter file or mark anything as actually sent/copied.
- Approving an item does not check whether `newsletter_text_he` exists yet — an item can be marked `approved` before Pass 2 has produced anything for it.

## Routes

Four routes, all wrapped in `DashboardLayout` (`src/App.jsx`):

- `/` — `FeedPage`. Tabs: `not_reviewed` ("ידיעות הממתינות לאישור") and `needs_edit` ("טיוטות"). Has a search box and a "hide items still processing" checkbox (filters on `processing_status !== 'done'`).
- `/archive` — `ArchivePage`. Tabs: `approved` ("אושרו") and `irrelevant` ("נדחו"). Same search box, same `NewsCard`.
- `/stats` — `StatsPage`. Read-only KPI cards and breakdowns computed client-side from the full `articles` array (counts by `review_status`, by `source_name`, a 6-month trend by `created_at`, channel split by `publish_target`).
- `/settings` — `SettingsPage`. One toggle (skip the reject confirmation dialog), stored in `localStorage` only — nothing here touches Supabase.

## Components

- `DashboardLayout` — RTL shell (`dir="rtl"`) with a sidebar (logo + nav) and header. Accepts `children`.
- `NewsCard` (`src/components/NewsCards.jsx`) — displays one article, showing `reviewed_title_he ?? title_he` and `reviewed_summary_he ?? summary_he` (the reviewed/edited version wins once it exists). Contains three modals: edit (save as draft or approve from there), approve (choose `website`/`newsletter`/`both` before confirming), and reject (with an optional "don't ask again" checkbox backed by the same `localStorage` key `SettingsPage` writes).

## Styling

Inline CSS-in-JS objects at the bottom of each component file. Global base styles in `src/index.css`. Light mode only (no dark mode). CSS variables:

```css
--text: #3a3a3a
--text-h: #1a1a1a
--bg: #ffffff
--bg-secondary: #f7f5f2
--border: #e8e4e0
--accent: #e8614a          /* coral red — primary actions */
--accent-bg: rgba(232, 97, 74, 0.08)
--accent-border: rgba(232, 97, 74, 0.3)
--secondary: #4abfb0       /* teal — secondary accents */
--secondary-bg: rgba(74, 191, 176, 0.08)
--shadow: rgba(0,0,0,0.06) 0 4px 12px -2px, rgba(0,0,0,0.04) 0 2px 4px -1px
```

## Environment

`src/supabaseClient.js` reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `import.meta.env` (Vite bundles any `VITE_`-prefixed variable into the built JavaScript, so these are public once deployed — this must always be the anon/publishable key, never the service_role key). See `dashboard/.env.example`.
