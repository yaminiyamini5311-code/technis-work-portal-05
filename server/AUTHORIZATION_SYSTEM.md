# CEO Portal Notification Authorization System

## Overview

This system ensures that **only authorized users** (67 students + 4 managers = 71 total) can trigger CEO Portal notifications. Authorization is enforced on the backend by checking the authenticated user's email against the `authorized_users` collection in MongoDB Atlas.

## Key Features

✅ **Permanent Storage**: All 71 authorized user records are stored in MongoDB Atlas and survive restarts, redeploys, and reconnections  
✅ **Backend Enforcement**: Authorization check happens on the server using `req.user.email` from JWT, NOT from request body  
✅ **INSERT-ONLY Seeding**: Seed script is idempotent and never overwrites existing records  
✅ **Fail Closed**: If authorization check fails or DB is unreachable, no notification is created  
✅ **No Password Storage**: This collection does NOT store passwords (passwords are in the users collection)  
✅ **Audit Logging**: All deletions and modifications are logged for compliance  

## Architecture

### 1. AuthorizedUser Model (`models/AuthorizedUser.js`)

**Schema:**
```javascript
{
  email: String,        // required, unique, lowercase, trimmed
  role: String,         // 'student' | 'manager', required
  learnerId: String,    // unique, sparse; students only (e.g., T60-001)
  name: String,         // full name
  isDemo: Boolean,      // default false; label only, does not affect authorization
  active: Boolean,      // default true; deactivate instead of deleting
  createdAt: Date,
  updatedAt: Date
}
```

**Key Functions:**
- `isAuthorized(db, email)` - Returns true if email is authorized and active
- `findByEmail(db, email)` - Get user details by email
- `deactivate(db, email, adminId)` - Deactivate a user (preferred over deletion)
- `reactivate(db, email, adminId)` - Reactivate a user
- `deleteByEmail(db, email, adminId, adminConfirmed)` - Hard delete (requires explicit confirmation)
- `getStats(db)` - Get counts of total, active, students, and managers

### 2. CEO Notification Helper (`utils/ceoNotification.js`)

**Main Function:**
```javascript
createCeoNotification(db, senderEmail, payload)
```

**Parameters:**
- `db` - MongoDB database instance
- `senderEmail` - Email from `req.user.email` (authenticated user), NEVER from request body
- `payload` - Object with `{ type, title, message, related_task_id? }`

**Behavior:**
1. Validates inputs
2. Checks if `senderEmail` is in `authorized_users` collection with `active: true`
3. If unauthorized: returns false (silent failure, no leak of authorization status)
4. If authorized: creates notifications for all CEO/admin users
5. Logs sender email in notification for audit trail

**Also Provides:**
```javascript
createUserNotification(db, userId, payload)
```
For regular user-to-user notifications (no authorization check needed).

### 3. Seed Script (`scripts/seedAuthorized.js`)

**Usage:**
```bash
npm run seed:authorized
```

**What it does:**
- Connects to MongoDB Atlas using `MONGODB_URI` from .env
- Uses `bulkWrite` with `$setOnInsert` and `upsert: true`
- Inserts 67 students + 4 managers (71 total)
- NEVER overwrites, resets, or deletes existing records
- Validates counts after seeding
- Safe to run multiple times (idempotent)

**Expected Output:**
```
Inserted: X new records
Matched existing: Y records (no changes)
Total active authorized users: 71
Active students: 67
Active managers: 4
✅ PASS: All counts match expected values
✅ PASS: All 67 learner IDs present
✅ PASS: No duplicate emails
```

### 4. Admin API Routes (`routes/authorizedUsersRoutes.js`)

All routes require `admin` or `ceo` role.

**Endpoints:**

```
GET    /api/authorized-users/stats          - Get statistics
GET    /api/authorized-users                - List all (paginated)
GET    /api/authorized-users/:email         - Get by email
PATCH  /api/authorized-users/:email         - Update (name, learnerId, isDemo)
PATCH  /api/authorized-users/:email/deactivate   - Deactivate (soft delete)
PATCH  /api/authorized-users/:email/reactivate   - Reactivate
DELETE /api/authorized-users/:email         - Delete (requires { adminConfirmed: true })
```

**Example - Deactivate a user:**
```bash
curl -X PATCH http://localhost:5000/api/authorized-users/demo@techins60.com/deactivate \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

**Example - Hard delete (with confirmation):**
```bash
curl -X DELETE http://localhost:5000/api/authorized-users/demo@techins60.com \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"adminConfirmed": true}'
```

## Authorized Users

### Managers (4)
```
manager1@techins.com
manager2@techins.com
manager3@techins.com
manager4@techins.com
```

### Students (67)
T60-001 to T60-067, including:
- T60-063: Yamini K (yamini.k@techins60.com)
- T60-067: Demo (demo@techins60.com) - isDemo: true, but fully authorized

See `scripts/seedAuthorized.js` for complete list.

## Integration

### Updated Files

1. **`routes/authRoutes.js`**
   - Registration notifications now use `createCeoNotification(db, email, {...})`
   - Only authorized student emails trigger CEO notifications

2. **`routes/taskRoutes.js`**
   - Task outcome notifications use `createCeoNotification(db, req.user.email, {...})`
   - Submission/feedback notifications use `createUserNotification(...)` (no auth check needed)

3. **`server/server.js`**
   - Registered `/api/authorized-users` route

4. **`mongodb.js`**
   - Added indexes for `authorized_users` collection

## Setup & Deployment

### First Time Setup

1. **Ensure MONGODB_URI is configured:**
   ```bash
   # server/.env
   MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/dbname
   ```

2. **Seed authorized users:**
   ```bash
   cd server
   npm run seed:authorized
   ```

3. **Verify seeding:**
   ```bash
   node scripts/testAuthorization.js
   ```

### Deploy to Vercel

The seed script should be run **once** before first deploy or after any authorization list changes.

```bash
# On local machine with MongoDB access:
npm run seed:authorized

# Then deploy:
git push origin main
# Vercel auto-deploys
```

### Re-running Seed (Safe)

The seed script is idempotent and safe to run multiple times:

```bash
npm run seed:authorized
# Output will show:
# Inserted: 0 new records (if already seeded)
# Matched existing: 71 records (no changes)
```

## Verification Checklist

Run these checks after seeding:

### 1. Seed Output
```bash
npm run seed:authorized
```
**Expected:** 67 students + 4 managers = 71, all learner IDs present, no duplicates

### 2. Database Query
```javascript
// MongoDB Atlas console or compass:
db.authorized_users.countDocuments({ role: "student", active: true })
// Expected: 67

db.authorized_users.countDocuments({ role: "manager", active: true })
// Expected: 4

db.authorized_users.find({ active: true }).count()
// Expected: 71
```

### 3. Learner ID Check
```javascript
db.authorized_users.find(
  { role: "student", active: true },
  { learnerId: 1, _id: 0 }
).sort({ learnerId: 1 })
// Expected: T60-001, T60-002, ..., T60-067 (no gaps)
```

### 4. Test Authorization
```bash
node scripts/testAuthorization.js
```
**Expected:** All tests pass

### 5. API Test - Authorized Student
```bash
# 1. Login as authorized student (yamini.k@techins60.com)
# 2. Perform an action that triggers CEO notification (e.g., submit task outcome)
# 3. Check CEO portal - notification should appear
```

### 6. API Test - Unauthorized Email
```bash
# 1. Login as user NOT in authorized list
# 2. Perform same action
# 3. Check CEO portal - NO notification should appear
# 4. Server logs should show: "[CeoNotification] Unauthorized email attempted notification"
```

### 7. Test Tampering
```bash
# Attempt to forge authorization by sending authorized email in request body
curl -X POST http://localhost:5000/api/some-endpoint \
  -H "Authorization: Bearer UNAUTHORIZED_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "yamini.k@techins60.com", "data": "..."}'

# Expected: No notification created
# System uses req.user.email from JWT, not request body
```

### 8. Restart Test
```bash
# 1. Run seed: npm run seed:authorized
# 2. Note initial counts and createdAt timestamps
# 3. Restart server or redeploy
# 4. Re-run seed: npm run seed:authorized
# 5. Check counts and timestamps - should be unchanged
```

### 9. DB Connection Failure Test
```bash
# 1. Temporarily set invalid MONGODB_URI
# 2. Start server
# 3. Attempt to trigger notification
# Expected: No notification created, error logged, app doesn't crash
```

## Security Notes

### ✅ Correct Implementation
```javascript
// In route handler:
router.post("/some-endpoint", authenticateToken, async (req, res) => {
  // Use req.user.email from JWT (verified by authenticateToken middleware)
  await createCeoNotification(req.db, req.user.email, {
    type: "some_type",
    title: "Some Title",
    message: "Some message"
  });
  // ...
});
```

### ❌ WRONG - DO NOT DO THIS
```javascript
// WRONG: Never use email from request body
await createCeoNotification(req.db, req.body.email, {...});

// WRONG: Never use email from query params
await createCeoNotification(req.db, req.query.email, {...});

// WRONG: Never use email from headers (except Authorization, which is handled by middleware)
await createCeoNotification(req.db, req.headers['x-user-email'], {...});
```

## Troubleshooting

### No notifications appearing
1. Check if user is in authorized_users: `db.authorized_users.findOne({ email: "user@example.com" })`
2. Check if user is active: `{ active: true }`
3. Check server logs for: `[CeoNotification] Unauthorized email attempted notification`
4. Verify JWT contains correct email: Decode JWT and check `email` claim

### Duplicate key error on seed
- This is expected if emails or learner IDs already exist
- Seed script handles this gracefully
- Check for actual duplicates: `db.authorized_users.aggregate([{$group:{_id:"$email",count:{$sum:1}}},{$match:{count:{$gt:1}}}])`

### Counts don't match (not 67 + 4)
- Check for deactivated users: `db.authorized_users.find({ active: false })`
- Check for missing users: Compare against list in `scripts/seedAuthorized.js`
- Re-run seed (it's safe): `npm run seed:authorized`

## Maintenance

### Adding a New Authorized User

1. **Update seed script:**
   ```javascript
   // In scripts/seedAuthorized.js, add to STUDENTS or MANAGERS array:
   { learnerId: "T60-068", name: "New Student", email: "new.student@techins60.com" }
   ```

2. **Re-run seed:**
   ```bash
   npm run seed:authorized
   ```

3. **Verify:**
   ```bash
   node scripts/testAuthorization.js
   ```

### Removing an Authorized User (Soft Delete)

**Recommended: Deactivate instead of deleting**

```bash
curl -X PATCH http://localhost:5000/api/authorized-users/user@example.com/deactivate \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### Removing an Authorized User (Hard Delete)

**Only if absolutely necessary:**

```bash
curl -X DELETE http://localhost:5000/api/authorized-users/user@example.com \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"adminConfirmed": true}'
```

**Note:** Deletion is logged in audit_logs collection.

## Data Safety Guarantees

✅ **No drop/delete operations** in seed script  
✅ **No overwrites** - existing records are never modified  
✅ **Explicit confirmation** required for hard deletes  
✅ **Audit logging** for all destructive operations  
✅ **Fail closed** - on error, no data is modified  
✅ **Idempotent** - safe to run seed multiple times  

## Files Changed/Created

### Created
- `server/models/AuthorizedUser.js`
- `server/utils/ceoNotification.js`
- `server/routes/authorizedUsersRoutes.js`
- `server/scripts/seedAuthorized.js`
- `server/scripts/testAuthorization.js`
- `server/AUTHORIZATION_SYSTEM.md` (this file)

### Modified
- `server/routes/authRoutes.js` - Use createCeoNotification for registration
- `server/routes/taskRoutes.js` - Use createCeoNotification for task outcomes
- `server/server.js` - Register authorized-users route
- `server/mongodb.js` - Add authorized_users indexes
- `server/package.json` - Add seed:authorized script

### NOT Modified
- `server/.env` - No credentials added
- Database collections - No data dropped or deleted
- User authentication system - Passwords remain in users collection only

## Support

For issues or questions:
1. Check server logs for `[CeoNotification]` and `[AuthorizedUser]` entries
2. Run test script: `node scripts/testAuthorization.js`
3. Check MongoDB Atlas console for `authorized_users` collection
4. Review audit_logs for deletion/modification history
