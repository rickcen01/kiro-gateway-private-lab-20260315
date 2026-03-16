# Cloudflare Worker Support

This directory contains a minimal Worker-native version of the gateway.

Supported routes:

- `GET /`
- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/messages`

Current scope:

- Uses `KIRO_REFRESH_TOKEN`
- Supports OpenAI-compatible streaming
- Supports basic Anthropic compatibility
- Supports CORS
- Supports basic tool definitions and tool-call pass-through

Not included in this first Worker version:

- `KIRO_CREDS_FILE`
- `KIRO_CLI_DB_FILE`
- Durable refresh-token persistence
- Full Python feature parity

Required secrets:

- `PROXY_API_KEY`
- `KIRO_REFRESH_TOKEN`

Optional:

- `KIRO_PROFILE_ARN`
- `KIRO_REGION`
- `CORS_ORIGIN`
