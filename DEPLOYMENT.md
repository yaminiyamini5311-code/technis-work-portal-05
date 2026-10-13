# TECHINS Work Portal - Deployment Guide

## Overview

This application consists of:
- **Frontend**: React/Vite SPA deployed on Vercel
- **Backend**: Node/Express API deployed on Vercel as serverless functions
- **Database**: MongoDB (local development or MongoDB Atlas for production)
- **File Storage**: MongoDB GridFS (serverless-compatible)

---

## Prerequisites

1. **Vercel Account** - Sign up at https://vercel.com
2. **MongoDB Atlas Account** (for production) - Sign up at https://www.mongodb.com/cloud/atlas
3. **Two Vercel Projects**:
   - One for the frontend (`client/` directory)
   - One for the backend (`server/` directory)

---

## Part 1: MongoDB Atlas Setup

### 1.1 Create Database

1. Log in to MongoDB Atlas
2. Create a new cluster (free tier is fine)
3. Database name: `techins` (or your preferred name)
4. Create a database user with read/write access
5. **IMPORTANT**: Note the username and password

### 1.2 Network Access Configuration

⚠️ **CRITICAL FOR VERCEL**: Vercel serverless functions use dynamic IPs.

1. Go to **Network Access** in Atlas
2. Click **Add IP Address**
3. Select **Allow Access from Anywhere** (0.0.0.0/0)
   - This is required because Vercel functions don't have static IPs
   - MongoDB connection is still secured by username/password

### 1.3 Get Connection String

1. Go to **Clusters** → **Connect** → **Connect your application**
2. Copy the connection string (looks like):
   ```
   mongodb+srv://USERNAME:PASSWORD@cluster.mongodb.net/?appName=AppName
   ```
3. **IMPORTANT**: Replace `<PASSWORD>` with your actual password
4. **URL-encode special characters in password**:
   - `@` → `%40`
   - `:` → `%3A`
   - `/` → `%2F`
   - `?` → `%3F`
   - `#` → `%23`
   - `%` → `%25`

   Example: If password is `P@ss:word/123`, use `P%40ss%3Aword%2F123`

---

## Part 2: Backend Deployment (Vercel)

### 2.1 Create Backend Project

1. Push your code to GitHub (if not already done)
2. Go to Vercel Dashboard → **Add New Project**
3. Import your GitHub repository
4. **Root Directory**: Set to `server`
5. **Framework Preset**: Other
6. **Build Command**: (leave empty or `npm install`)
7. **Output Directory**: (leave empty)

### 2.2 Configure Environment Variables

Go to **Settings** → **Environment Variables** and add:

#### Required Variables

| Variable | Value | Notes |
|----------|-------|-------|
| `JWT_SECRET` | Generate with command below | Used for auth tokens |
| `MONGODB_URI` | Your Atlas connection string | Include encoded password |
| `MONGODB_DB_NAME` | `techins` | Or your database name |
| `CORS_ORIGINS` | Your frontend URL(s) | See below |
| `CEO_EMAIL` | `ceo@techins.com` | CEO account email |
| `CEO_PASSWORD_HASH` | Generate with command below | CEO password hash |
| `CEO_NAME` | `TECHINS CEO` | CEO display name |

**Generate JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**Generate CEO_PASSWORD_HASH:**
```bash
cd server
node scripts/generate-ceo-hash.js "your-ceo-password-here"
```

#### CORS_ORIGINS Configuration

⚠️ **CRITICAL**: This must include your frontend URL(s).

**Format**: Comma-separated URLs, NO trailing slashes

**Example for single domain:**
```
CORS_ORIGINS=https://your-frontend.vercel.app
```

**Example for production + preview deployments:**
```
CORS_ORIGINS=https://your-frontend.vercel.app,https://your-frontend-git-main-username.vercel.app
```

**To find your frontend URLs:**
1. Deploy frontend first (see Part 3)
2. Note the production URL (e.g., `https://technis-work-portal-05.vercel.app`)
3. Add it to CORS_ORIGINS
4. Redeploy backend to pick up new CORS config

#### Optional Variables

| Variable | Value | Notes |
|----------|-------|-------|
| `ADMIN_EMAIL` | `admin@techins.com` | Default admin account |
| `ADMIN_PASSWORD` | `Admin@123` | Change for production! |
| `ADMIN_NAME` | `TECHINS Admin` | Admin display name |
| `MANAGER_EMAIL` | `manager@techins.com` | Default manager account |
| `MANAGER_PASSWORD` | `Manager@123` | Change for production! |
| `MANAGER_NAME` | `TECHINS Manager` | Manager display name |
| `MANAGER_DEPARTMENT` | `Techins` | Manager department |
| `RESEND_API_KEY` | Your Resend API key | For email notifications (optional) |
| `EMAIL_FROM` | `TECHINS <onboarding@resend.dev>` | Email sender |
| `APP_URL` | Your frontend URL | Used in email links |

#### Apply to All Environments

For each environment variable:
- Check **Production**, **Preview**, and **Development**
- Click **Save**

### 2.3 Deploy Backend

1. Click **Deploy** (or push to GitHub to trigger auto-deploy)
2. Wait for build to complete
3. Note your backend URL (e.g., `https://technis-portal-server.vercel.app`)

### 2.4 Verify Backend

Test health endpoints:
```bash
# Basic health check
curl https://your-backend.vercel.app/api/health

# Check database connection
curl https://your-backend.vercel.app/api/health?check=db

# Check configuration
curl https://your-backend.vercel.app/api/health?check=config
```

Expected response:
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2024-...",
  "database": {"connected": true}
}
```

**If you see errors:**
- `503` with "missing env vars" → Add required variables in Vercel
- `503` with "database connection unavailable" → Check MongoDB Atlas IP allowlist and connection string
- `503` with "authentication failed" → Check password URL encoding in MONGODB_URI

---

## Part 3: Frontend Deployment (Vercel)

### 3.1 Create Frontend Project

1. Go to Vercel Dashboard → **Add New Project**
2. Import your GitHub repository (same repo as backend)
3. **Root Directory**: Set to `client`
4. **Framework Preset**: Vite
5. **Build Command**: `npm run build`
6. **Output Directory**: `dist`

### 3.2 Configure Environment Variables

Go to **Settings** → **Environment Variables** and add:

| Variable | Value | Environment | Notes |
|----------|-------|-------------|-------|
| `VITE_API_URL` | `https://your-backend.vercel.app` | Production | Your backend URL |
| `VITE_API_URL` | `https://your-backend.vercel.app` | Preview | Same as production |

⚠️ **CRITICAL**: 
- Use your **actual backend URL** from Part 2.3
- NO trailing slash
- Must be https:// (not http://)
- This is **inlined at build time** - changing it requires a redeploy

### 3.3 Deploy Frontend

1. Click **Deploy**
2. Wait for build to complete
3. Note your frontend URL (e.g., `https://technis-work-portal-05.vercel.app`)

### 3.4 Update Backend CORS

Now that you have the frontend URL:

1. Go to backend Vercel project → **Settings** → **Environment Variables**
2. Update `CORS_ORIGINS` to include your frontend URL:
   ```
   CORS_ORIGINS=https://technis-work-portal-05.vercel.app
   ```
3. **Redeploy backend** (Settings → Deployments → latest deployment → three dots → Redeploy)

---

## Part 4: Verification & Testing

### 4.1 Check API Connection

1. Open your frontend URL
2. Open browser DevTools (F12) → Console
3. Log in as CEO:
   - Email: Value of `CEO_EMAIL` env var
   - Password: The password you used to generate `CEO_PASSWORD_HASH`
4. Check Console for errors:
   - ❌ `CORS error` → Backend CORS_ORIGINS doesn't include frontend URL
   - ❌ `Failed to fetch` → VITE_API_URL not set or wrong
   - ❌ `401 Unauthorized` → JWT_SECRET mismatch or not set
   - ✅ No errors → Connection working!

### 4.2 Check Network Tab

1. Open DevTools → Network tab
2. Refresh dashboard
3. Check these requests:

| Endpoint | Status | Success? |
|----------|--------|----------|
| `/api/admin/stats` | 200 | ✅ Shows student/task counts |
| `/api/admin/progress?period=week` | 200 | ✅ Shows completion data |
| `/api/tasks/submissions` | 200 | ✅ Shows submissions |
| `/api/notifications` | 200 | ✅ Shows notifications |

**If any fail:**
- `0 (failed)` → Check VITE_API_URL (likely calling localhost)
- `401` → Check JWT_SECRET matches between builds
- `403 CORS` → Check CORS_ORIGINS includes exact frontend URL
- `503` → Check backend environment variables

### 4.3 Test File Upload/Download

1. Log in as a student (create one from CEO dashboard)
2. Go to **My Tasks** → Submit a task with:
   - Text response
   - Link (optional)
   - 2 files: one image (.jpg/.png) and one document (.pdf)
3. Click **Submit**
4. ✅ Should succeed (check Console for errors)
5. Log in as CEO → **Student Submissions**
6. Find the submission
7. Click to open detail view
8. ✅ Files should be listed
9. Click each file's download button
10. ✅ Files should download

**If downloads fail:**
- Check backend logs in Vercel for GridFS errors
- Check browser Console for auth errors
- Verify MongoDB connection is working

### 4.4 Check Database Data

**To verify which database is being used:**

1. Check backend deployment logs in Vercel
2. Look for:
   ```
   [MongoDB] Connected successfully — db: techins
   ```
3. Log in to MongoDB Atlas
4. Browse Collections → `users` collection
5. Count documents:
   - Should match "Students" count in dashboard
   - If counts differ, you're using a different database

**If showing wrong data:**
- Check `MONGODB_URI` and `MONGODB_DB_NAME` in backend env vars
- Verify URI points to correct cluster and database
- Check if production is using a different/empty database

---

## Part 5: Database Migration (If Needed)

⚠️ **Only if production is using the wrong database or you need to migrate data**

### Option A: Point to Existing Database

If your local MongoDB has the correct data (71 students):

1. **Export from local** (if using local MongoDB):
   ```bash
   mongodump --db=techins --out=./backup
   ```

2. **Import to Atlas**:
   ```bash
   mongorestore --uri="mongodb+srv://USER:PASS@cluster.mongodb.net/techins" ./backup/techins
   ```

3. Verify in Atlas that data is imported
4. Update backend `MONGODB_URI` to point to Atlas
5. Redeploy backend

### Option B: Start Fresh in Production

If production should have its own data:

1. Current state is correct (36 students in production, 71 in local)
2. They're separate databases - this is intentional
3. Add students in production through CEO dashboard

---

## Part 6: Ongoing Maintenance

### Redeploy After Environment Variable Changes

**Frontend variables** (`VITE_*`):
- Require **rebuild + redeploy** (they're inlined at build time)
- Change variable → Deployments → Redeploy (triggers new build)

**Backend variables**:
- Take effect immediately on next function cold start
- Can force by: Deployments → Redeploy

### Monitor Function Logs

1. Go to Vercel project → **Logs**
2. Watch for:
   - Database connection errors
   - Missing env var warnings
   - CORS blocking messages
   - File upload/download errors

### Update CORS for New Domains

When adding preview/staging URLs:
1. Add to `CORS_ORIGINS` (comma-separated, no spaces)
2. Redeploy backend

---

## Troubleshooting

### Dashboard shows "Syncing latest data..." forever

**Cause**: API requests are failing

**Fix**:
1. Open browser DevTools → Console
2. Check for errors:
   - `Failed to fetch` → Check VITE_API_URL
   - `CORS error` → Check CORS_ORIGINS
   - `401` → Check JWT_SECRET
3. Open Network tab, check request status
4. Fix environment variables and redeploy

### "No completion activity has been recorded yet"

**Cause**: No tasks with `workflow_status: "Approved"` exist in database

**Fix**:
1. Verify this is expected (check if tasks are actually completed)
2. Log in to CEO dashboard → Tasks
3. Check task statuses
4. If tasks should be completed, review/approve them

### File downloads fail

**Cause**: Files stored before GridFS migration, or GridFS not working

**Fix**:
1. Check backend logs for GridFS errors
2. Verify MongoDB connection is working
3. Old files auto-migrate on first download attempt
4. If migration fails, files may be lost (check `server/uploads/` on old deployment)

### Different student counts (local vs production)

**Cause**: Using different databases

**Fix**:
1. Check `MONGODB_URI` in backend env vars
2. Verify it points to the intended database
3. If wrong, update URI and redeploy
4. If intentional (separate dev/prod), this is correct

### CORS errors only on some requests

**Cause**: Browser caching old CORS headers

**Fix**:
1. Hard refresh (Ctrl+Shift+R / Cmd+Shift+R)
2. Clear browser cache
3. Open in incognito/private window
4. Verify CORS_ORIGINS in backend includes frontend URL

---

## Environment Variables Checklist

### Backend (server/) - Required

- [ ] `JWT_SECRET` - 64-byte random hex string
- [ ] `MONGODB_URI` - Atlas connection string with encoded password
- [ ] `MONGODB_DB_NAME` - Database name (default: techins)
- [ ] `CORS_ORIGINS` - Frontend URL(s), comma-separated, no trailing slashes
- [ ] `CEO_EMAIL` - CEO login email
- [ ] `CEO_PASSWORD_HASH` - Bcrypt hash of CEO password (cost 12)
- [ ] `CEO_NAME` - CEO display name

### Backend (server/) - Optional

- [ ] `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`
- [ ] `MANAGER_EMAIL`, `MANAGER_PASSWORD`, `MANAGER_NAME`, `MANAGER_DEPARTMENT`
- [ ] `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`

### Frontend (client/) - Required

- [ ] `VITE_API_URL` (Production) - Backend URL
- [ ] `VITE_API_URL` (Preview) - Backend URL

---

## Quick Commands Reference

```bash
# Generate JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate CEO password hash
cd server
node scripts/generate-ceo-hash.js "your-password"

# Test backend health
curl https://your-backend.vercel.app/api/health?check=all

# Test backend from local frontend
cd client
npm run dev
# Then open http://localhost:5173

# Build frontend locally
cd client
npm run build
npm run preview
```

---

## Support

For issues:
1. Check Vercel function logs (backend project → Logs)
2. Check browser DevTools Console and Network tab
3. Verify all environment variables are set correctly
4. Test backend health endpoint
5. Check MongoDB Atlas connection and IP allowlist

Common fixes:
- Most issues = missing or incorrect environment variables
- CORS errors = CORS_ORIGINS doesn't match frontend URL
- Database errors = Check Atlas IP allowlist (0.0.0.0/0) and connection string encoding
- Frontend calling localhost = VITE_API_URL not set or frontend not rebuilt after change
