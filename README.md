# Reminder Management System

A reminder-centred notification platform.

## Stack
- **API**: Node.js 20 + Express 5 + Prisma
- **Worker**: Python 3.12 + APScheduler
- **Web**: React 18 + Vite + TanStack Query
- **Database**: PostgreSQL 16

## Quick start (development)

```bash
# 1. Clone and install
git clone <repo> rms && cd rms
cp .env.example .env          # fill in your values
npm install

# 2. Set up database
createdb rms_db
npm run db:migrate             # run migrations
# OR apply raw DDL:
psql rms_db < artifacts/001_initial_schema.sql

# 3. Start API server
npm run dev:api                # http://localhost:3000

# 4. Start web app
npm run dev:web                # http://localhost:5173

# 5. Start dispatch engine
# cd apps/worker
# python -m venv .venv && source .venv/bin/activate
# pip install -r requirements.txt
# python main.py

cd apps/worker && . .venv_worker/bin/activate && python main.py
```

### Start all dev services at once

You can start the API, web frontend and the worker together with a single command from the repository root:

```bash
npm run dev
```

What it does:
- Runs the API (`apps/api`) with `nodemon` on `PORT` (default 3000).
- Runs the web app (`apps/web`) with `vite` (default 5173, may pick a different port if 5173 is occupied).
- Runs the Python worker (`apps/worker`) using the existing virtualenv at `apps/worker/.venv_worker`.

Troubleshooting tips
- If the worker doesn't start, ensure the virtualenv exists and dependencies are installed:

```bash
cd apps/worker
. .venv_worker/bin/activate
pip install -r requirements.txt
python main.py
```

- If ports are in use, `vite` will try the next available port; update `apps/web` dev server port in `apps/web/package.json` or stop the conflicting process.
- Make sure a valid `.env` (or `.env.dev`) with `DATABASE_URL` exists at the repo root so all services can connect to the database.
- To run services individually, use `npm run dev:api`, `npm run dev:web`, or `npm run dev:worker`.

dev:secure notes

- `npm run dev:secure` will generate development TLS certs and start all services with the API attempting to bind HTTPS.
- If the requested `SSL_PORT` is already in use the API will try to bind an ephemeral free port automatically and log which port was selected.
- To query the health endpoint over HTTPS for local testing (accepting the self-signed cert):

```bash
curl -k https://localhost:3443/health
```


HTTPS (development)

The API can run with HTTPS in development by providing a PEM key and certificate and pointing env vars at them. Example using self-signed certs:

```bash
# generate a simple self-signed cert for localhost
mkdir -p dev-certs
openssl req -x509 -newkey rsa:4096 -nodes -keyout dev-certs/dev.key -out dev-certs/dev.crt -days 365 -subj "/CN=localhost"

# then set these in your .env or export in your shell
export SSL_KEY_PATH=dev-certs/dev.key
export SSL_CERT_PATH=dev-certs/dev.crt
export SSL_PORT=3443   # optional, defaults to PORT

# start all services (API will use HTTPS)
npm run dev
```

If the cert paths are not provided or the files cannot be read, the API will fall back to plain HTTP.


## Changing the dispatch poll interval

No restart needed. Update via API:
```
PATCH /api/v1/admin/settings/dispatch_poll_interval_seconds
{ "value": "30" }
```
The engine reads this value on every loop iteration.

## Project structure

```
apps/
  api/          Node.js + Express REST API
  worker/       Python dispatch engine
  web/          React + Vite frontend
packages/
  db/           Prisma schema (shared)
infra/
  nginx/        Nginx reverse proxy config
  pm2/          PM2 process config (API)
  supervisor/   Supervisor config (Python worker)
.github/
  workflows/    GitHub Actions CI/CD
```

## Key design decisions

See `RMS_Functional_Specification_v1.1.docx` for the full specification.
