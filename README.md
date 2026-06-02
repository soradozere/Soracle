# Soracle — JK2 CTF Team Balancer

A team balancer for **Jedi Knight II: Jedi Outcast** 6v6 Capture the Flag. Drop in your roster, pick 12 players, and Soracle evaluates every possible split to find the fairest teams — accounting not just for raw skill but for role coverage, skill distribution, and how the top players are spread.

## What it does

- **Smart balancing** — checks all 924 possible team splits for 12 players and scores each one with a penalty function (lower is better). Beyond matching total tier, it balances top-3 and bottom-3 strength, tier variance, per-role strength, and prevents stacking elite players or clustering the top player with too many strong teammates.
- **Role coverage** — JK2 CTF needs more than even skill. Each team is checked for viable coverage in the five roles: **Capper**, **Chase**, **Camp**, **Cleaner**, and **Support**. A team missing a Capper or Chaser is penalised heavily.
- **Multiple options** — returns up to three distinct lineups (e.g. "Perfect Balance", "Fair Fight", "Slight Edge") plus a suggested single-swap to tighten the tier gap, and a balance-confidence percentage per option.
- **Competitive mode** — queue 12–18 players and Soracle picks the best 12 to balance, cutting the rest.
- **Off-role mode** — balance on overall tier only, ignoring role ratings.
- **Match history & reports** — log results, track player win rates, monthly reports, tier changelogs, and whether higher-confidence balances actually produce closer games.
- **Roster management** — admin tools for players, CSV import, tier snapshots, and active/inactive tracking.
- **Themes** — Jedi, Sith, Bespin, Yavin, and Nar Shaddaa.

## How balancing works

Tier values measure overall strength; role ratings measure team composition. Two evenly-totalled teams can still blow out if one side has all the top players or can't field a flag carrier — so the algorithm weighs both. Each candidate split accumulates penalties for tier difference, missing critical roles, uneven role strength, lopsided top-3/bottom-3, elite stacking, top-player clustering, and mic imbalance, then the lowest-penalty split wins. See the **How It Works** tab in the app for the full breakdown, or `lib/balance-algorithm.ts` for the implementation.

## Tech stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19
- [Supabase](https://supabase.com) (Postgres + auth) for players, matches, and tier snapshots
- Tailwind CSS v4 + Radix UI primitives
- Recharts for reports, Vercel Analytics

## Getting started

Install dependencies (this project uses pnpm):

```bash
pnpm install
```

Create a `.env.local` with your Supabase credentials:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Server-side only (admin actions, scripts)
SUPABASE_URL=your-project-url
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Set up the database by running the SQL in `scripts/` against your Supabase project, in order:

```
001_create_players_table.sql
002_create_matches_table.sql
003_add_inactive_player_columns.sql
004_add_tier_snapshots.sql
```

Then run the dev server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

To seed players from a CSV, see `scripts/import-players-from-csv.ts`.

## Project structure

```
app/          Next.js routes (balancer UI, admin, auth)
components/   React components (balancer, match log, reports, ui/)
lib/          balance-algorithm.ts, types, Supabase clients, themes
scripts/      SQL migrations + CSV import
```

## Built with v0

This repository is linked to a [v0](https://v0.app) project. Start new chats there to make changes and v0 will push commits directly to this repo; every merge to `main` auto-deploys.

[Continue working on v0 →](https://v0.app/chat/projects/prj_Fz2lqgfSFDXuHz0weFu60sTZfXfA)
