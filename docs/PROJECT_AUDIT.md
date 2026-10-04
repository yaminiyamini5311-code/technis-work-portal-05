# TECHINS Work Portal — Project Audit

Audit performed against the existing `TECHINS_WORK_PORTAL_FIXED` source and the TECHINS portal requirement prompt.

## Existing stack

- React 19 + Vite frontend
- React Router
- Axios/fetch API access
- Express 5 backend
- SQLite through Node.js `node:sqlite`
- JWT + bcryptjs authentication
- Multer upload handling

## Existing functional areas retained

- Login and role-aware routing
- Student dashboard, tasks, missions, daily activity, work history and performance
- Admin dashboard, students, tasks, missions, daily activities, performance and feedback
- Manager team activity monitoring
- Notifications
- Local file upload/download with ownership checks

## Main upgrades in this package

- Centralized SQLite schema with submission, submission-file, task-status-history and audit-log records
- Human-readable task IDs
- Controlled workflow status alongside legacy status compatibility
- Server-generated submission timestamps
- Submission versioning
- Review endpoint for approval/revision
- Revision notifications
- Audit logging for task/submission/activity/user actions
- Backend maximum of 25 active students retained
- Admin manager creation endpoint
- Admin user enable/disable endpoint
- Admin audit-log endpoint and UI
- Manager task workspace using the same task/review system
- Student submission UI that sends files/comments to the versioned submission endpoint
- Protected file access remains backend-authorized
- Login no longer hard-codes the deployed backend URL
- Vercel SPA routing configuration
- Render service configuration
- Secret-safe account creation scripts
- Production-oriented README and `.env.example` files
- Generated artifacts, local database, secrets and `node_modules` excluded from the deliverable

## Validation performed

- Backend JavaScript syntax checks passed for the modified server files.
- Backend started successfully with the existing project database during validation.
- `/api/health` returned a successful SQLite health response.
- Protected `/api/tasks` and `/api/audit-logs` returned `401 Unauthorized` without a token.
- A fresh SQLite database initialized the required tables, including `submissions`, `submission_files`, `audit_logs`, and `task_status_history`.

## Known deployment consideration

SQLite is appropriate for local development and small controlled deployments, but a multi-instance production deployment should use PostgreSQL and persistent private object storage for uploads. The codebase and documentation identify this boundary rather than pretending a local SQLite file is a production database service.
