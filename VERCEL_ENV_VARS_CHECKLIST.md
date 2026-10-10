# Vercel Environment Variables - Complete Checklist

## 🎯 Quick Setup Guide

Copy these environment variables to your **Backend Vercel Project**:

**Vercel Dashboard → Your Backend Project (`technis-portal-server`) → Settings → Environment Variables**

---

## ✅ REQUIRED Variables (Must Set)

### 1. Authentication & Security

```bash
JWT_SECRET=
```
**How to generate**:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
**Example**: `a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456`

---

### 2. Database Connection

```bash
MONGODB_URI=
```
**Example**: `mongodb+srv://username:password@cluster0.abcdef.mongodb.net/?retryWrites=true&w=majority`

**Where to get it**: 
- MongoDB Atlas → Database → Connect → Drivers → Connection String
- Replace `<username>` and `<password>` with your actual credentials

---

### 3. CEO Account

```bash
CEO_EMAIL=ceo@techins.com
CEO_PASSWORD=
```

**⚠️ CRITICAL**: Change `CEO_PASSWORD` from default `ceo@2006`

**Example password**: `MySecureP@ssw0rd2024!`

---

### 4. CORS Configuration (NEW!)

```bash
CORS_ORIGINS=https://technis-work-portal-05-35bp.vercel.app
```

**⭐ This is THE most important one for fixing CORS errors!**

**Your actual frontend URL**: `https://technis-work-portal-05-35bp.vercel.app`

**Multiple URLs** (if you have preview deployments):
```bash
CORS_ORIGINS=https://technis-work-portal-05-35bp.vercel.app,https://technis-work-portal-05-git-main.vercel.app
```

**Rules**:
- No trailing slashes: ✅ `https://example.com` ❌ `https://example.com/`
- No spaces after commas
- HTTPS only (except localhost)

---

## 📋 Optional Variables

### CEO Customization

```bash
CEO_NAME=Your CEO Name
```

### Database

```bash
MONGODB_DB_NAME=techins
```

### Email Notifications (Optional)

```bash
APP_URL=https://technis-work-portal-05-35bp.vercel.app
RESEND_API_KEY=
EMAIL_FROM=notifications@techins.com
```

### Admin & Manager Accounts (Optional)

```bash
ADMIN_EMAIL=admin@techins.com
ADMIN_PASSWORD=
ADMIN_NAME=System Administrator

MANAGER_EMAIL=manager@techins.com
MANAGER_PASSWORD=
MANAGER_NAME=Project Manager
MANAGER_DEPARTMENT=Management
```

---

## 🚀 Copy-Paste Template

Use this template in Vercel:

```bash
# ============================================================
# REQUIRED - Must set all of these
# ============================================================

JWT_SECRET=GENERATE_WITH_CRYPTO_RANDOM_BYTES_32

MONGODB_URI=mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@YOUR_CLUSTER.mongodb.net/?retryWrites=true&w=majority

CEO_EMAIL=ceo@techins.com
CEO_PASSWORD=CHANGE_THIS_SECURE_PASSWORD

CORS_ORIGINS=https://technis-work-portal-05-35bp.vercel.app

# ============================================================
# OPTIONAL - Set if needed
# ============================================================

CEO_NAME=TECHINS CEO
MONGODB_DB_NAME=techins
APP_URL=https://technis-work-portal-05-35bp.vercel.app
```

---

## 📝 Step-by-Step Setup

### Step 1: Go to Vercel Backend Settings

1. Open: https://vercel.com/dashboard
2. Select your **backend project**: `technis-portal-server`
3. Go to: **Settings** → **Environment Variables**

### Step 2: Add Each Variable

For each variable:

1. Click **Add New**
2. Enter **Name** (e.g., `CORS_ORIGINS`)
3. Enter **Value** (e.g., `https://technis-work-portal-05-35bp.vercel.app`)
4. Select **Environment**: 
   - ✅ Production
   - ✅ Preview
   - ✅ Development
5. Click **Save**

### Step 3: Redeploy

After adding all variables:

**Option A: Git Push** (if connected to GitHub)
```bash
git push origin main
```

**Option B: Manual Redeploy**
- Go to: **Deployments** tab
- Click three dots (...) on latest deployment
- Click **Redeploy**

### Step 4: Verify

Check Vercel function logs:

```
[CORS] Allowed origins: https://technis-work-portal-05-35bp.vercel.app, http://localhost:5173, ...
[MongoDB] Connected successfully — db: techins
[Accounts] CEO created: ceo@techins.com
```

---

## ✅ Verification Checklist

After setting variables and redeploying:

- [ ] `JWT_SECRET` is set (min 32 characters)
- [ ] `MONGODB_URI` is set with correct credentials
- [ ] `CEO_EMAIL` is set to `ceo@techins.com`
- [ ] `CEO_PASSWORD` is changed from default
- [ ] `CORS_ORIGINS` is set to your actual frontend URL
- [ ] No trailing slashes in `CORS_ORIGINS`
- [ ] Backend redeployed after adding variables
- [ ] Checked Vercel logs for success messages
- [ ] Tested login from frontend (no CORS error)

---

## 🧪 Test After Setup

### Test 1: Health Check

```bash
curl https://technis-portal-server.vercel.app/api/health
```

**Expected**: `{"success":true,"status":"healthy",...}`

### Test 2: CORS Preflight

```bash
curl -X OPTIONS https://technis-portal-server.vercel.app/api/auth/login \
  -H "Origin: https://technis-work-portal-05-35bp.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -v
```

**Expected**: 
```
< access-control-allow-origin: https://technis-work-portal-05-35bp.vercel.app
< access-control-allow-credentials: true
```

### Test 3: CEO Login

```bash
curl -X POST https://technis-portal-server.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -H "Origin: https://technis-work-portal-05-35bp.vercel.app" \
  -d '{"email":"ceo@techins.com","password":"YOUR_PASSWORD"}'
```

**Expected**: `{"success":true,"token":"...","user":{...}}`

### Test 4: From Frontend

Open your frontend in browser:
- Go to: https://technis-work-portal-05-35bp.vercel.app
- Try to log in with CEO credentials
- Should work without CORS errors

---

## 🚨 Common Issues

### Issue: Still getting CORS error

**Solution**: 
1. Double-check `CORS_ORIGINS` exactly matches frontend URL
2. No trailing slash in URL
3. Backend was redeployed after adding variable
4. Clear browser cache (Ctrl+Shift+R)

### Issue: "Invalid or expired token"

**Solution**: 
1. Check `JWT_SECRET` is set
2. Min 32 characters
3. Backend redeployed after adding

### Issue: "Database connection unavailable"

**Solution**:
1. Check `MONGODB_URI` is correct
2. MongoDB Atlas allows 0.0.0.0/0 in IP Access List
3. Database user has read/write permissions

### Issue: CEO login fails

**Solution**:
1. Check `CEO_EMAIL` matches exactly (case-insensitive)
2. Check `CEO_PASSWORD` is correct
3. Check Vercel logs for "CEO created" message

---

## 📊 Environment Summary

### Required Variables (5)

| Variable | Example | Purpose |
|----------|---------|---------|
| `JWT_SECRET` | `a1b2c3d4...` | Token signing |
| `MONGODB_URI` | `mongodb+srv://...` | Database connection |
| `CEO_EMAIL` | `ceo@techins.com` | CEO account email |
| `CEO_PASSWORD` | `SecurePass123!` | CEO account password |
| `CORS_ORIGINS` | `https://your-frontend.vercel.app` | **CORS fix!** |

### Optional Variables (10+)

| Variable | Default | Purpose |
|----------|---------|---------|
| `CEO_NAME` | `TECHINS CEO` | Display name |
| `MONGODB_DB_NAME` | `techins` | Database name |
| `APP_URL` | `http://localhost:5173` | Email links |
| `RESEND_API_KEY` | - | Email service |
| `EMAIL_FROM` | - | Sender email |
| `ADMIN_EMAIL` | `admin@techins.com` | Admin account |
| `ADMIN_PASSWORD` | `Admin@123` | Admin password |
| `MANAGER_EMAIL` | `manager@techins.com` | Manager account |
| `MANAGER_PASSWORD` | `Manager@123` | Manager password |

---

## ✅ Final Checklist

Before going live:

- [ ] All 5 required variables are set in Vercel
- [ ] `CORS_ORIGINS` matches your frontend URL exactly
- [ ] `CEO_PASSWORD` is changed from default
- [ ] `JWT_SECRET` is secure (32+ random characters)
- [ ] MongoDB Atlas IP allowlist includes 0.0.0.0/0
- [ ] Backend deployed successfully
- [ ] Health check returns 200 OK
- [ ] CORS preflight returns correct headers
- [ ] CEO login works from frontend
- [ ] No CORS errors in browser console

---

**You're all set! Your frontend and backend can now communicate securely! 🎉**
