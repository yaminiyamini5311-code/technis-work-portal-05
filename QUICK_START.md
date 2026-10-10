# CEO Notification Authorization - Quick Start

## What Was Built

✅ **Backend authorization system** that ensures only 71 authorized users (67 students + 4 managers) can trigger CEO Portal notifications  
✅ **Permanent MongoDB Atlas storage** for authorized user whitelist  
✅ **INSERT-ONLY seed script** that is safe to run multiple times  
✅ **Admin API** for managing authorized users  
✅ **Complete documentation** and test suite

## Immediate Next Steps

### 1. Update MongoDB Credentials (REQUIRED)

Edit `server/.env` and replace placeholder password:

```bash
# Current (INVALID):
MONGODB_URI=mongodb+srv://techins_portal:YOUR_URL_ENCODED_PASSWORD@cluster0.ufz2i77.mongodb.net/?appName=Cluster0

# Change to actual password:
MONGODB_URI=mongodb+srv://techins_portal:ACTUAL_PASSWORD_HERE@cluster0.ufz2i77.mongodb.net/?appName=Cluster0
```

### 2. Backup Database (REQUIRED)

```bash
# From project root:
mongodump --uri "$MONGODB_URI" --out ./backup-$(date +%Y-%m-%d-%H%M%S)

# Verify backup exists:
ls -lah ./backup-*
```

### 3. Seed Authorized Users (REQUIRED)

```bash
cd server
npm run seed:authorized
```

**Expected output:**
```
Total to seed: 67 students + 4 managers = 71
✓ Connected to MongoDB Atlas
Inserted: 71 new records (or 0 if already seeded)
Total active authorized users: 71
Active students: 67
Active managers: 4
✅ PASS: All counts match expected values
✅ PASS: All 67 learner IDs present
🎉 Seed completed successfully!
```

### 4. Run Tests (RECOMMENDED)

```bash
node scripts/testAuthorization.js
```

**Expected:** All 8 tests pass

### 5. Deploy

```bash
git push origin main
```

Vercel will auto-deploy.

## Verification After Deploy

### Test 1: Authorized Student Can Trigger Notification

1. Login to app as `yamini.k@techins60.com` (or any T60-xxx student)
2. Perform action that triggers CEO notification (e.g., register account, submit task outcome)
3. Login as CEO
4. Check CEO Portal - notification should appear ✅

### Test 2: Unauthorized User Cannot Trigger Notification

1. Create account with email NOT in authorized list (e.g., `test@example.com`)
2. Login and perform same action
3. Check CEO Portal - NO notification should appear ❌
4. Check server logs - should see: `[CeoNotification] Unauthorized email attempted notification`

### Test 3: Manager Can Trigger Notification

1. Login as `manager1@techins.com` (or manager2-4)
2. Perform action
3. Check CEO Portal - notification should appear ✅

## What Changed

### New Files
- `server/models/AuthorizedUser.js` - Model with authorization logic
- `server/utils/ceoNotification.js` - Helper function with authorization check
- `server/routes/authorizedUsersRoutes.js` - Admin API
- `server/scripts/seedAuthorized.js` - Seed script (INSERT-ONLY)
- `server/scripts/testAuthorization.js` - Test suite
- `server/AUTHORIZATION_SYSTEM.md` - Full documentation
- `VERIFICATION_REPORT.md` - Detailed verification report

### Modified Files
- `server/routes/authRoutes.js` - Registration notifications now check authorization
- `server/routes/taskRoutes.js` - Task outcome notifications now check authorization
- `server/server.js` - Added `/api/authorized-users` route
- `server/mongodb.js` - Added indexes for authorized_users collection
- `server/package.json` - Added `seed:authorized` script

## Admin API Routes

All routes require admin or CEO authentication.

### View Stats
```bash
curl http://localhost:5000/api/authorized-users/stats \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### List All Authorized Users
```bash
curl http://localhost:5000/api/authorized-users?page=1&limit=50 \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Deactivate User (Soft Delete)
```bash
curl -X PATCH http://localhost:5000/api/authorized-users/demo@techins60.com/deactivate \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Reactivate User
```bash
curl -X PATCH http://localhost:5000/api/authorized-users/demo@techins60.com/reactivate \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Delete User (Hard Delete - Requires Confirmation)
```bash
curl -X DELETE http://localhost:5000/api/authorized-users/demo@techins60.com \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"adminConfirmed": true}'
```

## Authorized Users

**Managers (4):**
- manager1@techins.com
- manager2@techins.com
- manager3@techins.com
- manager4@techins.com

**Students (67):**
- T60-001 to T60-067 (including Demo at T60-067)
- See `server/scripts/seedAuthorized.js` for complete list

## Safety Features

✅ **No destructive operations** - Seed script uses INSERT-ONLY `$setOnInsert`  
✅ **Idempotent** - Safe to run seed multiple times  
✅ **Fail closed** - If authorization check fails, no notification created  
✅ **Audit logging** - All deletions logged  
✅ **Deletion protection** - Requires explicit `adminConfirmed: true`  
✅ **Email from JWT** - Uses `req.user.email`, NEVER from request body

## Troubleshooting

### "bad auth: authentication failed"
- Update MONGODB_URI in server/.env with correct password

### Counts don't match (not 67 + 4 = 71)
```bash
# Check MongoDB Atlas directly:
db.authorized_users.countDocuments({ role: "student", active: true })  // Should be 67
db.authorized_users.countDocuments({ role: "manager", active: true })  // Should be 4
```

### Notification not appearing
1. Check if user is authorized:
   ```bash
   db.authorized_users.findOne({ email: "user@example.com" })
   ```
2. Check server logs for: `[CeoNotification] Unauthorized email attempted notification`
3. Verify JWT contains correct email

## Documentation

📖 **Full documentation:** `server/AUTHORIZATION_SYSTEM.md`  
📋 **Verification report:** `VERIFICATION_REPORT.md`

## Support Commands

```bash
# Run seed
npm run seed:authorized

# Run tests
node scripts/testAuthorization.js

# Check database
mongosh "$MONGODB_URI"
> use techins
> db.authorized_users.countDocuments({ active: true })

# View server logs
npm start  # or check Vercel logs
```

---

**Last Updated:** 2026-10-10  
**Status:** Ready to deploy (requires MongoDB credentials)
