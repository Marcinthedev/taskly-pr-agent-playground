# Security

## Reporting a problem

If you find a security issue, please don't open a public issue. Use GitHub's private vulnerability reporting instead (*Security → Report a vulnerability*), or contact the repository owner directly.

## Secrets

Never commit `.env` files; they're in `.gitignore` for that reason. The only secret this repository needs on GitHub is the model credential for the PR Test Agent: either `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`. Production credentials belong in the deployment platform's secret store, not in the repository.

## What's in place

The API sends standard security headers (via helmet) and rate-limits the task endpoints per client. It only accepts cross-origin requests from origins listed in `CORS_ORIGINS`; by default, it accepts none.

How the PR Test Agent is kept away from secrets and write access is described in the security section of [SOLUTION.md](../SOLUTION.md).

## Before going to production

- Add authentication. Every API route is currently open.
- Turn off the Swagger UI at `/docs`, or put it behind authentication.
- Use a managed PostgreSQL instance with backups instead of the local Docker database.
- Put the app behind a reverse proxy or ingress that terminates TLS.
