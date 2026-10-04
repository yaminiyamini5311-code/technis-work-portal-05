# TECHINS WORK PORTAL

Professional internal work and task management portal for TECHINS.

## Core workflow

**Assign → Execute → Submit → Verify → Review → Improve → Approve → Record → Analyze**

The system is designed around one rule: important organizational actions must be stored, validated, authorized, timestamped and traceable.

## Stack

- Frontend: React 19 + Vite + React Router
- Backend: Node.js + Express
- Local database: SQLite through Node.js `node:sqlite` (Node 22+)
- Authentication: JWT + bcryptjs
- Uploads: protected server-side storage for local development
- Deployment: Vercel-ready frontend and Render/Node-host-ready backend

## Roles

- **Admin** — user management, task control, missions, feedback, performance and operational oversight.
- **Manager** — team activity monitoring, assigned-task operations and submission review for tasks they manage.
- **Student** — assigned work, daily activity, missions, submissions, feedback and private performance.

## Important capabilities

- Backend-enforced role authorization
- Maximum 25 active students
- Human-readable task IDs such as `TNS-2026-0001`
- Controlled task lifecycle with submission/review/revision/approval states
- Server-generated submission timestamps
- Submission version history (`V1`, `V2`, ...)
- Protected student file access
- In-app notifications
- Audit logs and task status history
- Database-derived dashboard/performance metrics
- Daily activity records
- Responsive UI with reduced-motion support
- TECHINS brand colors: `#B7B7B7`, `#0C120C`, `#FA9A02`

## Local setup

### 1. Backend

```powershell
cd server
npm install
Copy-Item .env.example .env
```

Set a strong `JWT_SECRET` in `server/.env`.

Create an admin account without putting its password in source control:

```powershell
node create-admin.js admin@techins.com "CHANGE_THIS_PASSWORD" "TECHINS Admin"
```

Optional manager:

```powershell
node create-manager.js manager@techins.com "CHANGE_THIS_PASSWORD" "TECHINS Manager"
```

Start the backend:

```powershell
npm run dev
```

Health check: `http://localhost:5000/api/health`

### 2. Frontend

```powershell
cd client
npm install
Copy-Item .env.example .env
```

Set:

```text
VITE_API_URL=http://localhost:5000
```

Start:

```powershell
npm run dev
```

Open the Vite URL shown in the terminal.

## Environment variables

### Backend

See `server/.env.example`.

- `PORT`
- `JWT_SECRET`
- `CLIENT_URL`
- `APP_URL`
- `RESEND_API_KEY` (optional)
- `EMAIL_FROM` (optional)

### Frontend

- `VITE_API_URL`

Never put backend secrets in `VITE_*` variables.

## Deployment

### Frontend — Vercel

Build command:

```text
npm run build
```

Set `VITE_API_URL` to the deployed backend origin, for example:

```text
https://your-backend.example.com
```

The client contains `vercel.json` for SPA routing.

### Backend — Render or another Node host

Start command:

```text
npm start
```

Set the backend environment variables from `server/.env.example`.

**Important:** local SQLite and local `server/uploads` are intended for development/small local deployments. For production growth, move the database to PostgreSQL and file uploads to persistent object storage (for example Vercel Blob or another private object-storage provider), while keeping the same metadata/authorization model.

## Git hygiene

Do not commit:

- `.env`
- `node_modules/`
- `dist/`
- `*.db`
- `*.db-wal`
- `*.db-shm`
- `server/uploads/`
- passwords or API keys

Use the provided `.env.example` files as templates.

## Validation checklist

- Backend syntax checks pass.
- Backend health endpoint responds.
- Protected APIs reject unauthenticated requests.
- Frontend uses `VITE_API_URL` rather than a hard-coded production URL.
- Student ownership is enforced by the backend.
- File downloads are authorization checked.
- Task submissions use server timestamps and versioning.
- Audit records are written for important workflow events.

## Development order

Audit → setup → database → authentication → roles/permissions → users → teams/programs → tasks → assignments → student dashboard → submission/proof → review → revision → approval → notifications → audit logs → admin command center → search/filters → reports → responsive design → animations/polish → security testing → end-to-end testing → deployment.
