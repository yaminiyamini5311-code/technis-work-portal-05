# QUICK FIX: Production Dashboard Not Working

**Problem**: Dashboard shows "Syncing latest data..." forever, student submissions not working.

**Root Cause**: Missing environment variables in Vercel deployment.

---

## Fix in 5 Steps (15 minutes)

### Step 1: Generate Required Values

Run these commands locally:

```bash
# Generate JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

# Generate CEO_PASSWORD_HASH
cd server
node scripts/generate-ceo-hash.js "your-ceo-password"
```

Copy the outputs - you'll need them in Step 3.

---

### Step 2: Get Your MongoDB Atlas Connection String

1. Log in to MongoDB Atlas
2. Click **Connect** → **Connect your application**
3. Copy connection string (looks like):
   ```
   mongodb+srv://user:password@cluster.mongodb.net/?appName=App
   ```
4. **URL-encode special characters in password**:
   - If password is `P@ss:word` use `P%40ss%3Aword`
   - Common: `@` → `%40`, `:` → `%3A`, `/` → `%2F`

---

### Step 3: Configure Backend (Vercel)

1. Go to Vercel → **Backend project** → **Settings** → **Environment Variables**

2. Add these variables (apply to Production, Preview, Development):

   | Variable | Value |
   |----------|-------|
   | `JWT_SECRET` | Output from Step 1 |
   | `MONGODB_URI` | Your Atlas URI from Step 2 |
   | `MONGODB_DB_NAME` | `techins` |
   | `CORS_ORIGINS` | `https://your-frontend-url.vercel.app` |
   | `CEO_EMAIL` | `ceo@techins.com` |
   | `CEO_PASSWORD_HASH` | Output from Step 1 |
   | `CEO_NAME` | `TECHINS CEO` |

3. Get frontend URL from Vercel frontend project (e.g., `https://technis-work-portal-05.vercel.app`)

4. Update `CORS_ORIGINS` with **exact** frontend URL (no trailing slash)

5. **Redeploy backend**: Deployments → latest → three dots → Redeploy

---

### Step 4: Configure Frontend (Vercel)

1. Go to Vercel → **Frontend project** → **Settings** → **Environment Variables**

2. Add this variable (apply to Production and Preview):

   | Variable | Value |
   |----------|-------|
   | `VITE_API_URL` | `https://your-backend-url.vercel.app` |

3. Use backend URL from backend project (e.g., `https://technis-portal-server.vercel.app`)

4. **IMPORTANT**: No trailing slash, must be `https://`

5. **Redeploy frontend**: Deployments → latest → three dots → Redeploy
   - This is REQUIRED because `VITE_*` vars are inlined at build time

---

### Step 5: Verify

```bash
# Test backend health
curl https://your-backend.vercel.app/api/health?check=all

# Should return:
# {"success":true,"status":"healthy","database":{"connected":true}}
```

Then:
1. Open frontend URL in browser
2. Press F12 → Console tab
3. Look for errors (should be none)
4. Log in as CEO (email from Step 3, password from Step 1)
5. Dashboard should load with real data

---

## Still Not Working?

### ❌ "Failed to fetch" in console

**Cause**: Frontend can't reach backend

**Fix**:
- Check `VITE_API_URL` is set in frontend env vars
- Verify it's `https://` not `http://`
- Redeploy frontend (env vars require rebuild)

---

### ❌ CORS error in console

**Cause**: Backend CORS_ORIGINS doesn't match frontend URL

**Fix**:
1. Copy exact frontend URL from browser address bar
2. Update backend `CORS_ORIGINS` (no trailing slash)
3. Redeploy backend

---

### ❌ 503 error

**Cause**: Backend missing environment variables

**Fix**:
1. Check backend Vercel logs for "Missing required environment variables"
2. Add the missing variables
3. Redeploy backend

---

### ❌ Database connection failed

**Cause**: Can't connect to MongoDB Atlas

**Fix**:
1. MongoDB Atlas → Network Access → Add `0.0.0.0/0`
2. Check password is URL-encoded in `MONGODB_URI`
3. Verify database user has read/write permissions

---

## Need More Help?

- **Detailed guide**: See `DEPLOYMENT.md`
- **Checklist**: See `DEPLOYMENT_CHECKLIST.md`
- **Automated check**: Run `node verify-deployment.js <frontend-url> <backend-url>`
- **Full report**: See `PRODUCTION_ISSUE_REPORT.md`

---

## What Was Fixed?

1. ✅ Frontend error handling improved (shows clear errors + retry)
2. ✅ Deployment documentation created (step-by-step guide)
3. ✅ Verification script created (automated checks)
4. ✅ Root causes identified (all env var config issues)

**No code bugs found** - only deployment configuration problems.

**File storage is correct** - uses MongoDB GridFS (serverless-compatible).

**Database logic is correct** - completion activity reflects real data.
