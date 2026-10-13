# TECHINS Work Portal - Quick Deployment Checklist

Use this checklist to deploy and verify the application. See `DEPLOYMENT.md` for detailed instructions.

---

## ☑️ Pre-Deployment

- [ ] MongoDB Atlas cluster created
- [ ] Atlas Network Access set to `0.0.0.0/0` (required for Vercel)
- [ ] Atlas connection string copied and password URL-encoded
- [ ] GitHub repository ready

---

## ☑️ Backend Deployment (Vercel)

### 1. Create Project
- [ ] New Vercel project from GitHub repo
- [ ] Root directory: `server`
- [ ] Framework: Other

### 2. Set Environment Variables

Go to Settings → Environment Variables and add (apply to Production, Preview, Development):

**Required:**
- [ ] `JWT_SECRET` - Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- [ ] `MONGODB_URI` - Your Atlas URI with **URL-encoded password**
- [ ] `MONGODB_DB_NAME` - Usually `techins`
- [ ] `CORS_ORIGINS` - Your frontend URL (add after frontend deployment, see step 4)
- [ ] `CEO_EMAIL` - e.g., `ceo@techins.com`
- [ ] `CEO_PASSWORD_HASH` - Generate: `node server/scripts/generate-ceo-hash.js "password"`
- [ ] `CEO_NAME` - e.g., `TECHINS CEO`

**Optional but recommended:**
- [ ] `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`
- [ ] `MANAGER_EMAIL`, `MANAGER_PASSWORD`, `MANAGER_NAME`

### 3. Deploy
- [ ] Click Deploy
- [ ] Note backend URL: `https://_____.vercel.app`

### 4. Test Backend
```bash
curl https://your-backend.vercel.app/api/health?check=all
```
- [ ] Returns `{"success":true, "status":"healthy"}`
- [ ] `database.connected` is `true`

---

## ☑️ Frontend Deployment (Vercel)

### 1. Create Project
- [ ] New Vercel project from **same GitHub repo**
- [ ] Root directory: `client`
- [ ] Framework: Vite
- [ ] Build command: `npm run build`
- [ ] Output directory: `dist`

### 2. Set Environment Variables

Go to Settings → Environment Variables:

- [ ] `VITE_API_URL` (Production) = `https://your-backend.vercel.app` (from backend step 3)
- [ ] `VITE_API_URL` (Preview) = `https://your-backend.vercel.app` (same)

⚠️ **No trailing slash! Must be https://**

### 3. Deploy
- [ ] Click Deploy
- [ ] Note frontend URL: `https://_____.vercel.app`

---

## ☑️ Connect Frontend & Backend

### 1. Update Backend CORS
- [ ] Go to backend project → Settings → Environment Variables
- [ ] Update `CORS_ORIGINS` = `https://your-frontend.vercel.app` (exact URL from frontend step 3)
- [ ] Redeploy backend: Deployments → latest → ... → Redeploy

### 2. Verify CORS
- [ ] Open frontend URL in browser
- [ ] Open DevTools → Console
- [ ] Look for CORS errors (should be none)

---

## ☑️ Verification

### Automated Check
```bash
node verify-deployment.js https://your-frontend.vercel.app https://your-backend.vercel.app
```

### Manual Verification

1. **Backend Health**
   - [ ] `curl https://backend.vercel.app/api/health?check=all` returns success
   - [ ] Database connected: `true`
   - [ ] No missing env vars

2. **Frontend Connection**
   - [ ] Open `https://your-frontend.vercel.app`
   - [ ] DevTools Console shows no errors
   - [ ] No "Failed to fetch" or CORS errors

3. **CEO Login**
   - [ ] Can log in with CEO_EMAIL and password
   - [ ] Dashboard loads
   - [ ] Stats show real numbers (not all zeros)

4. **Dashboard Endpoints** (DevTools → Network tab)
   - [ ] `/api/admin/stats` returns 200
   - [ ] `/api/admin/progress?period=week` returns 200
   - [ ] `/api/tasks/submissions` returns 200
   - [ ] No 401, 403, or 503 errors

5. **Student Submissions (if data exists)**
   - [ ] CEO → Student Submissions page loads
   - [ ] Submissions are listed
   - [ ] Can click submission to view details
   - [ ] Files are listed with download buttons

6. **File Upload/Download**
   - [ ] Create student account from CEO dashboard
   - [ ] Log in as student
   - [ ] Submit task with text + files (image + PDF)
   - [ ] Submission succeeds
   - [ ] CEO can see submission
   - [ ] CEO can download files

---

## 🔧 Troubleshooting

### ❌ Frontend shows "Syncing latest data..." forever

**Cause**: Frontend can't reach backend

**Check**:
1. DevTools → Console for errors
2. Network tab for failed requests
3. Verify `VITE_API_URL` is set in frontend env vars
4. Verify URL is `https://` (not `http://`)
5. Redeploy frontend if `VITE_API_URL` was changed

---

### ❌ CORS Error

**Cause**: Backend CORS_ORIGINS doesn't include frontend URL

**Fix**:
1. Get exact frontend URL (copy from browser address bar)
2. Update backend env var: `CORS_ORIGINS=https://exact-frontend-url.vercel.app`
3. No trailing slash, no spaces
4. Redeploy backend

---

### ❌ 503 "Missing env vars"

**Cause**: Required variables not set on backend

**Fix**:
1. Check error message for missing variable names
2. Add them in backend Settings → Environment Variables
3. Redeploy backend

---

### ❌ 503 "Database connection unavailable"

**Cause**: Can't connect to MongoDB Atlas

**Check**:
1. `MONGODB_URI` is correct
2. Password is URL-encoded (special chars)
3. Atlas Network Access allows `0.0.0.0/0`
4. Database user has read/write permissions

---

### ❌ Dashboard shows 0 students but database has data

**Cause**: Using wrong database or connection failed

**Check**:
1. Backend logs in Vercel for connection errors
2. `MONGODB_DB_NAME` env var matches your database
3. Atlas cluster and database name are correct
4. Call `/api/health?check=db` to see user count

---

### ❌ "No completion activity has been recorded yet"

**Cause**: No tasks with `workflow_status: "Approved"`

**This is correct** if:
- No tasks are completed yet
- Tasks exist but not approved

**Fix** (if tasks should be approved):
1. CEO dashboard → Tasks
2. Find submitted tasks
3. Review and approve them

---

### ❌ File downloads fail

**Cause**: Files uploaded before GridFS migration, or permission issue

**Check**:
1. Backend logs for GridFS errors
2. Student can upload new files successfully
3. New uploads can be downloaded
4. Old files may need manual migration

---

## 📞 Need Help?

1. Check backend logs: Vercel backend project → Logs
2. Check browser console: DevTools → Console
3. Run verification: `node verify-deployment.js <frontend-url> <backend-url>`
4. See detailed guide: `DEPLOYMENT.md`

---

## ✅ Success Criteria

Your deployment is working correctly when:

- ✅ Backend health check returns success with DB connected
- ✅ Frontend loads without console errors
- ✅ CEO can log in and see dashboard
- ✅ Dashboard shows real stats (if data exists)
- ✅ Student submissions page loads
- ✅ Files can be uploaded and downloaded
- ✅ No CORS errors in browser
- ✅ No "Failed to fetch" errors

**If all checked:** Your deployment is complete! 🎉
