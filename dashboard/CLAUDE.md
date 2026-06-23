# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A social media/news monitoring dashboard for **עמותת משפחות SMA ישראל** (SMA Israel Families Association). The UI is in Hebrew with RTL layout. The app fetches SMA-related news articles and presents them for editorial review (approve/edit/reject).

## Commands

```bash
npm run dev       # Start dev server (Vite HMR)
npm run build     # Production build
npm run lint      # ESLint
npm run preview   # Preview production build locally
```

No test runner is configured.

## Architecture

**Entry point:** `src/main.jsx` → `src/App.jsx`

**Routing:** React Router v6. Three routes: `/` (ניוזלטר), `/archive` (ארכיון), `/stats` (סטטיסטיקות).

**Data flow:** `src/mockData.js` exports `articlesData`. `App.jsx` holds articles in state and passes `onUpdate(id, changes)` down to each `NewsCard`.

**Components:**
- `DashboardLayout` — RTL shell (`dir="rtl"`) with a `--bg-secondary` sidebar and top header. Accepts `children`.
- `NewsCard` — Displays one article with Hebrew title, source, date, summary snippet, source link, approve/reject/edit actions. Clicking 'אשר' opens a publish modal where the user selects destinations (website / newsletter) before confirming. Contains an `EditModal` for inline editing.

**Styling:** Inline CSS-in-JS objects at the bottom of each component file. Global base styles in `src/index.css`. Light mode only (no dark mode). CSS variables:

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

## Key Context

- `mockData.js` is a temporary stand-in — eventually articles will come from a backend Processor service via API.
- Sidebar uses `<NavLink>` from React Router with active state styling.

## Data Shape

Articles come from `src/mockData.js`:

```js
{
  id: string,
  source: string,
  url: string,
  published_at: string,        // ISO date string
  status: string,              // scraper status — ignore in UI
  editorialStatus: 'pending' | 'approved' | 'rejected' | 'draft',
  destinations: {
    website: boolean,
    newsletter: boolean,
  },
  outputs: {
    title_he: string,          // Hebrew title — editable
    summary_he: string,        // Hebrew summary — editable
  }
}
```

The original English title is NOT shown anywhere in the UI.

## Current Task: Update Page Content Per Route

### ניוזלטר page (`/`)
- Filter tabs: **ממתינות לאישור** and **טיוטות** only
- Default active tab: **ממתינות לאישור**
- Each tab shows a count badge derived from the full articles array

### ארכיון page (`/archive`)
- Same tab bar style as ניוזלטר
- Two tabs: **אושרו** and **נדחו**
- Default active tab: **אושרו**
- Each tab shows a count badge
- Uses the same `NewsCard` component
- If a tab is empty: show "אין כתבות להציג" centered

### סטטיסטיקות page (`/stats`)
- Simple summary cards in a grid:
  - ממתינים לאישור — count of `pending`
  - טיוטות — count of `draft`
  - אושרו — count of `approved`
  - נדחו — count of `rejected`
- Each card: large number, label below, `var(--accent-bg)` background, `var(--accent)` border, `border-radius: 12px`, `padding: 24px`
- Grid: 2 columns on mobile, 4 columns on desktop

### State
- `articles` state stays in `App.jsx` and is passed to all pages via React Router or shared context