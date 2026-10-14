"use strict";
/**
 * Unit tests for the Google Drive folder service and the Excel export builder.
 *
 * These run entirely offline against an IN-MEMORY fake of the Drive v3 API and
 * an in-memory MongoDB collection, so they never touch the real database, a
 * real Drive folder, or any credential.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

/* ─── Fake Google Drive (v3 subset) ─────────────────────────────────────── */

function createFakeDrive() {
  const files = new Map();
  let counter = 0;

  function parseQuery(q) {
    const parent = (q.match(/'([^']+)' in parents/) || [])[1];
    const name = (q.match(/name='((?:[^'\\]|\\.)*)'/) || [])[1];
    const appProps = {};
    const re = /key='([^']+)' and value='((?:[^'\\]|\\.)*)'/g;
    let m;
    while ((m = re.exec(q)) !== null) appProps[m[1]] = m[2].replace(/\\'/g, "'");
    return { parent, name, appProps };
  }

  const api = {
    files: {
      async list({ q, pageToken }) {
        if (pageToken) return { data: { files: [] } };
        const { parent, name, appProps } = parseQuery(q);
        const out = [];
        for (const f of files.values()) {
          if (parent && !(f.parents || []).includes(parent)) continue;
          if (/\btrashed=false\b/.test(q) && f.trashed) continue;
          if (name !== undefined && f.name !== String(name).replace(/\\'/g, "'")) continue;
          let ok = true;
          for (const [k, v] of Object.entries(appProps)) {
            if ((f.appProperties || {})[k] !== v) { ok = false; break; }
          }
          if (ok) out.push({ id: f.id, name: f.name, trashed: f.trashed });
        }
        return { data: { files: out } };
      },
      async create({ requestBody }) {
        const id = `fld_${++counter}`;
        files.set(id, {
          id,
          name: requestBody.name,
          mimeType: requestBody.mimeType,
          parents: requestBody.parents || [],
          appProperties: requestBody.appProperties || {},
          trashed: false,
        });
        return { data: { id, name: requestBody.name } };
      },
      async get({ fileId, alt }) {
        const f = files.get(fileId);
        if (!f) { const e = new Error("not found"); e.code = 404; throw e; }
        if (alt === "media") return { data: Buffer.from("hello-drive") };
        return { data: { ...f } };
      },
      async update({ fileId, requestBody }) {
        const f = files.get(fileId);
        if (!f) { const e = new Error("not found"); e.code = 404; throw e; }
        Object.assign(f, requestBody);
        return { data: { ...f } };
      },
    },
  };
  return { api, files };
}

const fake = createFakeDrive();
const googleapisPath = require.resolve("googleapis");
require.cache[googleapisPath] = {
  id: googleapisPath,
  filename: googleapisPath,
  loaded: true,
  exports: {
    google: {
      auth: { JWT: class { constructor(cfg) { this.cfg = cfg; } } },
      drive: () => fake.api,
    },
  },
};

// Configure before requiring the module under test.
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "test@example.invalid";
process.env.GOOGLE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----\\n";
process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID = "ROOT_PARENT";

const drive = require("../utils/driveStorage");
const excel = require("../utils/excelExport");
const rules = require("../utils/uploadRules");

/* ─── In-memory Mongo collection ─────────────────────────────────────────── */

function createFakeDb() {
  const docs = new Map();
  let idSeq = 0;

  const applyUpdate = (existing, update, isInsert) => {
    const next = existing ? { ...existing } : {};
    if (update.$set) Object.assign(next, update.$set);
    if (update.$setOnInsert && isInsert) Object.assign(next, update.$setOnInsert);
    return next;
  };

  const collection = {
    docs,
    async createIndex() {},
    async findOne(filter) {
      for (const d of docs.values()) {
        if (d.key === filter.key) return { ...d };
      }
      return null;
    },
    async deleteOne(filter) {
      if (docs.delete(filter.key)) return { deletedCount: 1 };
      return { deletedCount: 0 };
    },
    async insertOne(doc) {
      if (docs.has(doc.key)) {
        const e = new Error("E11000 duplicate key error");
        e.code = 11000;
        throw e;
      }
      const stored = { _id: ++idSeq, ...doc };
      docs.set(doc.key, stored);
      return { insertedId: stored._id };
    },
    async updateOne(filter, update, options = {}) {
      const existing = docs.get(filter.key);
      if (!existing && options.upsert) {
        const next = applyUpdate(null, update, true);
        docs.set(filter.key, next);
        return { upsertedCount: 1 };
      }
      if (!existing) return { matchedCount: 0 };
      docs.set(filter.key, applyUpdate(existing, update, false));
      return { matchedCount: 1 };
    },
  };

  return {
    collection: () => collection,
    // helper for assertions
    _all: () => Array.from(docs.values()),
  };
}

/* ─── Name sanitization ──────────────────────────────────────────────────── */

test("sanitizeName strips Drive/OS-unsafe and control characters", () => {
  assert.equal(drive.sanitizeName('a/b\\c:d*e?f"g<h>i|j'), "a b c d e f g h i j");
  assert.equal(drive.sanitizeName("report\n\tfinal"), "report final");
  assert.equal(drive.sanitizeName("  spaced   out  "), "spaced out");
});

test("sanitizeName preserves Unicode and caps length", () => {
  const unicode = "Mohandas Ünïcode 文件 résumé";
  assert.equal(drive.sanitizeName(unicode), unicode);
  const capped = drive.sanitizeName("x".repeat(500));
  assert.equal(capped.length, 120);
});

test("sanitizeName never leaves a dangling surrogate pair", () => {
  // A 120-char cap must not slice an emoji in half.
  const out = drive.sanitizeName("a".repeat(119) + "\u{1F600}", 120);
  assert.ok(!/[\uD800-\uDBFF]$/.test(out), "must not end with a high surrogate");
});

test("sanitizeName falls back for empty input", () => {
  assert.equal(drive.sanitizeName(""), "Untitled");
  assert.equal(drive.sanitizeName(null), "Untitled");
  assert.equal(drive.sanitizeName("///"), "Untitled");
});

/* ─── Role mapping ───────────────────────────────────────────────────────── */

test("roleRoot maps the authenticated role to the correct Drive root", () => {
  assert.equal(drive.roleRoot("student"), "Students");
  assert.equal(drive.roleRoot("member"), "Students");
  assert.equal(drive.roleRoot("manager"), "Management");
  assert.equal(drive.roleRoot("admin"), "Management");
  assert.equal(drive.roleRoot("ceo"), "CEO");
  assert.equal(drive.roleRoot("CEO"), "CEO");
  // Unknown roles must never escape the Students root.
  assert.equal(drive.roleRoot("superadmin"), "Students");
  assert.equal(drive.roleRoot(undefined), "Students");
});

test("userFolderName disambiguates users with the same display name", () => {
  const a = drive.userFolderName("Mohandas", "user-aaa");
  const b = drive.userFolderName("Mohandas", "user-bbb");
  assert.notEqual(a, b);
  assert.match(a, /^Mohandas__[0-9a-f]{6}$/);
  // Same user, same folder key, regardless of a later display-name change.
  assert.equal(drive.userFolderName("Mohandas", "user-aaa"), a);
});

test("taskFolderName derives only from real task data", () => {
  const name = drive.taskFolderName({ _id: "abc123", task_code: "TNS-2026-0007", title: "Build a Website" });
  assert.match(name, /^TNS-2026-0007__Build a Website__[0-9a-f]{6}$/);
  // No day field exists on the model, so nothing may be invented.
  assert.ok(!/\bday\b/i.test(name));
});

/* ─── Filename collision handling ────────────────────────────────────────── */

test("uniqueStoredFileName never overwrites and preserves the original", () => {
  const taken = new Set(["Mohandas.resume.pdf"]);
  assert.equal(drive.uniqueStoredFileName("Mohandas.resume.pdf", taken), "Mohandas.resume (2).pdf");
  assert.equal(drive.uniqueStoredFileName("Other.pdf", taken), "Other.pdf");

  const taken2 = new Set(["a.pdf", "a (2).pdf", "a (3).pdf"]);
  assert.equal(drive.uniqueStoredFileName("a.pdf", taken2), "a (4).pdf");

  // Collisions are per full name, so a different extension is unaffected.
  assert.equal(drive.uniqueStoredFileName("a.docx", taken2), "a.docx");
});

test("uniqueStoredFileName sanitizes unsafe characters but keeps the extension", () => {
  const out = drive.uniqueStoredFileName("we:ird<na*me>.pdf", new Set());
  assert.ok(out.endsWith(".pdf"));
  assert.ok(!/[\\/:*?"<>|]/.test(out));
});

/* ─── Folder find-or-create idempotency ───────────────────────────────────── */

const REAL_TASK = { _id: "507f1f77bcf86cd799439011", task_code: "TNS-2026-0001", title: "Day One Report" };

async function ensureFor(db, role, userId, userName) {
  return drive.ensureTaskFolder(db, { role, userId, userName, task: REAL_TASK });
}

test("ensureFolder is idempotent and creates no duplicates on repeat calls", async () => {
  const db = createFakeDb();
  const first = await ensureFor(db, "student", "u1", "Asha Rao");
  const second = await ensureFor(db, "student", "u1", "Asha Rao");
  assert.equal(first.taskFolderId, second.taskFolderId);
  assert.equal(first.userFolderId, second.userFolderId);

  // Exactly one folder per level.
  const cached = db._all();
  assert.equal(cached.length, 3, "expected root + user + task folders only");
  const folders = cached.filter(c => (c.props?.techinsType || c.props) && true);
  assert.equal(cached.filter(c => c.props.techinsType === "task").length, 1);
});

test("different roles produce different roots for the same user/task", async () => {
  const db = createFakeDb();
  const student = await ensureFor(db, "student", "u1", "Asha Rao");
  const ceo = await ensureFor(db, "ceo", "u1", "Asha Rao");
  assert.notEqual(student.taskFolderId, ceo.taskFolderId);
  assert.equal(student.rootName, "Students");
  assert.equal(ceo.rootName, "CEO");
});

test("a second user with the same display name gets a separate folder", async () => {
  const db = createFakeDb();
  const a = await ensureFor(db, "student", "u1", "Asha Rao");
  const b = await ensureFor(db, "student", "u2", "Asha Rao");
  assert.notEqual(a.userFolderId, b.userFolderId);
  assert.notEqual(a.taskFolderId, b.taskFolderId);
});

test("concurrent ensureFolder calls still create a single folder (race safe)", async () => {
  const db = createFakeDb();
  const results = await Promise.all(Array.from({ length: 8 }, () => ensureFor(db, "student", "u1", "Asha Rao")));
  const ids = new Set(results.map(r => r.taskFolderId));
  assert.equal(ids.size, 1, "all concurrent callers must converge on one folder");
  assert.equal(db._all().filter(c => c.props.techinsType === "task").length, 1);
});

test("a cached folder trashed in Drive is recreated and the cache repointed", async () => {
  const db = createFakeDb();
  const before = await ensureFor(db, "student", "u1", "Asha Rao");

  // Simulate someone trashing the task folder in Drive.
  await fake.api.files.update({ fileId: before.taskFolderId, requestBody: { trashed: true } });

  const after = await ensureFor(db, "student", "u1", "Asha Rao");
  assert.notEqual(after.taskFolderId, before.taskFolderId, "must create a fresh folder");
  const cached = db._all().find(c => c.props.techinsType === "task");
  assert.equal(cached.drive_id, after.taskFolderId, "cache must point at the new folder");
});

/* ─── Env / secret handling ──────────────────────────────────────────────── */

test("missing Drive env vars produce an error naming only the variables", () => {
  const saved = { ...process.env };
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_PRIVATE_KEY;
  delete process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID;
  try {
    assert.equal(drive.isDriveConfigured(), false);
    assert.throws(() => drive.assertDriveConfigured(), (e) => {
      // Names yes, values never.
      assert.match(e.message, /GOOGLE_SERVICE_ACCOUNT_EMAIL/);
      assert.match(e.message, /GOOGLE_PRIVATE_KEY/);
      assert.match(e.message, /GOOGLE_DRIVE_PARENT_FOLDER_ID/);
      assert.ok(!e.message.includes("fake"), "must not leak any credential value");
      return true;
    });
  } finally {
    Object.assign(process.env, saved);
  }
});

test("private key with literal backslash-n sequences is expanded", async () => {
  // The test env value is stored with literal \n (as Vercel provides it).
  assert.ok(process.env.GOOGLE_PRIVATE_KEY.includes("\\n"));
  await drive.getDrive(); // must not throw while building the client
});

test("Drive errors never leak tokens or stack traces", () => {
  const msg = drive.driveErrorMessage({ code: 403 }, "fallback");
  assert.match(msg, /shared drive/i);
  assert.ok(!msg.includes("token"));
  assert.ok(!msg.includes("BEGIN PRIVATE KEY"));
});

/* ─── Upload validation rules ────────────────────────────────────────────── */

test("upload rules match the pre-existing multer limits exactly", () => {
  assert.equal(rules.MAX_FILE_BYTES, 4 * 1024 * 1024);
  assert.equal(rules.MAX_FILES, 5);
  assert.equal(rules.ALLOWED_EXTENSIONS.size, 11);
  assert.ok(rules.isAllowedExtension("a.PDF"));
  assert.ok(!rules.isAllowedExtension("a.exe"));
  assert.ok(!rules.isAllowedExtension("a.pdf.exe"));
  assert.ok(rules.validateFileMeta("a.pdf", 1024).ok);
  assert.ok(!rules.validateFileMeta("a.exe", 1024).ok);
  assert.ok(!rules.validateFileMeta("a.pdf", 4 * 1024 * 1024 + 1).ok);
  assert.ok(!rules.validateFileMeta("a.pdf", 0).ok);
});

/* ─── Excel export helpers ───────────────────────────────────────────────── */

test("formula injection is neutralized in exported text", () => {
  assert.equal(excel.sanitizeCellText("=1+1"), "'=1+1");
  assert.equal(excel.sanitizeCellText("+cmd"), "'+cmd");
  assert.equal(excel.sanitizeCellText("-2+3"), "'-2+3");
  assert.equal(excel.sanitizeCellText("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(excel.sanitizeCellText("\tX"), "'\tX");
  // Ordinary text is untouched, and Unicode survives.
  assert.equal(excel.sanitizeCellText("Normal name.pdf"), "Normal name.pdf");
  assert.equal(excel.sanitizeCellText("Mohandas 文件.pdf"), "Mohandas 文件.pdf");
  assert.equal(excel.sanitizeCellText(null), "");
  assert.equal(excel.sanitizeCellText(undefined), "");
});

test("humanSize renders readable sizes and blanks invalid input", () => {
  assert.equal(excel.humanSize(512), "512 B");
  assert.equal(excel.humanSize(2048), "2.00 KB");
  assert.equal(excel.humanSize(5 * 1024 * 1024), "5.00 MB");
  assert.equal(excel.humanSize(0), "");
  assert.equal(excel.humanSize(undefined), "");
});

test("APP_TIMEZONE is honoured, never hardcoded", () => {
  const saved = process.env.APP_TIMEZONE;
  try {
    delete process.env.APP_TIMEZONE;
    assert.equal(excel.appTimeZone(), "UTC");
    process.env.APP_TIMEZONE = "Asia/Kolkata";
    assert.equal(excel.appTimeZone(), "Asia/Kolkata");
    // The same instant renders differently per timezone.
    const iso = "2026-03-05T18:30:00.000Z";
    assert.equal(excel.formatDateTime(iso), "2026-03-06 00:00:00");
    process.env.APP_TIMEZONE = "UTC";
    assert.equal(excel.formatDateTime(iso), "2026-03-05 18:30:00");
    process.env.APP_TIMEZONE = "Not/AZone";
    assert.equal(excel.appTimeZone(), "UTC", "invalid timezone must fall back safely");
  } finally {
    if (saved === undefined) delete process.env.APP_TIMEZONE;
    else process.env.APP_TIMEZONE = saved;
  }
});

test("export filename uses the runtime date", () => {
  assert.match(excel.exportFileName(), /^TECHINS_File_Records_\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test("Drive links are built only from real ids", () => {
  assert.equal(excel.driveFileUrl("ID1"), "https://drive.google.com/file/d/ID1/view");
  assert.equal(excel.driveFolderUrl("F1"), "https://drive.google.com/drive/folders/F1");
});

test("buildRow leaves Drive columns blank for non-Drive files and never invents links", () => {
  const legacy = excel.buildRow({
    sno: 1,
    file: { original_name: "old.pdf", storage_type: "gridfs", size: 100, mime_type: "application/pdf" },
    user: { name: "Asha" },
    task: null,
    submission: null,
  });
  assert.equal(legacy.drive_file_id, "");
  assert.equal(legacy.drive_file_link, null);
  assert.equal(legacy.drive_folder_link, null);
  assert.equal(legacy.storage_provider, "gridfs");

  const driveRow = excel.buildRow({
    sno: 2,
    file: {
      original_name: "new.pdf", storage_type: "gdrive", size: 2048,
      drive_file_id: "FID", drive_folder_id: "FIDIR",
    },
    user: { name: "Asha" },
    task: { title: "T" },
    submission: { submission_code: "SUB-2026-00001" },
  });
  assert.equal(driveRow.drive_file_link, "https://drive.google.com/file/d/FID/view");
  assert.equal(driveRow.drive_folder_link, "https://drive.google.com/drive/folders/FIDIR");
});

test("buildRow sanitizes user-controlled text", () => {
  const row = excel.buildRow({
    sno: 1,
    file: { original_name: "=HYPERLINK(\"evil\").pdf", storage_type: "gridfs" },
    user: { name: "+SUM(1)" },
    task: { title: "@cmd" },
    submission: null,
  });
  assert.equal(row.original_file_name, "'=HYPERLINK(\"evil\").pdf");
  assert.equal(row.user_name, "'+SUM(1)");
  assert.equal(row.task_name, "'@cmd");
});

test("columnLetter maps numbers to spreadsheet letters", () => {
  assert.equal(excel.columnLetter(1), "A");
  assert.equal(excel.columnLetter(21), "U");
  assert.equal(excel.columnLetter(21 + 5), "Z");
  assert.equal(excel.columnLetter(27), "AA");
});

/* ─── Workbook shape ─────────────────────────────────────────────────────── */

test("buildWorkbook produces a real xlsx with styled, frozen, filtered, linked cells", async () => {
  const rows = [
    excel.buildRow({
      sno: 1,
      file: {
        original_name: "report.pdf", stored_file_name: "report.pdf", storage_type: "gdrive",
        mime_type: "application/pdf", size: 2048, created_at: "2026-03-05T10:00:00.000Z",
        upload_status: "complete", drive_file_id: "FID1", drive_folder_id: "DIR1",
        drive_folder_name: "TNS__x", task_code: "TNS-2026-0001",
      },
      user: { name: "Asha Rao", email: "asha@example.invalid", student_id: "S1", role: "student", department: "CSE", program: "BTech" },
      task: { task_code: "TNS-2026-0001", title: "Build", start_date: "2026-03-01T00:00:00.000Z" },
      submission: { submission_code: "SUB-2026-00001" },
    }),
    excel.buildRow({
      sno: 2,
      file: { original_name: "legacy.pdf", storage_type: "gridfs", mime_type: "application/pdf", size: 100, created_at: "2026-03-04T10:00:00.000Z" },
      user: null, task: null, submission: null,
    }),
  ];

  const buffer = await excel.buildWorkbook(rows);
  assert.ok(Buffer.isBuffer(buffer));
  // XLSX files are ZIP archives: check the magic bytes.
  assert.equal(buffer.subarray(0, 2).toString("binary"), "PK");

  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet("File Records");
  assert.ok(ws, "sheet must be named 'File Records'");

  // Header text and count
  assert.equal(ws.getRow(1).getCell(1).value, "S.No.");
  assert.equal(ws.getRow(1).getCell(excel.COLUMNS.length).value, "Drive Folder Link");
  assert.equal(ws.getRow(1).cellCount, excel.COLUMNS.length);

  // Styled header
  assert.equal(ws.getRow(1).font.bold, true);
  assert.equal(ws.getRow(1).fill.fgColor.argb, "FF1F4E79");

  // Frozen header + auto-filter
  assert.equal(ws.views[0].state, "frozen");
  assert.equal(ws.views[0].ySplit, 1);
  // Auto-filter spans the header + both data rows (header is row 1).
  assert.equal(ws.autoFilter, `A1:${excel.columnLetter(excel.COLUMNS.length)}3`);

  // Real hyperlink on the Drive row, blank on the legacy row
  const linkCol = excel.COLUMNS.findIndex(c => c.key === "drive_file_link") + 1;
  const linkValue = ws.getRow(2).getCell(linkCol).value;
  assert.equal(linkValue.hyperlink, "https://drive.google.com/file/d/FID1/view");
  assert.equal(ws.getRow(3).getCell(linkCol).value, "");

  // Joined data landed in the right columns
  const row2 = {};
  excel.COLUMNS.forEach((c, i) => { row2[c.key] = ws.getRow(2).getCell(i + 1).value; });
  assert.equal(row2.user_name, "Asha Rao");
  assert.equal(row2.user_id, "S1");
  assert.equal(row2.email, "asha@example.invalid");
  assert.equal(row2.department_program, "CSE / BTech");
  assert.equal(row2.task_id, "TNS-2026-0001");
  assert.equal(row2.submission_id, "SUB-2026-00001");
  assert.equal(row2.file_size, "2.00 KB");
  assert.match(row2.upload_date_time, /^\d{4}-\d{2}-\d{2} /);
  assert.equal(row2.storage_provider, "gdrive");

  // Legacy row keeps a blank provider note and no Drive data
  const row3 = {};
  excel.COLUMNS.forEach((c, i) => { row3[c.key] = ws.getRow(3).getCell(i + 1).value; });
  assert.equal(row3.storage_provider, "gridfs");
  assert.equal(row3.drive_file_id, "");

  // Footer note is present below the data
  const footer = ws.getRow(4).getCell(1).value;
  assert.match(String(footer), /private/i);

  // Column widths are set
  assert.ok(ws.getColumn(1).width > 0);
});