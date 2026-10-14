# CEO Student Submissions - Test Guide

## Overview

The CEO Student Submissions page has been redesigned with a **task-wise view** that shows:
1. All tasks that have received submissions
2. All students who submitted each task
3. Complete submission details for each student

## Features Implemented

### ✅ Three-Tier Navigation

**Level 1: Task List**
- Shows all tasks grouped by task ID
- Displays: task code, title, student count, total submissions, file count
- Click any task to drill down

**Level 2: Students per Task**
- Shows all students who submitted the selected task
- Displays: student name, email, batch, version, timestamp, status
- Click any student to see their submission

**Level 3: Individual Submission Detail**
- Shows complete submission information
- Displays: all versions, files, comments, progress history, review status
- File preview and download functionality
- Approve/request revision workflow

### ✅ Search and Filters

**Available Filters:**
- **Search**: Search by task name, task code, student name, or student email
- **Task Filter**: Filter to specific task (Level 1 only)
- **Batch Filter**: Filter by student batch
- **Status Filter**: Filter by submission status (Submitted, Approved, Revision Required, etc.)
- **Sort Options**:
  - Level 1: Newest/Oldest, Task A-Z, Most students
  - Level 2: Newest/Oldest, Student A-Z, Status A-Z

**Filters persist** across navigation levels - if you filter by batch, it stays filtered when you drill down.

### ✅ Data Source

All data is fetched from MongoDB through these endpoints:
- `/api/tasks/submissions` - All submissions with student and task details
- `/api/tasks` - Task list
- `/api/batches` - Batch list for filters
- `/api/tasks/:id` - Individual task details for submission view
- `/api/tasks/files/:fileId/download` - File download with auth

---

## Testing Workflow

### Prerequisites

1. **Backend deployed and configured** (see `DEPLOYMENT.md`)
2. **At least one student has submitted a task** with files
3. **CEO account** credentials ready

---

### Test 1: Task List View (Level 1)

1. **Log in as CEO**
   - Email: Value from `CEO_EMAIL` env var (e.g., `ceo@techins.com`)
   - Password: The password used to generate `CEO_PASSWORD_HASH`

2. **Navigate to Student Submissions**
   - From CEO dashboard, click "Student Submissions" in navigation
   - OR go directly to `/admin/submissions`

3. **Verify Task List Display**
   - ✅ Tasks are grouped (one card per task)
   - ✅ Each task card shows:
     - Task code (e.g., "TNS-2026-0001")
     - Task title
     - Number of students who submitted (e.g., "3 students submitted")
     - Total submissions (e.g., "5 total submissions" if some students submitted multiple versions)
     - Total files (e.g., "12 files")
   - ✅ Tasks are sorted by newest submissions first

4. **Test Search**
   - Type a task name in search box
   - ✅ Only matching tasks appear
   - Clear search
   - Type a student name
   - ✅ Only tasks where that student submitted appear

5. **Test Task Filter**
   - Click the "Task" dropdown
   - ✅ All tasks are listed
   - Select a specific task
   - ✅ Only that task appears

6. **Test Batch Filter**
   - Click the "Batch" dropdown
   - ✅ All batches are listed
   - Select a specific batch
   - ✅ Only tasks with submissions from that batch appear

7. **Test Status Filter**
   - Click the "Status" dropdown
   - ✅ Statuses include: All statuses, Submitted, Approved, Revision Required, etc.
   - Select "Submitted"
   - ✅ Only tasks with submitted (not reviewed) submissions appear

8. **Test Sort**
   - Select "Oldest first"
   - ✅ Tasks with oldest submissions appear first
   - Select "Task A–Z"
   - ✅ Tasks are alphabetically sorted
   - Select "Most students"
   - ✅ Tasks with most students appear first

9. **Test Refresh**
   - Click "Refresh" button
   - ✅ Data reloads from server
   - ✅ Counts update if new submissions exist

---

### Test 2: Students per Task View (Level 2)

1. **Click on a task** (e.g., "Demo Task")
   - ✅ View changes to show students who submitted this task
   - ✅ Header shows: "STUDENTS FOR: TNS-2026-0001 Demo Task"
   - ✅ Back button (← Back) appears

2. **Verify Student List Display**
   - ✅ Each student card shows:
     - Student name
     - Student email
     - Batch name
     - Version number (e.g., "v1")
     - Submission timestamp (formatted as locale date/time)
     - Submission code (e.g., "SUB-2026-00001")
     - File count (e.g., "2 files")
     - Submission comment preview (first 60 characters)
     - Status pill (color-coded)

3. **Test Search (Student Level)**
   - Type a student name
   - ✅ Only matching students appear
   - Type an email
   - ✅ Only matching students appear

4. **Test Filters (Student Level)**
   - Filters from Level 1 are still active
   - Change batch filter
   - ✅ Only students from selected batch appear
   - Change status filter
   - ✅ Only students with selected status appear

5. **Test Sort (Student Level)**
   - Select "Student A–Z"
   - ✅ Students sorted alphabetically
   - Select "Status A–Z"
   - ✅ Students sorted by status
   - Select "Oldest first"
   - ✅ Students with oldest submissions appear first

6. **Test Back Button**
   - Click "← Back"
   - ✅ Returns to task list (Level 1)
   - ✅ Previous filters are preserved

---

### Test 3: Individual Submission Detail (Level 3)

1. **From Student List, click on a student** (e.g., "Mohan Dhass")
   - ✅ View changes to show complete submission details
   - ✅ Back button appears
   - ✅ Header shows: "SUBMISSION SUB-2026-00001"

2. **Verify Student Information Section**
   - ✅ Shows: Student name, email, phone, program, batch, student ID
   - ✅ Status pill displayed

3. **Verify Task Information Section**
   - ✅ Shows: Task code, task title, description, workflow status

4. **Verify Submitted Work Section (Most Important)**
   - ✅ Shows all submission versions (if student resubmitted)
   - ✅ For each version:
     - Version number and submission code
     - Timestamp
     - Status
     - Comment (if provided)
     - **List of files** with:
       - File name (e.g., "report.pdf", "diagram.png")
       - File size (e.g., "2.3 MB")
       - Preview button (for images/PDFs)
       - Download button

5. **Test File Preview**
   - Find a submitted image file (e.g., `.jpg`, `.png`)
   - Click "👁 Preview" button
   - ✅ Modal opens showing the image
   - ✅ Image loads correctly
   - Click "Close"
   - ✅ Modal closes

   - Find a submitted PDF file
   - Click "👁 Preview" button
   - ✅ Modal opens showing the PDF in iframe
   - ✅ PDF loads correctly
   - Click "Close"

6. **Test File Download**
   - Click "⬇ Download" button on any file
   - ✅ File downloads with original filename
   - ✅ File opens correctly after download
   - ✅ Check browser DevTools → Network:
     - Request to `/api/tasks/files/{fileId}/download`
     - Status: 200
     - Authorization header present

7. **Verify Progress Section**
   - ✅ Shows: Assignment status and progress percentage
   - ✅ Shows status history (timeline of workflow changes)
   - ✅ Each history entry shows:
     - From status → To status
     - Changed by (who approved/revised)
     - Timestamp
     - Comment

8. **Verify Feedback & Review Section**
   - ✅ Shows: Reviewer name, reviewed date, review comments
   - ✅ Shows: Task feedback
   - ✅ Shows: Current status
   - ✅ Review form displays:
     - Textarea for review comment
     - "Approve" button
     - "Request revision" button

9. **Test Review Workflow**
   - Type a review comment (e.g., "Great work! Well done.")
   - Click "Approve"
   - ✅ Shows "Approving…" while processing
   - ✅ Success message: "Review saved (Approved). List refreshed."
   - ✅ Returns to student list (Level 2)
   - ✅ Data refreshes automatically
   - ✅ Student's status pill now shows "Approved"

   OR

   - Type a review comment (e.g., "Please revise the conclusion section.")
   - Click "Request revision"
   - ✅ Shows "Sending…" while processing
   - ✅ Success message: "Review saved (Revision Required). List refreshed."
   - ✅ Returns to student list
   - ✅ Student's status pill now shows "Revision Required"

10. **Test Back Button**
    - Click "← Back"
    - ✅ Returns to student list (Level 2)
    - ✅ Previous filters preserved

---

### Test 4: Multi-Version Submissions

If a student has submitted multiple versions:

1. Navigate to that student's submission (Level 3)
2. **Verify Version History**
   - ✅ All versions are listed (newest first)
   - ✅ Each version shows:
     - Version number (v1, v2, v3, etc.)
     - Submission code
     - Timestamp
     - Status at that time
     - Files attached to that specific version
   - ✅ Files are separated by version
   - ✅ Can preview/download files from any version

---

### Test 5: Empty States

1. **No Submissions Exist**
   - Delete all submissions (or use fresh database)
   - Navigate to Student Submissions
   - ✅ Shows: "No student submissions yet. Submitted work will appear here."

2. **No Match for Filters**
   - Set filters that return no results (e.g., status "Approved" when none exist)
   - ✅ Shows: "No submissions match your filters." (Level 1)
   - ✅ Shows: "No students match your filters for this task." (Level 2)

---

### Test 6: Error Handling

1. **Backend Unreachable**
   - Stop backend server (or break VITE_API_URL)
   - Try to load Student Submissions
   - ✅ Shows error: "Unable to load submissions. Check your connection."
   - ✅ "Retry" button appears
   - Fix backend
   - Click "Retry"
   - ✅ Data loads successfully

2. **File Download Fails**
   - Simulate by using invalid file ID or backend error
   - ✅ Error message appears: "Unable to download file. Check your connection."
   - ✅ Other files can still be downloaded

3. **Review Fails**
   - Disconnect backend
   - Try to approve a submission
   - ✅ Error message appears: "Unable to save review. Check your connection."
   - ✅ Can retry after reconnecting

---

## Browser DevTools Checks

### Network Tab

1. **On page load**, verify these requests:
   - `/api/tasks/submissions?limit=500` → 200
   - `/api/tasks` → 200
   - `/api/batches` → 200 (or 404 if endpoint doesn't exist - gracefully handled)

2. **When clicking a task**, verify:
   - No additional network requests (data already loaded)

3. **When clicking a student**, verify:
   - `/api/tasks/{taskId}` → 200 (fetches task details)

4. **When downloading a file**, verify:
   - `/api/tasks/files/{fileId}/download` → 200
   - Response: file blob
   - Headers include: `Authorization: Bearer {token}`

5. **When approving/revising**, verify:
   - `/api/tasks/review` (POST) → 200
   - Request body includes: `submission_id`, `decision`, `comment`

### Console Tab

- ✅ No errors
- ✅ No CORS errors
- ✅ No "Failed to fetch" errors
- ✅ No 401 Unauthorized errors

---

## Performance Checks

1. **Initial Load**
   - With 50 submissions, page loads in <2 seconds
   - With 200 submissions, page loads in <3 seconds

2. **Navigation**
   - Switching between views is instant (no network delay)
   - Back button is instant

3. **Filtering**
   - Search results appear instantly (<100ms)
   - Filter changes are instant

4. **File Download**
   - Small files (<1MB) download in <1 second
   - Large files (5-10MB) show progress

---

## Data Validation

### Verify Against Database

1. **Check MongoDB collections**:
   ```javascript
   // In MongoDB shell or Compass
   db.submissions.countDocuments()  // Should match total submissions in UI
   
   // Count unique tasks with submissions
   db.submissions.aggregate([
     { $group: { _id: "$task_id" } },
     { $count: "task_count" }
   ])  // Should match task count in UI
   
   // Count students who submitted specific task
   db.submissions.aggregate([
     { $match: { task_id: "6ace46af1e73b110f910f158" } },  // Example task ID
     { $group: { _id: "$student_id" } },
     { $count: "student_count" }
   ])  // Should match student count for that task in UI
   ```

2. **Verify Submission Details**:
   - Pick a submission from UI
   - Find it in database: `db.submissions.findOne({ submission_code: "SUB-2026-00001" })`
   - ✅ All fields match: student_id, task_id, version, comment, status, submitted_at
   - ✅ File count matches: `db.submission_files.countDocuments({ submission_id: "..." })`

3. **Verify File Storage**:
   - Check that files exist in GridFS:
     ```javascript
     db.getCollection("submissions.files").find()  // Files metadata
     db.getCollection("submissions.chunks").find() // File chunks
     ```
   - ✅ Each file in submission_files has corresponding gridfs_id
   - ✅ Each gridfs_id exists in submissions.files collection

---

## Common Issues & Fixes

### Issue: Tasks not appearing

**Cause**: No submissions exist in database  
**Fix**: Have a student submit a task first

**Cause**: Status filter excludes all submissions  
**Fix**: Change filter to "All statuses"

---

### Issue: Student count is wrong

**Cause**: Multiple submissions from same student counted separately  
**Fix**: This is working correctly - code counts unique students using `Set`

---

### Issue: Files won't download

**Cause**: GridFS files not migrated, or download endpoint auth fails  
**Fix**: 
1. Check backend logs for GridFS errors
2. Verify `Authorization` header in Network tab
3. Check MongoDB for `submissions.files` collection

---

### Issue: Preview not working

**Cause**: File type doesn't support preview  
**Fix**: Only images, PDFs, and text files support preview. Other files show "Download to view."

---

### Issue: Back button returns to wrong view

**Cause**: JavaScript error in navigation logic  
**Fix**: Check browser console for errors, ensure state management is correct

---

## Success Criteria

✅ **All tests pass**  
✅ **No console errors**  
✅ **Data matches database**  
✅ **Files download correctly**  
✅ **Review workflow works**  
✅ **Filters work across all levels**  
✅ **Navigation is intuitive**  
✅ **Performance is acceptable**

---

## Notes for Production

1. **Pagination**: Currently loads 500 submissions. For >1000 submissions, implement pagination or virtual scrolling.

2. **File Size Limits**: GridFS supports files up to 16MB (MongoDB document limit). Larger files will fail. Consider adding size validation.

3. **Caching**: Consider adding React Query or SWR for better caching and automatic refresh.

4. **Analytics**: Track which tasks have most submissions, which students submit late, etc.

5. **Bulk Actions**: Consider adding bulk approve/revision for multiple submissions at once.

6. **Export**: Consider adding CSV/Excel export of submission data.

---

## Quick Test Checklist

- [ ] CEO can log in
- [ ] Tasks list appears
- [ ] Task shows correct student count
- [ ] Click task shows student list
- [ ] Click student shows submission details
- [ ] Files are listed
- [ ] File preview works (image)
- [ ] File preview works (PDF)
- [ ] File download works
- [ ] Can approve submission
- [ ] Can request revision
- [ ] Back button works
- [ ] Search works
- [ ] Batch filter works
- [ ] Status filter works
- [ ] Refresh button works
- [ ] No console errors
- [ ] Data matches database

---

**Implementation Complete** ✅  
All features implemented, tested, and pushed to GitHub.  
Backend APIs unchanged - using existing `/api/tasks/submissions` endpoint.  
File storage uses existing GridFS implementation.
