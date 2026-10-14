# Task Button Visibility Fix - Verification Report

## Date: 2026-10-14

## Issue
Students assigned to the same task (batch assignments or CEO/Management assignments) were not seeing Start Task or Submit Task buttons, even though they were correctly assigned and had never submitted.

## Root Cause

**The global `task.workflow_status` was being used to determine per-student button visibility.**

When ANY student submitted a task:
1. The submit endpoint called `transition(db, task, "Submitted", ...)` 
2. This updated `task.workflow_status = "Submitted"` (global, affects all students)
3. The frontend checked `task.workflow_status` to show/hide buttons
4. Result: All students saw `workflow="Submitted"`, hiding buttons for everyone

### Evidence from Diagnosis

Task TNS-2026-0050 ("Batch Task Alpha"):
- 68 students assigned
- 1 student (Hariram S) submitted
- Global workflow_status changed to "Submitted"
- **67 students without submissions lost their Start/Submit buttons**

Before fix:
```javascript
// Frontend used global task.workflow_status
const workflow = task.workflow_status; // "Submitted" for everyone!
const showStart = workflow === "Assigned"; // false for all
const canSubmit = ["In Progress", "Revision Required", "Acknowledged", "Assigned"].includes(workflow); // false for all
```

## The Fix

### Backend Change (server/routes/taskRoutes.js)

**Endpoint:** `GET /api/tasks/:id/my-submission-status`

**Before:**
```javascript
let studentWorkflowStatus = null;
if (submission) {
  studentWorkflowStatus = submission.status;
} else if (assignment) {
  // Only mapped revision_required and approved
  if (assignment.status === "revision_required") {
    studentWorkflowStatus = "Revision Required";
  } else if (assignment.status === "approved") {
    studentWorkflowStatus = "Approved";
  }
  // assigned and in_progress returned NULL
}
```

**After:**
```javascript
let studentWorkflowStatus = null;
if (submission) {
  studentWorkflowStatus = submission.status;
} else if (assignment) {
  // Map ALL assignment statuses to workflow statuses
  const statusMap = {
    "assigned": "Assigned",
    "in_progress": "In Progress",
    "submitted": "Submitted",
    "revision_required": "Revision Required",
    "approved": "Approved"
  };
  studentWorkflowStatus = statusMap[assignment.status] || "Assigned";
}
```

### Frontend Change (client/src/pages/student/MyTasks.jsx)

**Before:**
```javascript
// Used global task.workflow_status first
const workflow = task.workflow_status || ...fallback;
const needsRevision = workflow === "Revision Required" || task.student_workflow_status === "Revision Required";
const canSubmit = ["In Progress", ...].includes(workflow) && ...;
```

**After:**
```javascript
// Use per-student status first, only fall back to global if no per-student status exists
const studentStatus = task.student_workflow_status;
const workflow = studentStatus || task.workflow_status || ...fallback;
const needsRevision = workflow === "Revision Required";
const canSubmit = ["In Progress", ...].includes(workflow) && ...;
```

## Verification Results

### Test Case: Task TNS-2026-0050 (After Fix)

Global `workflow_status`: "Submitted"

| Student | assignment.status | has_submission | studentWorkflowStatus | workflow (used) | Start Button | Submit Button |
|---------|-------------------|----------------|----------------------|-----------------|--------------|---------------|
| Hariram S | submitted | ✓ true | Submitted | Submitted | ❌ false | ❌ false |
| Kanishka RP | assigned | ❌ false | **Assigned** | **Assigned** | **✅ true** | **✅ true** |
| Haashish P | assigned | ❌ false | **Assigned** | **Assigned** | **✅ true** | **✅ true** |

**Result:** ✅ Students who haven't submitted now correctly see both Start and Submit buttons!

### All Tests Pass

```
server tests: ✅ 62/62 passing
client build: ✅ success
lint: ⚠️ pre-existing warnings only
```

## Behavior After Fix

### For Students Who HAVE Submitted
- assignment.status = "submitted"
- studentWorkflowStatus = "Submitted"
- Buttons correctly hidden ✅

### For Students Who HAVE NOT Submitted
- assignment.status = "assigned" (or "in_progress" if they clicked Start)
- studentWorkflowStatus = "Assigned" (or "In Progress")
- **Buttons now visible** ✅ (FIXED)

### Edge Cases Preserved
1. **Revision Requested:** Student who submitted can resubmit ✅
2. **Batch Assignments:** Each student's state is independent ✅
3. **CEO/Management Assignments:** Both paths work identically ✅
4. **Legacy single-student assignments:** Unaffected ✅

## Impact

### ✅ Fixed
- Batch task assignments (CEO/Management)
- Multi-student task assignments
- Per-student button visibility for all assignment types

### ✅ Preserved
- Existing authorization checks
- Task deadlines and start windows
- Submission workflow (submit → review → approve/revise)
- Version history and resubmission
- File uploads and Drive integration
- Mobile layout

### ❌ Not Changed
- Database schema (no migrations needed)
- Task assignment logic
- Submission recording
- Review/approval flow
- Any other features

## Files Changed

1. `server/routes/taskRoutes.js` - Backend endpoint fix (11 lines)
2. `client/src/pages/student/MyTasks.jsx` - Frontend logic fix (12 lines)
3. `server/diagnose-button-visibility.js` - Diagnostic script (added)

**Total diff:** ~23 lines changed, minimal impact, surgical fix

## Commit

```
f24899a fix: Use per-student status for task button visibility
```

Branch: `fix/task-button-visibility`
Status: ✅ Ready for review/merge (NOT pushed, NOT deployed)
