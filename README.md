# Taskly

A small task manager. The backend is Express 5 with Prisma and PostgreSQL, and the frontend is React 19 with Vite.

The repository also contains a PR Test Agent: when a pull request changes application code, an AI agent writes unit tests for it, and a GitHub workflow checks them before committing them. [SOLUTION.md](SOLUTION.md) explains how it works, and [SOLUTION_EXTENDED.md](SOLUTION_EXTENDED.md) covers a few extras.

## Getting started

You need Node.js 22.12 or newer and Docker.

```sh
cp .env.example .env
npm install    # at the repository root; enables the pre-push hook
```

The quickest way to run everything is Docker Compose:

```sh
docker compose up --build -d --wait
```

The app is then at http://localhost:8080 and the API docs at http://localhost:8000/docs. Stop it with `docker compose down`.

## Backend

Express, TypeScript and Prisma, tested with Vitest and Supertest. For local development, start only the database with Docker and run the API yourself:

```sh
docker compose up -d --wait postgres   # from the repository root
cd backend
npm ci
npm run dev                            # http://localhost:8000/docs
```

For a production build, run `npm run build` and then `npm start`.

The Prisma schema is in `backend/prisma/schema.prisma`, and the connection settings come from the root `.env`. `npm run db:validate` checks the schema, and `npm run db:studio` opens a database browser. The Prisma client is generated automatically on install and build; `npm run db:generate` regenerates it by hand. Generating the client doesn't change the database itself; migrations are handled separately.

Tests and checks:

```sh
npm run typecheck
npm test
npm run test:watch
npm run test:coverage    # report in backend/coverage/index.html
```

## Frontend

React, TypeScript and Vite, tested with Vitest and React Testing Library.

```sh
cd frontend
npm ci
npm run dev          # http://localhost:5173
npm run storybook    # http://localhost:6006
npm test
npm run test:coverage    # report in frontend/coverage/index.html
```

## PR Test Agent

[SOLUTION.md](SOLUTION.md) describes the agent, its skills, the workflow and how to turn it on. To try it end to end on a throwaway repository, follow [docs/pr-agent-demo](docs/pr-agent-demo/README.md).

The tooling behind the workflow lives in `scripts/pr-agent`, a small TypeScript package of its own that isn't part of either app's build. Node 22.18 or newer runs it directly. It has its own typecheck and tests:

```sh
cd scripts/pr-agent
npm ci
npm run typecheck
npm test
```

You can also run tests exactly the way the agent does, with credentials removed from the environment:

```sh
node scripts/pr-agent/pr-agent.ts test backend backend/tests/router.test.ts
node scripts/pr-agent/pr-agent.ts typecheck frontend
```
