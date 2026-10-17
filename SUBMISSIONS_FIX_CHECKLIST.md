# Student Submissions UI & File Access Fix — Checklist

## Table Issues
- [ ] T-1: Sticky header displaced (overflow-x:auto creates new containing block)
- [ ] T-2: Header/body column count mismatch (8 headers vs 7 data columns)
- [ ] T-3: Actions wrap and collide (column too narrow)
- [ ] T-4: Student details text breaks badly (email/ID wrap mid-string)
- [ ] T-5: Raw ObjectId shown as student ID (backend projection missing student_id)
- [ ] T-6: Files column shows only count (no preview/download)
- [ ] T-7: Response text clamped with no expand
- [ ] T-8: Watermark logo behind table text
- [ ] T-9: Navbar not visible

## Details Page Issues
- [ ] D-1: Profile values nearly invisible (dark text on dark background)
- [ ] D-2: TECHINS ID shows "—" (backend projection missing student_id)
- [ ] D-3: Missions (0) vs Tasks (3) discrepancy
- [ ] D-4: Status badge colors inconsistent
- ] D-5: No submission response text, files, or preview/download
- [ ] D-6: Navbar not visible

## Backend
- [ ] Fix student_id projection in submissions API
- [ ] Verify file download endpoint works correctly
- [ ] Add proper error handling for missing files
