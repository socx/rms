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
cd apps/worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python main.py
```

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
