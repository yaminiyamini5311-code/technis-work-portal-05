# TECHINS CEO Portal — Fixes & Feature Enhancements Checklist

## Section 0: Pre-flight
- [x] Repo inspected, on fix/portal-ui-workflows branch
- [x] C-1/C-2 blocking bug already fixed (Number() conversion on assigned_to)
- [x] Frontend API base URL confirmed: https://technis-portal-server.vercel.app

## Section 1: CEO Navbar — Fixed while scrolling
- [ ] Fix .role-topbar position (remove sticky, keep fixed)
- [ ] Opaque background (no transparency)
- [ ] scroll-padding-top for anchor links
- [ ] Verify on all CEO pages

## Section 2: Mission Assignment — Individual and Group
- [ ] A: Assignment mode selector (Individual | Group/Batch)
- [ ] B: Individual assignment (correct studentId + missionId)
- [ ] C: Group assignment (all eligible students, prevent duplicates)
- [ ] D: Student Portal integration (visibility, progress)

## Section 3: Student Admissions — Three Actions
- [ ] A: View Details (modal with student data)
- [ ] B: Delete (confirmation dialog, soft-delete)
- [ ] C: Requirement (dialog, notification, review)

## Section 4: Excel Export — Task-wise Report
- [ ] One row per student, one column per task
- [ ] Proper formatting (frozen header, colors, widths)
- [ ] Formula injection escaping
- [ ] CEO/management-only endpoint

## Section 5: Backend, Security, Data Integrity
- [ ] Role-based permissions enforced server-side
- [ ] ID validation (ObjectId, exists, not deleted)
- [ ] No insecure direct object references
- [ ] No regressions

## Section 6: Testing
- [ ] Navbar scroll test
- [ ] Mission creation test
- [ ] Assignment test
- [ ] Admissions test
- [ ] Excel export test
- [ ] Regression test

## Section 7: Git
- [ ] Review changed files
- [ ] Run tests/build
- [ ] Commit and push
