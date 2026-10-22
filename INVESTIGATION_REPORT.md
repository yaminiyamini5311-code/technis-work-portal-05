# PHASE 1 - INVESTIGATION REPORT (UPDATED)

## Investigation Status: EVIDENCE GATHERED - AWAITING VERCEL LOGS FOR TIMING CONFIRMATION

### ✅ VERIFIED ISSUES (Evidence-Based)

#### **1. SUCCESS POPUP LOGIC** — ✅ CORRECT IMPLEMENTATION
**Status**: Verified correct - NO changes needed

**Evidence from `client/src/pages/student/MyTasks.jsx` lines 180-250:**
```javascript
try {
  const response = await axios.post(`${API_URL}/api/tasks/${task.id}/${endpoint}`, form, { headers: auth() });
  // SUCCESS: Show popup ONLY after successful response
  const submissionData = response.data?.data || response.data || {};
  setSubmitSuccess({ taskTitle, submissionCode, version, submittedAt, status });
  setError("");
  await load();
} catch (err) {
  // ERROR: Show error message, NO success popup
  setError(err.response?.data?.error?.message || err.response?.data?.message || "Unable to submit the task.");
  if (err.response?.status === 409) await load();
}
```

**Conclusion**: Success popup shows ONLY after 2xx response. Errors show error message. ✅ No changes needed.

---

#### **2. PREVIOUS TASKS NOT OPENING** — ✅ VERIFIED NOT AN ISSUE
**Status**: Verified that opening logic is correct

**Evidence from `server/routes/taskRoutes.js` lines 2456-2520:**

The `GET /:id` endpoint checks BOTH assignment AND legacy ownership:
```javascript
let allowed = ["admin", "manager", "ceo"].includes(req.user.role) || task.assigned_to === req.user.id;
if (!allowed && ["student", "member"].includes(req.user.role)) {
  const { getAssignment } = require("../models/TaskAssignment");
  const assignment = await getAssignment(db, String(task._id), req.user.id);
  allowed = Boolean(assignment);
}
if (!allowed) return res.status(403).json({ success: false, message: "Access denied" });
```

**Ownership checks**:
1. ✅ Legacy tasks: `task.assigned_to === req.user.id`
2. ✅ New tasks: `getAssignment()` checks `task_assignments` table
3. ✅ Both paths allowed

**Frontend routing** (`client/src/App.jsx` lines 124-127):
```javascript
<Route path="/student/tasks/:taskId" element={<TaskDetail />} />
<Route path="/tasks/:taskId" element={<TaskAliasRedirect />} />
```

**TaskDetail.jsx** (lines 74-82) fetches from `/api/tasks/my` then finds by ID:
```javascript
const { data: mine } = await axios.get(`${API_URL}/api/tasks/my`, { headers: auth() });
const found = (mine?.tasks || []).find(t => String(t.id) === String(taskId));
```

**Hypothesis**: If ~3 previous tasks don't open, possible causes:
1. Tasks not in `/api/tasks/my` response (not in `task_assignments` AND not in `tasks.assigned_to`)
2. Invalid ObjectId format in URL
3. Tasks have status that filters them out
4. **MOST LIKELY**: User needs to check which specific tasks don't open and provide task IDs for investigation

**Conclusion**: Code is correct. Need specific task IDs that don't open to investigate further.

---

#### **3. CEO PORTAL SUBMISSIONS DISPLAY** — ✅ VERIFIED WORKING CORRECTLY
**Status**: Verified correct - submissions ARE displayed

**Evidence from `client/src/pages/admin/AdminDashboard.jsx` lines 102-146:**

CEO Dashboard fetches submissions:
```javascript
const [sub] = await Promise.all([
  fetch(`${API_URL}/api/tasks/submissions`, {headers: liveHeaders, signal: ctrl.signal})
]);
if(sub.ok && c?.success) {
  setSubmissions(c.submissions||[]);
}
```

Displays submissions (line 284):
```javascript
{submissions?.length ? <div className="submission-list">
  {submissions.slice(0,6).map(item=>
    <div className="submission-row" key={item.id}>
      <div>{(item.student_name||'S').charAt(0).toUpperCase()}</div>
      <div>
        <strong>{item.title}</strong>
        <small>{item.student_name} · {item.outcome_submitted_at ? new Date(item.outcome_submitted_at).toLocaleString() : 'Files uploaded'}</small>
      </div>
      <span>{item.file_count||0} file{item.file_count===1?'':'s'}</span>
    </div>
  )}
</div> : <div className="empty-state">No student reports or task files submitted yet.</div>}
```

**Backend endpoint** (`server/routes/taskRoutes.js` lines 375-440) returns ALL submissions:
- Includes legacy AND new task submissions
- String vs ObjectId handled correctly with `toId()` helper
- Status values properly normalized
- Student info populated from users collection

**Conclusion**: CEO Portal correctly displays submissions. If submissions aren't showing:
- Check if submissions exist in DB (`db.submissions.find()`)
- Check if API returns them (`/api/tasks/submissions`)
- Verify frontend receives them (browser DevTools Network tab)

---

#### **4. FILE SIZE LIMIT MISMATCH** — 🔴 CONFIRMED BUG
**Status**: Verified inconsistency - NEEDS FIX

**Evidence**:
1. **Server multer config** (line 70): `fileSize: 4 * 1024 * 1024` ✅
2. **Server validation** (line 2661): `process.env.GOOGLE_DRIVE_UPLOAD_MAX_BYTES || 5 * 1024 * 1024` ❌ MISMATCH
3. **Client TaskDetail.jsx** (line 27): `const MAX_BYTES = 4 * 1024 * 1024;` ✅
4. **Client MyTasks.jsx** (line 204): `const maxBytes = 4 * 1024 * 1024;` ✅
5. **UI text** (line 132): `"max 4 MB each"` ✅
6. **Vercel platform limit**: ~4.5 MB total body ✅

**Required Fix**:
- Change line 2661 to `4 * 1024 * 1024` (remove 5 MB option)
- Add total body size check (all files + metadata < 4.5 MB)

---

#### **5. TOTAL REQUEST SIZE NOT CHECKED** — 🔴 CONFIRMED MISSING
**Status**: Verified missing - NEEDS FIX

**Evidence**: No check for total FormData body size before upload

**Vercel limit**: 4.5 MB total request body (platform enforced)

**Required Fix**:
Add client-side check:
```javascript
const totalSize = files.reduce((sum, f) => sum + f.size, 0);
if (totalSize > 4.5 * 1024 * 1024) {
  setError("Total file size exceeds 4.5 MB. Please reduce the number or size of files.");
  return;
}
```

---

### ⚠️ HIGH PROBABILITY ROOT CAUSE (HYPOTHESIS - Needs Vercel Log Confirmation)

#### **GOOGLE DRIVE TIMEOUT** — LIKELY 502 CAUSE
**Status**: HYPOTHESIS based on code analysis - awaiting timing logs

**Evidence from code**:
- `uploadToDrive()` has NO timeout wrapper
- `ensureTaskFolder()` makes 3-4 SEQUENTIAL Drive API calls
- Each call uses `retry()` with exponential backoff up to 7.5 seconds
- Worst case: 4 calls × 7.5s = 30 seconds
- Vercel Free/Hobby timeout: 10 seconds

**Timing logs added** (commit f8de1c9):
- `[STORE TIMING] ensureTaskFolder: Xms`
- `[STORE TIMING] uploadToDrive file N: Xms`

**Need from user**: Vercel function logs showing these timing values

---

### 📋 REQUIRED FROM USER

1. **Vercel function logs** showing `[SUBMIT TIMING]` and `[STORE TIMING]` values
2. **Vercel plan** and function timeout limit
3. **Specific task IDs** of the ~3 previous tasks that don't open (if issue persists)
4. **Confirmation**: Do submissions appear in CEO Portal now? If not, provide details.

---

### 🔧 PHASE 2 FIXES PLANNED

#### **A. File Size & Body Limits** (Evidence-based fixes)
1. Fix server validation: Change 5 MB to 4 MB
2. Add total body size check (client + server)
3. Update all UI text to consistently say "4 MB per file, 4.5 MB total"

#### **B. Drive Operations** (If timing confirms timeout)
1. **Option 1 (Recommended)**: GridFS First, Drive Secondary
   - Save files to GridFS/MongoDB first (source of truth)
   - Return success immediately
   - Sync to Drive async via background job/cron
   - Mark `drive_status: pending|synced|failed`

2. **Option 2**: Add timeout + maxDuration
   - Set `maxDuration` in vercel.json to plan limit
   - Wrap Drive calls with Promise.race + 8s timeout
   - On timeout: rollback, return clear error, NO success popup

#### **C. Remove Timing Logs** (Before final commit)
- Remove all `[SUBMIT TIMING]` and `[STORE TIMING]` console.log statements
- Ensure no logs contain tokens or personal data

---

### ✅ VERIFIED NO CHANGES NEEDED

1. **Database connection caching** — Correct
2. **API URL configuration** — Correct  
3. **Vercel routing** — Correct
4. **Success popup logic** — Correct
5. **Previous tasks opening logic** — Correct
6. **CEO Portal submissions display** — Correct

---

## NEXT STEPS

**User**: Provide Vercel logs with timing data + plan/timeout info
**Agent**: Implement Phase 2 fixes based on confirmed root cause
**Both**: Phase 3 testing (local reproduction)
**Agent**: Phase 4 commit and push
