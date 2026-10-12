# Task Assignment Issue - Diagnosis & Fix

## Problem
CEO assigns tasks through the CEO Portal, but assigned tasks don't appear in the Student Portal.

## Root Cause Analysis

### How Task Assignment Works
1. **CEO creates task** → POST /api/tasks
2. **Backend creates task record** → `tasks` collection
3. **Backend creates assignments** → `task_assignments` collection (one per student)
4. **Student fetches tasks** → GET /api/tasks/my
5. **Backend queries assignments** → finds task IDs where student_id matches
6. **Backend returns tasks** → fetches full task documents

### Verified Working Components ✅
- ✅ CEO form sends correct data (student_ids, batch_id, all detail fields)
- ✅ Backend endpoint calls `createAssignmentsForStudents()` (line 444-451 in taskRoutes.js)
- ✅ Database has `task_assignments` collection with proper indexes
- ✅ Student endpoint queries `task_assignments` correctly
- ✅ Local testing shows complete flow works end-to-end

### Possible Failure Points ❌

1. **Server never started after code changes**
   - Indexes not created (mongodb.js line 117-121)
   - Solution: Restart server

2. **Error during assignment creation**
   - Silent failure in createAssignmentsForStudents()
   - Check server logs during task creation

3. **Production database out of sync**
   - Old tasks created before task_assignments system was added
   - Solution: Run backfill script

4. **Student not active or not approved**
   - active !== 1 or registration_status !== "approved"
   - Check user record

5. **Wrong ObjectId format**
   - Student ID not a valid MongoDB ObjectId
   - Fixed in commit 732d7d2

## Diagnostic Steps

### Step 1: Run Production Diagnostic
```bash
# Connect to production database
MONGODB_URI="your-production-mongodb-uri" node server/diagnose-production-task-issue.js
```

This will show:
- ✅ Collections exist
- ✅ Indexes exist
- ✅ Data counts match
- ✅ Recent tasks have assignments
- ✅ Sample student can see tasks

### Step 2: Check Specific Student
If diagnostic shows issues, check the specific student who can't see tasks:

```bash
# In MongoDB shell or Compass
db.users.findOne({ email: "student@email.com" })
# Verify: role="student", active=1, registration_status="approved"
```

### Step 3: Check Specific Task
```bash
# Find the task CEO created
db.tasks.findOne({ task_code: "TASK-XXX" })
# Note the _id

# Check if assignment exists
db.task_assignments.find({ task_id: "the-task-id-from-above" })
# Should show one record per assigned student
```

## Fixes

### Fix 1: Backfill Missing Assignments
If tasks exist but task_assignments don't:

```bash
# Development
node server/scripts/backfill-task-assignments.js

# Production
MONGODB_URI="your-production-uri" node server/scripts/backfill-task-assignments.js
```

This script:
- ✅ Finds all tasks
- ✅ Resolves target students (batch, individual, program, group)
- ✅ Creates missing task_assignments
- ✅ Idempotent (safe to run multiple times)

### Fix 2: Ensure Indexes
Restart your production server to trigger index creation:

```bash
# Vercel
git push  # Triggers redeployment

# Manual server
pm2 restart app
# or
systemctl restart your-app
```

### Fix 3: Verify Student Records
If specific students can't see tasks:

```javascript
// Check student status
db.users.updateOne(
  { email: "student@email.com" },
  { $set: { active: 1, registration_status: "approved" } }
)
```

## Prevention

### 1. Monitor Server Logs
During task creation, watch for errors:
```bash
# Look for
"Task assignment error:"
"Unable to create task"
"TaskAssignment model error"
```

### 2. Automated Tests
Run the test suite before deploying:
```bash
node server/test-task-assignment-flow.js
```

Should show:
```
✅ Test student created
✅ Test task created  
✅ Task assignment created
✅ Student can see 1 task(s)
✅ ALL DETAIL FIELDS PRESENT
```

### 3. Health Check Endpoint
Add to server (optional):
```javascript
router.get('/health/assignments', async (req, res) => {
  const tasks = await db.collection('tasks').countDocuments();
  const assignments = await db.collection('task_assignments').countDocuments();
  res.json({ tasks, assignments, ratio: assignments / tasks });
});
```

Expected ratio:
- Batch tasks: ratio > 1 (multiple students per task)
- Individual tasks: ratio ≈ 1
- **Red flag**: ratio = 0 (no assignments created!)

## Testing After Fix

### Test Case 1: Individual Assignment
1. Login as CEO
2. Create new task, select "Individual Student"
3. Choose a specific student
4. Fill all fields (description, expected_output, how_to_do, submission_requirements)
5. Submit

**Verify**:
- Task created successfully message appears
- Task shows in CEO's task list
- Login as that student
- Task appears in Student Portal
- All 4 detail fields visible

### Test Case 2: Batch Assignment
1. Login as CEO
2. Create new task, select "Batch"
3. Choose a batch (e.g., "Techins 60")
4. Fill all fields
5. Submit

**Verify**:
- Message shows "Task assigned to X students"
- Login as multiple students from that batch
- All see the task
- Students from other batches don't see it

### Test Case 3: Existing Tasks
1. Use diagnostic script to verify old tasks
2. Run backfill script if needed
3. Login as student who should have old tasks
4. Verify they now appear

## Files Modified/Created

### Core System (Already Working)
- `server/routes/taskRoutes.js` - Task creation & assignment
- `server/models/TaskAssignment.js` - Assignment management
- `server/mongodb.js` - Index creation
- `client/src/pages/admin/Tasks.jsx` - CEO form
- `client/src/pages/student/MyTasks.jsx` - Student view

### Diagnostic Tools (New)
- `server/diagnose-production-task-issue.js` - Production diagnostics
- `server/test-task-assignment-flow.js` - End-to-end test
- `server/scripts/backfill-task-assignments.js` - Repair tool

## Summary

The task assignment system is **correctly implemented** in the codebase. If tasks aren't appearing:

1. **Most likely**: Tasks created before the task_assignments system → Run backfill script
2. **Possible**: Server never restarted after code update → Restart to create indexes
3. **Rare**: Student record issue → Verify active=1, registration_status="approved"

Run the diagnostic script first to identify the exact issue, then apply the appropriate fix.
