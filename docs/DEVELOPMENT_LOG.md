# TECHINS PORTAL DEVELOPMENT LOG

## Upgrade Package — 2026-10-02

**Phase:** Existing-project audit and core workflow hardening  
**Status:** Packaged

### Changes

- Inspected the existing React/Vite + Express + SQLite project.
- Preserved existing role pages and API structure.
- Extended database schema for task IDs, workflow status, submissions, versions, status history and audit logs.
- Added backend review/revision/approval workflow.
- Added backend manager task creation/review permissions.
- Added audit-log API and admin page.
- Added student versioned submission UI.
- Added Vercel and Render deployment configuration.
- Removed secrets, local database files, generated build output and `node_modules` from the deliverable.

### Tests

- Backend health endpoint: PASS
- Unauthenticated protected endpoint: PASS (`401`)
- Fresh SQLite schema initialization: PASS
- Backend syntax checks: PASS

### Notes

The frontend dependencies are intentionally not bundled in the ZIP. Run `npm install` in `client` and `server` after extraction.
