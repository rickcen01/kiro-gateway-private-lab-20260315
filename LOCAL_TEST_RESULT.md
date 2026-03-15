# Local Test Result

Date: 2026-03-15

## Project

- Repo: `jwadow/kiro-gateway`
- Local path: `d:\Android\zhitucanvas1126\aiagenttop\kiro_proxy_lab\kiro-openai-gateway`

## Latest Credential File

- File: `~/.aws/sso/cache/kiro-auth-token.json`
- LastWriteTime: `2026-03-15 23:12:48`
- Auth method: `social`
- Provider: `Google`

## Local Setup

- Python venv available at `.venv`
- Dependencies installed from `requirements.txt`
- Local config available in `.env`
- Gateway uses `KIRO_CREDS_FILE="~/.aws/sso/cache/kiro-auth-token.json"`

## Smoke Test Result

- Direct upstream `ListAvailableModels`: passed
- Direct upstream `generateAssistantResponse`: passed
- Gateway `GET /health`: passed
- Gateway `GET /v1/models`: passed
- Gateway `POST /v1/chat/completions`: passed

## Observed Gateway Result

- Model count from `/v1/models`: `8`
- Test model: `claude-haiku-4.5`
- Returned content: `KIRO_OK`
- Finish reason: `stop`

## Run Again

```powershell
.\.venv\Scripts\python.exe -X utf8 main.py --host 127.0.0.1 --port 8018
```

Or use the auto-bootstrap launcher:

```powershell
.\run_local_auto.ps1
```
