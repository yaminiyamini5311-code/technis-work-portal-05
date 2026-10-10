# CEO Account - Direct Login Configuration ✅

## Overview

The CEO account has **direct login access** without any registration or approval process. Only **ONE designated email** can be the CEO, configured via environment variables.

---

## 🔐 Security Features

### 1. **No Registration for CEO**
- CEO account cannot be created through the `/signup` endpoint
- Anyone attempting to register as "ceo" role will be blocked
- Anyone attempting to use the CEO email in signup will be blocked

### 2. **Email-Based Access Control**
- Only the designated CEO email (from `CEO_EMAIL` env var) can log in as CEO
- No other account can use the CEO email
- No other account can have CEO role except the designated CEO email

### 3. **Direct Login**
- CEO logs in directly using email and password
- No approval workflow required
- Immediate access to CEO Portal upon successful login

### 4. **Password Security**
- CEO password is hashed with bcrypt (12 rounds)
- Never stored in plaintext
- Must be changed from default in production

### 5. **Role-Based Access Control**
- New `authorizeCEO` middleware for CEO-only endpoints
- Existing `authorizeRoles("ceo")` for CEO + other roles
- JWT token includes CEO role for authentication

---

## 📋 Setup Instructions

### **Step 1: Set Environment Variables in Vercel**

Go to: **Vercel Dashboard → Your Project → Settings → Environment Variables**

Add these **REQUIRED** variables:

```bash
CEO_EMAIL=ceo@techins.com
CEO_PASSWORD=YourSecurePasswordHere
```

**Optional** (for customization):
```bash
CEO_NAME=John Doe
```

### **Step 2: Deploy or Redeploy**

```bash
git push origin main  # Triggers auto-deploy
```

Or manually:
```bash
vercel --prod
```

### **Step 3: Verify CEO Account**

The CEO account is automatically created on first deployment:

```bash
# Check Vercel function logs - you should see:
[Accounts] CEO created: ceo@techins.com
⚠️  CEO ACCOUNT - Direct login enabled for: ceo@techins.com
```

### **Step 4: Test CEO Login**

```bash
curl -X POST https://your-app.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ceo@techins.com","password":"YourPasswordHere"}'
```

Expected response:
```json
{
  "success": true,
  "message": "Login successful",
  "token": "eyJhbGc...",
  "user": {
    "id": "...",
    "name": "TECHINS CEO",
    "email": "ceo@techins.com",
    "role": "ceo",
    "department": "Executive",
    "registration_status": "approved"
  }
}
```

---

## 🔒 Security Validations

### Login Validation Flow

```
User enters email + password
    ↓
Is email == CEO_EMAIL?
    ├─ YES → Must have role "ceo" (else FAIL)
    └─ NO  → Cannot have role "ceo" (else FAIL)
    ↓
Is account active?
    └─ NO → FAIL "Account deactivated"
    ↓
Password match (bcrypt)?
    └─ NO → FAIL "Invalid password"
    ↓
✅ LOGIN SUCCESS
    ↓
Generate JWT with role "ceo"
```

### Signup Protection

```
User attempts signup with role "ceo"
    ↓
❌ BLOCKED - "CEO accounts cannot be created through registration"

User attempts signup with CEO_EMAIL
    ↓
❌ BLOCKED - "This email address is reserved"
```

### Access Control

```
Request to CEO-only endpoint
    ↓
Check JWT token
    ↓
Extract role from token
    ↓
role == "ceo"?
    ├─ YES → ✅ Allow access
    └─ NO  → ❌ 403 Forbidden "CEO privileges required"
```

---

## 🛡️ Protection Against Common Attacks

### 1. **Privilege Escalation**
- ❌ Cannot register with CEO role
- ❌ Cannot change own role to CEO via API
- ❌ Cannot use CEO email with different role
- ✅ Only the designated CEO email + password can access CEO role

### 2. **Email Hijacking**
- ❌ Cannot register with CEO email
- ❌ Cannot change email to CEO email
- ✅ CEO email is reserved exclusively for the CEO account

### 3. **Account Takeover**
- ✅ CEO password is hashed with bcrypt (12 rounds)
- ✅ JWT tokens expire after 24 hours
- ✅ Password must be changed from default in production

### 4. **Brute Force**
- ✅ bcrypt automatically rate-limits (slow hashing)
- ✅ Failed login attempts logged
- 💡 Consider adding rate limiting middleware for production

---

## 📝 Environment Variables Reference

### Required

| Variable | Purpose | Example | Security |
|----------|---------|---------|----------|
| `CEO_EMAIL` | CEO login email | `ceo@techins.com` | ⚠️ Change in production |
| `CEO_PASSWORD` | CEO password | `SecurePass123!` | 🔴 **MUST CHANGE** |

### Optional

| Variable | Purpose | Default | Notes |
|----------|---------|---------|-------|
| `CEO_NAME` | Display name | `TECHINS CEO` | Cosmetic only |

---

## 🔧 API Endpoints

### CEO Login

**POST** `/api/auth/login`

```json
{
  "email": "ceo@techins.com",
  "password": "your-password"
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Login successful",
  "token": "JWT_TOKEN_HERE",
  "user": {
    "id": "user_id",
    "name": "TECHINS CEO",
    "email": "ceo@techins.com",
    "role": "ceo",
    "department": "Executive",
    "registration_status": "approved"
  }
}
```

### Get Current User (Authenticated)

**GET** `/api/auth/me`

**Headers**:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

**Response** (200 OK):
```json
{
  "success": true,
  "user": {
    "id": "user_id",
    "name": "TECHINS CEO",
    "email": "ceo@techins.com",
    "role": "ceo",
    "department": "Executive",
    "active": 1,
    "registration_status": "approved"
  }
}
```

---

## 🚫 Blocked Operations

### Cannot Register as CEO

**POST** `/api/auth/signup`

```json
{
  "email": "someone@example.com",
  "password": "password",
  "role": "ceo"
}
```

**Response** (403 Forbidden):
```json
{
  "success": false,
  "message": "CEO accounts cannot be created through registration. Contact system administrator."
}
```

### Cannot Use CEO Email

**POST** `/api/auth/signup`

```json
{
  "email": "ceo@techins.com",
  "password": "password",
  "role": "student"
}
```

**Response** (403 Forbidden):
```json
{
  "success": false,
  "message": "This email address is reserved and cannot be used for registration."
}
```

---

## 🔐 Using CEO Authorization Middleware

### For CEO-Only Endpoints

```javascript
const { authorizeCEO } = require("./middleware/authMiddleware");

// Only CEO can access
router.get("/ceo/dashboard", authenticateToken, authorizeCEO, (req, res) => {
  // req.user.role === "ceo" guaranteed
  res.json({ message: "Welcome to CEO Dashboard" });
});
```

### For CEO + Admin Access

```javascript
const { authorizeRoles } = require("./middleware/authMiddleware");

// CEO or Admin can access
router.get("/admin/users", authenticateToken, authorizeRoles("ceo", "admin"), (req, res) => {
  // req.user.role is either "ceo" or "admin"
  res.json({ message: "User management" });
});
```

---

## 🧪 Testing

### Test CEO Account Creation

1. Deploy to Vercel with CEO_EMAIL and CEO_PASSWORD set
2. Check Vercel logs for:
   ```
   [Accounts] CEO created: ceo@techins.com
   ⚠️  CEO ACCOUNT - Direct login enabled for: ceo@techins.com
   ```

### Test CEO Login

```bash
# Should succeed
curl -X POST https://your-app.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ceo@techins.com","password":"ceo@2006"}'
```

### Test CEO Protection

```bash
# Should fail with 403
curl -X POST https://your-app.vercel.app/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password","role":"ceo","name":"Test"}'
```

---

## 🚨 Production Checklist

Before going to production:

- [ ] Set `CEO_EMAIL` in Vercel to your actual CEO email
- [ ] Set `CEO_PASSWORD` in Vercel to a strong password (min 12 chars)
- [ ] **DO NOT** use the default password `ceo@2006`
- [ ] Verify CEO can log in successfully
- [ ] Verify non-CEO accounts cannot access CEO resources
- [ ] Verify CEO email cannot be used for registration
- [ ] Test CEO-only endpoints with `authorizeCEO` middleware
- [ ] Review Vercel logs for security violations

---

## 📊 Database Schema

CEO account in MongoDB:

```javascript
{
  _id: ObjectId("..."),
  name: "TECHINS CEO",
  email: "ceo@techins.com",
  password: "$2a$12$...",  // bcrypt hashed
  role: "ceo",
  department: "Executive",
  active: 1,
  registration_status: "approved",
  is_ceo: true,  // Special marker
  created_at: "2024-10-10T12:00:00.000Z"
}
```

---

## ⚠️ Important Notes

1. **Only ONE CEO**: The system supports exactly one CEO account
2. **No Registration**: CEO account is created automatically on startup
3. **Direct Login**: CEO logs in immediately without approval workflow
4. **Email Reserved**: CEO email cannot be used by anyone else
5. **Role Protected**: CEO role cannot be assigned to other emails
6. **Password Hashed**: CEO password is hashed with bcrypt (12 rounds)
7. **Change Defaults**: Must change CEO_EMAIL and CEO_PASSWORD in production

---

## 🔧 Troubleshooting

### CEO Cannot Login

**Check**:
1. CEO_EMAIL matches login email exactly (case-insensitive)
2. CEO_PASSWORD is correct (check Vercel env vars)
3. Account exists in database (check logs for "CEO created")
4. Account is active (`active: 1`)

### "Invalid email or password" Error

**Possible causes**:
1. Email doesn't match CEO_EMAIL in Vercel
2. Password is incorrect
3. CEO account not created yet (redeploy)

### "Access denied. CEO privileges required"

**Cause**: User is not logged in as CEO

**Solution**: Ensure JWT token has `role: "ceo"`

---

## ✅ Summary

- ✅ CEO account created automatically with designated email
- ✅ Direct login without registration or approval
- ✅ Only ONE CEO email allowed (from environment variable)
- ✅ CEO email reserved - cannot be used by others
- ✅ CEO role protected - cannot be accessed with other emails
- ✅ Password hashed with bcrypt (12 rounds)
- ✅ Signup protection prevents CEO registration
- ✅ Login validation enforces email-role matching
- ✅ `authorizeCEO` middleware for CEO-only endpoints
- ✅ Security logs for violation attempts

**The CEO has complete direct login access with maximum security! 🔐**
