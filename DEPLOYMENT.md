# Deployment Notes

Checked on: 2026-03-16

## Best Fit For This Repository

This repository is a Python FastAPI gateway with a Dockerfile. That means:

- It fits container platforms well
- It does not fit Cloudflare Pages + Workers as a direct drop-in deployment target
- If you want Cloudflare, use it as a lightweight edge layer in front of this service, not as a direct replacement for this service

## Recommended Deployment Order For This Repository

1. Render
2. Koyeb
3. Google Cloud Run

## Why Cloudflare Is Not The Direct Target Here

Cloudflare Pages + Workers is a strong choice for lightweight JavaScript or TypeScript edge relays. This repository is a regular Python ASGI service and expects a normal server process plus Docker-style deployment.

The gateway now supports the standard platform `PORT` environment variable, which is required by container platforms such as Render, Koyeb, and Cloud Run.

## Platform Signup Requirements

### Cloudflare Pages + Workers

Status as of 2026-03-16:

- Best for lightweight edge proxy logic, not this full Python gateway
- Email signup is enough for basic use
- A custom domain is not required
- Default domains are available through `*.pages.dev` and `*.workers.dev`
- Cloudflare AI Gateway can be added under the same account and does not require a custom domain

Official links:

- https://developers.cloudflare.com/pages/functions/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/pages/configuration/custom-domains/
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
- https://developers.cloudflare.com/ai-gateway/get-started/

### Render

Status as of 2026-03-16:

- Good fit for this repository because it can run the included Dockerfile
- A custom domain is optional; platform domain is available
- I did not find an official statement in the reviewed docs that makes a payment card mandatory for the free path
- It is weaker than Cloudflare for pure edge relays, but better suited to this Python container

Official links:

- https://render.com/docs/free
- https://render.com/docs/web-services

### Koyeb

Status as of 2026-03-16:

- Good fit for this repository because it runs regular web services and supports default `*.koyeb.app` domains
- Official docs describe one free web service on the free tier
- Official pricing FAQ also states Starter access is tied to a valid payment method
- In practice, this is not the best answer if your goal is strictly "email only, no card"

Official links:

- https://www.koyeb.com/docs/reference/services
- https://www.koyeb.com/docs/reference/instances
- https://www.koyeb.com/docs/faqs/pricing

### Google Cloud Run

Status as of 2026-03-16:

- Technically strong fit for this repository
- Default `run.app` domain is available, so a custom domain is not required
- Google Free Tier documentation still ties this path to a billing account
- It is not an email-only signup path

Official links:

- https://cloud.google.com/run/pricing?hl=en
- https://docs.cloud.google.com/run/docs/triggering/websockets
- https://docs.cloud.google.com/free/docs/free-cloud-features

### Deno Deploy

Status as of 2026-03-16:

- Email signup can work for personal use and default `*.deno.dev` deployment exists
- This repository is not a direct fit because Deno Deploy is for Deno or JavaScript or TypeScript apps, not this Python FastAPI service
- Deno documentation notes that full organization free limits can involve card verification

Official links:

- https://deno.com/deploy/pricing
- https://docs.deno.com/deploy/reference/domains/
- https://docs.deno.com/deploy/changelog/

## Direct Answer To "Do I Need A Card Or Domain?"

If you are asking about the earlier first-tier edge platforms:

- Cloudflare Pages + Workers: email only is enough, no custom domain required
- Cloudflare AI Gateway: same account, no custom domain required
- Deno Deploy: usually email-first for personal use, but some free-limit verification paths can involve card validation
- Koyeb: treat it as likely needing payment-method validation if you want the smoothest path

If you are asking specifically about deploying this Python gateway:

- The cleanest "email first, no custom domain required" path is Render
- The cleaner technical fit with a default domain but possible payment-method friction is Koyeb
- The most robust container option is Cloud Run, but it needs billing setup

## Minimum Environment Variables

Set these on the platform:

- `PROXY_API_KEY`
- One of `REFRESH_TOKEN`, `KIRO_CREDS_FILE`, or `KIRO_CLI_DB_FILE`

Optional:

- `PROFILE_ARN`
- `KIRO_REGION`
- `VPN_PROXY_URL`
- `LOG_LEVEL`
- `DEBUG_MODE`

## Deployment Checklist

1. Push this repository to GitHub.
2. Pick a container platform.
3. Connect the repository or upload the Docker image.
4. Set environment variables.
5. Confirm the platform health check passes on `/health`.
6. Test `/v1/models` and a streaming chat request.
