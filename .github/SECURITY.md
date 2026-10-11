# Security and production readiness

This repository keeps the app safe-by-default and prepared for GitHub-based deployment controls.

## Required GitHub configuration

Set these as repository or environment secrets in GitHub:

- `APP_ENV`
- `DATABASE_URL`
- `JWT_SECRET`

For production, add the values under the `production` environment in the GitHub repository settings and require approval before deployment.

## Local rule

Never commit `.env` files. Keep all real secrets in GitHub Secrets or the target deployment platform's secret manager.

## Runtime controls to add before production launch

- restrict CORS to trusted origins
- disable Swagger/OpenAPI in production unless explicitly needed
- add authentication and authorization on sensitive routes
- add rate limiting and security headers
- use a managed PostgreSQL instance instead of a local development database
- place the app behind a trusted ingress or reverse proxy
