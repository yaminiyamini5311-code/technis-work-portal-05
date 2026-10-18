# TECHINS Work Portal — Bug Fix Checklist

## CEO Portal
- [ ] C-1: Create Mission form — "Title and student are required" with valid input
- [ ] C-2: POST /api/missions returns HTTP 400
- [ ] C-3: Mission Title input — white box with invisible text
- [ ] C-4: Create button — mismatched thick orange/brown outline
- [ ] C-5: "No missions yet" despite existing data
- [ ] C-6: Error banner stays permanently
- [ ] C-7: Feedback task dropdown only shows "General feedback"
- [ ] C-8: Student header shows raw database ID
- [ ] C-9: "1 entries" pluralisation
- [ ] C-10: Feedback card white with pale text (low contrast)
- [ ] C-11: "Reviewer unknown" on saved entry
- [ ] C-12: No validation for score range (0-100)

## Student Portal
- [ ] S-1: Progress 100% while Missions 0/0
- [ ] S-2: Score 58% vs "Not evaluated" contradiction
- [ ] S-3: Counters disagree with each other
- [ ] S-4: Task-wise results card white with invisible text
- [ ] S-5: Sticky header translucent (content shows through)
- [ ] S-6: My Feedback white card / low contrast
- [ ] S-7: Leaked developer text in subtitle
- [ ] S-8: "Reviewer unknown" + date shown twice
- [ ] S-9: Feedback title duplicated/redundant
- [ ] S-10: Card floats over background logo (no width constraint)

## Shared
- [ ] Header/navbar: CEO solid, Student translucent (S-5)
- [ ] No developer wording, raw IDs, raw ISO dates in UI

## Phase 1: Login & Sign-up
- [ ] A: Password visibility icons (eye/eye-off)
- [ ] B: Batch dropdown loads all configured batches

## Phase 2: CEO Portal UI
- [ ] A: Navbar sticky, opaque, proper z-index
- [ ] B: Student Performance buttons polished
- [ ] C: CEO Feedback page dark cards, proper grouping

## Phase 3: Mission Management
- [ ] Fix creation flow (C-1, C-2, C-3, C-4, C-6)
- [ ] A: Individual assignment
- [ ] B: Group assignment
- [ ] C: End-to-end trace

## Phase 4: Student Progress
- [ ] A: Overall progress single source of truth
- [ ] B: Score rule consistent
- [ ] C: Working history
- [ ] D: Task-wise results card dark theme

## Phase 5: Student Performance & Feedback
- [ ] A: Student Performance reuse CEO layout
- [ ] B: My Feedback reuse CEO card, fix all S-6..S-10

## Phase 6: Google Drive
- [ ] Implement and test storage workflow

## Phase 7: Testing
- [ ] All tests pass

## Phase 8: Git
- [ ] Commit and push
