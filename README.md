# Morning Command Center

![Tests](https://github.com/Hoovidice/morning-command-center/actions/workflows/test.yml/badge.svg)

A personal command center that combines an AI-generated morning brief, a
multi-account budget and cash-flow manager, bill tracking, goal tracking
with streaks, and a planner-style daily/weekly/monthly review system —
built as a real multi-user web app with its own login accounts.

## Features

**Money**
- Multiple accounts and credit cards, with balances tracked over time
- Recurring bill tracking (due dates, paid/unpaid, which account paid it)
- Expense logging with smart autofill for repeated entries
- Paycheck breakdown across accounts and bills

**Goals & Planning**
- Daily/weekly/deadline goals with streak tracking
- YNAB-style dollar targets — assign leftover balance to a goal instead of
  letting it sit unlabeled
- An internal calendar with one-off and recurring tasks
- Weekly reviews, monthly "wheel of life" reflections, and daily
  morning/evening rituals with gratitude and affirmations

**AI**
- A Claude-generated morning brief: an honest read on your finances,
  today's priorities, anything urgent, and one real motivating line —
  regenerated on demand
- Insight callouts on the Budget and Goals tabs (spending pace, unassigned
  balance) that follow the same signals shown on the dashboard

**Dashboard**
- Animated balance count-up, a 14-day balance trend chart, and a
  spending-pace progress ring
- A "getting started" checklist that stays visible for a new account until
  it has at least one account, bill, and goal
- Push notifications for bills due soon, a weekly digest, and
  over-pace spending alerts

**Accounts**
- Real signup/login with bcrypt-hashed passwords and server-side sessions
- Every route requires auth and every query is scoped to the logged-in
  user — this isn't a single-user tool with a login screen bolted on

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Node.js + Express |
| Database | SQLite via better-sqlite3 |
| Auth | bcrypt + express-session (file-backed sessions) |
| AI | Claude API (Sonnet) |
| Frontend | Vanilla HTML/CSS/JS — no framework |
| Logging | winston (console + rotating file logs) |
| Tests | Jest + Supertest |
| CI | GitHub Actions |
| Containerization | Docker |

## Project structure

```
src/
  app.js              Builds the Express app (no .listen()) — imported directly by tests
  server.js            Entry point: requires app.js, starts background jobs, listens
  db.js                SQLite schema and connection
  auth.js               Password hashing, session helpers, requireAuth middleware
  logger.js             Winston logger (console + logs/*.log)
  routes/               One Express Router per feature area (auth, bills, goals, ...)
  lib/                  Shared logic used by more than one route or job
    insights.js          Balance trend + spending pace calculations
    notifications.js      Push notification background jobs
    backup.js             Scheduled database backups
    dateHelpers.js         Date parsing/formatting used across routes
public/
  index.html, app.js, style.css    The app itself
  login.html                        Sign up / log in screen
__tests__/              Jest test suites (run against a throwaway temp database)
.github/workflows/       CI: runs the test suite on every push and pull request
```

## Running it locally

```bash
npm install
cp .env.example .env   # then fill in the values (see below)
npm start
```

The app runs on `http://localhost:3000` by default.

### Environment variables

See `.env.example` for the full list. At minimum you need:
- `ANTHROPIC_API_KEY` — for the AI morning brief
- `SESSION_SECRET` — any long random string; without one, the app falls
  back to an insecure default and logs a warning

### Running with Docker

```bash
docker build -t mcc-app .
docker run -d --name mcc-app -p 3000:3000 -v "${PWD}:/app" -v /app/node_modules mcc-app
```

### Tests

```bash
npm test
```

24 tests across auth, bills, and goals, run against a throwaway SQLite
file so your real data is never touched. The same suite runs automatically
on every push and pull request via GitHub Actions.

## Why it's built this way

- **Modular routes, not one giant file.** The backend used to be a single
  ~1,200-line `server.js`. It's now split into one Router per feature area
  under `src/routes/`, so a change to how bills work can't accidentally
  break goals.
- **A configurable database path.** `src/db.js` reads `DB_PATH` from the
  environment, so the test suite points at a throwaway file instead of
  the real database — tests can never corrupt real data.
- **Per-user data isolation.** Every table has a `user_id` column and
  every route filters by the logged-in user's session — this was built
  from the start to support more than one person using the app, not
  retrofitted later.
- **Automated backups.** All tables are dumped to a timestamped JSON
  snapshot every 6 hours, with the last 14 kept.
