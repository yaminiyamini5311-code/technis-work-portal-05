# PHASE 1 - INVESTIGATION REPORT (IN PROGRESS)

## Investigation Status: AWAITING VERCEL LOGS

### Evidence Gathered So Far:

#### 1. **VERCEL CONFIGURATION**
- **vercel.json**: No `maxDuration` specified (defaults to plan limit)
- **Plan timeout**: UNKNOWN - requires user to check Vercel dashboard
- **Hypothesis**: Free tier = 10s, Hobby = 10s, Pro = 60s, Enterprise = 900s

#### 2. **DATABASE CONNECTION** ✅ VERIFIED CORRECT
**File**: `server/mongodb.js`
- ✅ Global connection caching implemented correctly
- ✅ `_client`, `_db`, `_connecting` cached for warm invocations
- ✅ Connection reused across requests (serverless-safe)
- ✅ Timeout settings: 20s server selection, 20s connect, 45s socket
- ✅ No unhandled promise rejections outside try/catch
- **VERDICT**: DB connection is properly cached and will NOT cause 502

#### 3. **GOOGLE DRIVE OPERATIONS** ⚠️ POTENTIAL TIMEOUT RISK
**File**: `server/utils/driveStorage.js`

**Timeout Risk Areas:**
- `uploadToDrive()`: No timeout wrapper (line 221)
- `ensureTaskFolder()`: Creates folders sequentially (line 185)
  - Calls `ensureStudentFolder()` → `getStudentsRootFolder()` → `ensureFolder()`
  - Each folder check hits Google Drive API
  - For legacy tasks without cached folders: 3-4 sequential Drive API calls
  - Each API call uses `retry()` with 4 attempts and exponential backoff
  - Worst case: 4 attempts × 2^3 × 500ms = 4 seconds PER API call
  - Total potential: 4 calls × 4 seconds = **16+ seconds just for folders**

**Retry Logic** (line 63):
```javascript
async function retry(fn, attempts) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      if (!retryable || i === attempts - 1) throw e;
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 500));
    }
  }
}
```
- 4 retry attempts
- Exponential backoff: 500ms, 1s, 2s, 4s
- Total max per call: 7.5 seconds
- With multiple sequential calls: **30+ seconds possible**

**HYPOTHESIS**: On Vercel Free/Hobby tier (10s timeout), Drive operations for legacy tasks with uncached folders will timeout → 502

#### 4. **FILE SIZE LIMIT MISMATCH** 🔴 CONFIRMED BUG
**Server**: 4 MB per file
**Client**: 4 MB per file
**Comment**: Code says "5 MB" but validates 4 MB
**Vercel**: ~4.5 MB total body limit (platform level)

**Evidence**:
- `server/routes/taskRoutes.js` line 70: `fileSize: 4 * 1024 * 1024`
- `server/routes/taskRoutes.js` line 2661: `process.env.GOOGLE_DRIVE_UPLOAD_MAX_BYTES || 5 * 1024 * 1024` (MISMATCH)
- `client/src/pages/student/TaskDetail.jsx` line 18: `const MAX_BYTES = 4 * 1024 * 1024;`
- `client/src/pages/student/MyTasks.jsx`: Uses 4 MB validation

**REQUIRED FIX**: Update all to 4 MB consistently and update UI text to say "4 MB"

#### 5. **PREVIOUS TASKS NOT OPENING** - TO INVESTIGATE
Status: NOT YET INVESTIGATED
Need to check:
- Route parameters (ID format)
- Task fetch endpoint filters
- Assignment lookup for legacy tasks
- Status/date filtering

#### 6. **CEO PORTAL SUBMISSIONS** - TO INVESTIGATE
Status: NOT YET INVESTIGATED
Need to verify:
- Query filters on `/api/tasks/submissions`
- String vs ObjectId matching
- Status field values
- Populate/join logic

#### 7. **SUCCESS POPUP LOGIC** - TO INVESTIGATE
Status: NOT YET INVESTIGATED
Need to verify:
- Only shows after 2xx + success:true
- Error handling prevents popup on failure

---

## TIMING LOGS ADDED

Added comprehensive timing logs to:
1. `POST /:id/submit` endpoint (taskRoutes.js lines 2896+)
   - loadStudentTask timing
   - storeSubmissionVersion timing
   - transition timing
   - syncTaskWorkflow timing
   - notifyAdmins timing
   - Total request timing
   - Error timing with full stack trace

2. `storeSubmissionVersion` function (taskRoutes.js lines 2594+)
   - nextSubmissionCode timing
   - submissions.insertOne timing
   - ensureTaskFolder timing (Drive folder creation)
   - uploadToDrive timing per file
   - Error stack traces for Drive operations

---

## REQUIRED FROM USER: VERCEL LOGS

**Please provide Vercel function logs showing:**
1. A failed `POST /api/tasks/:id/submit` request for a PREVIOUS task
2. Look for:
   - `[SUBMIT TIMING]` log lines
   - `[STORE TIMING]` log lines
   - Function duration (total execution time)
   - Any timeout messages from Vercel
   - Stack traces from `[SUBMIT ERROR]` or `[Submit]` logs
3. Check Vercel dashboard for:
   - Current plan and function timeout limit
   - Any 502/504 gateway errors in logs
   - maxDuration setting (if any)

---

## NEXT STEPS AFTER RECEIVING LOGS:

1. **Identify the bottleneck** from timing logs
2. **Confirm timeout** vs crash vs unhandled exception
3. **Phase 2 fixes**:
   - Add timeout wrapper around Drive operations (5-8 second limit)
   - Handle Drive timeout gracefully (return clear error, don't crash)
   - Fix file size mismatch
   - Fix previous tasks not opening
   - Fix CEO Portal display
   - Fix success popup logic
4. **Phase 3 testing**
5. **Phase 4 git commit and push**
