# SectorCoach

SectorCoach is a performance management platform for athletes, coaches, and club admins.

It is designed to bring training plans, test weeks, athlete monitoring, reporting, and team operations into one shared system.

## What SectorCoach Does

SectorCoach supports three connected product experiences:

- **Athletes** can view plans, submit wellness and test data, and track progress.
- **Coaches** can manage teams, build programs, monitor athlete state, and review performance signals.
- **Club Admins** can manage people, teams, approvals, reporting, and operating workflows across the club.

## Core Product Areas

- Training plan creation
- Test week setup and review
- Athlete readiness and monitoring
- Team and roster management
- Reporting and operational oversight

## Product Status

This repository currently uses mock data and mock auth flows to support product design, UX iteration, and feature development.

That includes:

- mock role-based login
- mock athlete, team, PR, and wellness data
- mock training plan and test week flows
- mock club-admin approval and invite workflows

## Tech Stack

- React 19
- Vite
- TypeScript
- React Router
- Tailwind CSS 4
- Radix UI
- MUI X Charts
- Playwright

## Local Development

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run start
```

## Quality Checks

```bash
npm run lint
npm run typecheck
npm test
npm run a11y:scan
npm run test:e2e
npm run qa
```

## Project Structure

- `src/app` route-level pages
- `src/components` feature and shared UI components
- `src/lib` mock data, auth helpers, and shared utilities
- `tests` automated tests
- `tools` support scripts
- `public` static assets

## Notes

- SectorCoach was migrated from Next.js to React + Vite.
- The current app is SPA-based.
- Local planning and status markdown files are intentionally excluded from git.
