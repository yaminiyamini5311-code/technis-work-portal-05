# CORS Error Fix - Complete Solution ✅

## Problem

Frontend at `https://technis-work-portal-05-35bp.vercel.app` gets CORS error when calling backend at `https://technis-portal-server.vercel.app`:

```
OPTIONS /api/auth/login returns 403 "Not allowed by CORS"
No Access-Control-Allow-Origin header
```

---

## ✅ Solution Implemented

### 1. **Environment Variable-Based CORS Configuration**

**New Primary Variable: `CORS_ORIGINS`**
- Comma-separated list of allowed frontend origins
- Trailing slashes automatically stripped
- Example: `https://technis-work-portal-05-35bp.vercel.app,https://another-domain.com`

### 2. **CORS Middleware Configuration**

**Applied BEFORE all routes, auth middleware, and rate limiters:**
```javascript
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));  // Handle preflight requests
```

**Features:**
- ✅ Allows no-origin requests (Postman, mobile apps, curl)
- ✅ Logs blocked origins for debugging
- ✅ Returns `cb(null, false)` instead of throwing errors
- ✅ Strips trailing slashes from origins
- ✅ Supports credentials (cookies, authorization headers)

**Methods Allowed:**
- GET
- POST
- PUT
- PATCH
- DELETE
- OPTIONS

**Headers Allowed:**
- Content-Type
- Authorization

---

## 📋 Environment Variables to Set in Vercel

### **REQUIRED Variables**

Go to: **Vercel Dashboard → Your Backend Project → Settings → Environment Variables**

Add these **REQUIRED** variables:

```bash
# Authentication & Database (existing)
JWT_SECRET=<your-secret-32-chars-min>
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority

# CEO Account (existing)
CEO_EMAIL=ceo@techins.com
CEO_PASSWORD=<your-secure-password>

# ⭐ CORS Configuration (NEW - REQUIRED!)
CORS_ORIGINS=https://technis-work-portal-05-35bp.vercel.app
```

### **Multiple Frontend URLs**

If you have multiple frontend deployments:

```bash
CORS_ORIGINS=https://technis-work-portal-05-35bp.vercel.app,https://your-custom-domain.com,https://preview.vercel.app
```

**Important**: 
- No spaces after commas
- No trailing slashes
- HTTPS URLs only (except localhost)

### **Optional Variables**

```bash
# CEO customization
CEO_NAME=Your CEO Name

# Database
MONGODB_DB_NAME=techins

# Email notifications (optional)
APP_URL=https://technis-work-portal-05-35bp.vercel.app
RESEND_API_KEY=<your-resend-key>
EMAIL_FROM=notifications@techins.com

# Backward compatibility (deprecated - use CORS_ORIGINS)
FRONTEND_URL=https://technis-work-portal-05-35bp.vercel.app
```

---

## 🔧 Complete Setup Instructions

### **Step 1: Set CORS_ORIGINS in Backend Vercel**

1. Go to: https://vercel.com/dashboard
2. Select your **backend project** (`technis-portal-server`)
3. Go to **Settings** → **Environment Variables**
4. Click **Add New**
5. Add:
   - **Name**: `CORS_ORIGINS`
   - **Value**: `https://technis-work-portal-05-35bp.vercel.app`
   - **Environment**: Production, Preview, Development (select all)
6. Click **Save**

### **Step 2: Set Other Required Variables**

While you're there, also verify these are set:

```bash
JWT_SECRET=<your-secret>
MONGODB_URI=<your-mongodb-connection-string>
CEO_EMAIL=ceo@techins.com
CEO_PASSWORD=<your-secure-password>
```

### **Step 3: Redeploy Backend**

After adding `CORS_ORIGINS`:

**Option A: Automatic (if GitHub connected)**
```bash
git push origin main  # Triggers auto-deploy
```

**Option B: Manual Redeploy**
- Go to Vercel Dashboard → Deployments
- Click the three dots (...) on latest deployment
- Click **Redeploy**
- Check **Use existing Build Cache** (faster)
- Click **Redeploy**

### **Step 4: Verify CORS Configuration**

Check Vercel function logs:

```bash
# Look for this in logs:
[CORS] Allowed origins: https://technis-work-portal-05-35bp.vercel.app, http://localhost:5173, ...
```

### **Step 5: Test from Frontend**

Try logging in from your frontend:

```javascript
fetch('https://technis-portal-server.vercel.app/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  credentials: 'include',  // Important for CORS
  body: JSON.stringify({
    email: 'ceo@techins.com',
    password: 'your-password'
  })
})
```

**Expected result**: ✅ No CORS error, successful login

---

## 🔍 How the Fix Works

### **Before (Problematic)**

```javascript
// Hardcoded origins
const allowedOrigins = [
  "https://technis-work-portal-05.vercel.app",  // Wrong URL!
  // Missing: https://technis-work-portal-05-35bp.vercel.app
];

app.use(cors({
  origin: (origin, callback) => {
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // ❌ Throws error - causes 500
    return callback(new Error("Not allowed by CORS"));
  }
}));
```

**Problems**:
1. ❌ Hardcoded origins - difficult to update
2. ❌ Wrong frontend URL
3. ❌ Throws error instead of returning false
4. ❌ CORS applied after routes

### **After (Fixed)**

```javascript
// Environment-based origins
function buildCorsOriginsList() {
  const origins = new Set();
  
  // Localhost for development
  origins.add("http://localhost:5173");
  
  // Production from CORS_ORIGINS env var
  if (process.env.CORS_ORIGINS) {
    process.env.CORS_ORIGINS
      .split(",")
      .map(url => url.trim().replace(/\/$/, ""))  // Strip trailing /
      .filter(Boolean)
      .forEach(url => origins.add(url));
  }
  
  return Array.from(origins);
}

const corsOptions = {
  origin: (origin, callback) => {
    // ✅ Allow no-origin requests
    if (!origin) return callback(null, true);
    
    // ✅ Check allowlist
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // ✅ Log and return false (not error)
    console.warn("[CORS] ❌ Blocked origin:", origin);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// ✅ Apply BEFORE routes
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));  // ✅ Handle preflight
```

**Improvements**:
1. ✅ Environment-based configuration
2. ✅ Easy to update via Vercel dashboard
3. ✅ Returns false instead of throwing
4. ✅ CORS applied before all routes
5. ✅ Explicit OPTIONS handling
6. ✅ Logs blocked origins for debugging

---

## 🧪 Testing

### **Test CORS from Browser Console**

```javascript
// Open frontend (https://technis-work-portal-05-35bp.vercel.app)
// Open browser console (F12)
// Run this:

fetch('https://technis-portal-server.vercel.app/api/health', {
  method: 'GET',
  headers: { 'Content-Type': 'application/json' }
})
.then(r => r.json())
.then(data => console.log('✅ CORS working:', data))
.catch(err => console.error('❌ CORS error:', err));
```

### **Test OPTIONS Preflight**

```bash
curl -X OPTIONS https://technis-portal-server.vercel.app/api/auth/login \
  -H "Origin: https://technis-work-portal-05-35bp.vercel.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -v
```

**Expected response**:
```
< HTTP/2 200
< access-control-allow-origin: https://technis-work-portal-05-35bp.vercel.app
< access-control-allow-methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
< access-control-allow-headers: Content-Type,Authorization
< access-control-allow-credentials: true
```

### **Test Actual Login**

```bash
curl -X POST https://technis-portal-server.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -H "Origin: https://technis-work-portal-05-35bp.vercel.app" \
  -d '{"email":"ceo@techins.com","password":"ceo@2006"}' \
  -v
```

**Expected response**:
```
< HTTP/2 200
< access-control-allow-origin: https://technis-work-portal-05-35bp.vercel.app
< access-control-allow-credentials: true
< content-type: application/json

{"success":true,"token":"...","user":{...}}
```

---

## 🚨 Troubleshooting

### Still Getting CORS Error?

**1. Check CORS_ORIGINS is set correctly**

```bash
# Verify in Vercel Dashboard
# Should be: https://technis-work-portal-05-35bp.vercel.app
# NOT: https://technis-work-portal-05-35bp.vercel.app/
# NOT: http://technis-work-portal-05-35bp.vercel.app
```

**2. Check Vercel Logs**

Look for:
```
[CORS] Allowed origins: https://technis-work-portal-05-35bp.vercel.app, ...
```

If you see:
```
[CORS] ❌ Blocked origin: https://technis-work-portal-05-35bp.vercel.app
```

Then `CORS_ORIGINS` is not set correctly or backend wasn't redeployed.

**3. Verify Redeploy**

- Changes to environment variables require redeploy
- Go to Vercel Dashboard → Deployments
- Check latest deployment has the new env var

**4. Clear Browser Cache**

```javascript
// Hard refresh
// Windows: Ctrl + Shift + R
// Mac: Cmd + Shift + R
```

**5. Check Frontend Origin**

```javascript
// In frontend, verify you're sending correct Origin header
console.log(window.location.origin);
// Should be: https://technis-work-portal-05-35bp.vercel.app
```

### Wrong Origin in Request?

If frontend is deployed at a different URL:

```bash
# Update CORS_ORIGINS to match actual frontend URL
CORS_ORIGINS=<your-actual-frontend-url>
```

### Multiple Deployment Previews?

Each Vercel preview deployment has a unique URL. Add them all:

```bash
CORS_ORIGINS=https://technis-work-portal-05-35bp.vercel.app,https://technis-work-portal-05-git-main.vercel.app,https://technis-work-portal-05-preview.vercel.app
```

**Or use wildcards** (less secure):

```bash
# Allow all *.vercel.app domains (not recommended for production)
# You'll need custom origin validation in code
```

---

## 📊 CORS Request Flow

### **Preflight Request (OPTIONS)**

```
Browser sends OPTIONS request:
  Origin: https://technis-work-portal-05-35bp.vercel.app
  Access-Control-Request-Method: POST
  Access-Control-Request-Headers: Content-Type

Backend responds:
  ✅ Access-Control-Allow-Origin: https://technis-work-portal-05-35bp.vercel.app
  ✅ Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
  ✅ Access-Control-Allow-Headers: Content-Type,Authorization
  ✅ Access-Control-Allow-Credentials: true
  ✅ Status: 200 OK

Browser: "OK, origin is allowed, proceed with actual request"
```

### **Actual Request (POST)**

```
Browser sends POST request:
  Origin: https://techins-work-portal-05-35bp.vercel.app
  Content-Type: application/json
  Body: {"email":"...","password":"..."}

Backend responds:
  ✅ Access-Control-Allow-Origin: https://techins-work-portal-05-35bp.vercel.app
  ✅ Access-Control-Allow-Credentials: true
  ✅ Status: 200 OK
  Body: {"success":true,"token":"..."}

Browser: "Origin matches, allow frontend to read response"
```

---

## ✅ Summary

**Changes Made:**

1. ✅ CORS configuration reads from `CORS_ORIGINS` environment variable
2. ✅ Comma-separated list of origins (trailing slashes stripped)
3. ✅ Allows no-origin requests (Postman, mobile apps)
4. ✅ Logs blocked origins with helpful messages
5. ✅ Returns `cb(null, false)` instead of throwing errors
6. ✅ CORS middleware applied BEFORE all routes
7. ✅ Explicit `app.options("*", cors())` for preflight handling
8. ✅ Methods: GET/POST/PUT/PATCH/DELETE/OPTIONS
9. ✅ Headers: Content-Type, Authorization
10. ✅ Credentials: true (cookies/auth headers allowed)

**Environment Variables to Set:**

```bash
# Backend Vercel Project
CORS_ORIGINS=https://technis-work-portal-05-35bp.vercel.app
```

**After setting:**
1. Redeploy backend
2. Test from frontend
3. Check Vercel logs for "[CORS] Allowed origins"

**No more CORS errors!** 🎉

---

## 📝 Files Changed

1. **`server/server.js`**
   - Replaced hardcoded CORS config
   - Added `buildCorsOriginsList()` function
   - Moved CORS middleware before all routes
   - Added explicit OPTIONS handler

2. **`server/ENVIRONMENT_VARIABLES.md`**
   - Added `CORS_ORIGINS` documentation
   - Marked `FRONTEND_URL` as deprecated

3. **`server/.env.example`**
   - Added `CORS_ORIGINS` example
   - Added usage notes

4. **`server/verify-env.js`**
   - Added `CORS_ORIGINS` to required variables

---

**Your frontend can now communicate with your backend without CORS errors! 🚀**
