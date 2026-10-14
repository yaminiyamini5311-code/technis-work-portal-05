/**
 * Excel (.xlsx) export of submission FILE RECORDS.
 *
 * Built with exceljs because the workbook needs a styled header row, a frozen
 * header row, auto-filter and real hyperlink cells - none of which the
 * already-installed xlsx@0.18.5 community build can write (verified against
 * the raw sheet XML it produces).
 *
 * One row per uploaded file. Records that predate Drive storage are included
 * with blank Drive columns and a Storage Provider of "gridfs"/"filesystem";
 * a Drive link is NEVER invented for them.
 */

const ExcelJS = require("exceljs");

const SHEET_NAME = "File Records";
/** Guard against unbounded memory inside a serverless function. */
const MAX_ROWS = 50000;
const MAX_BYTES_PER_FILE = 4 * 1024 * 1024;

/**
 * Neutralize spreadsheet formula injection.
 *
 * Any user-controlled text (names, filenames, task titles) beginning with
 * =, +, - or @ is prefixed with an apostrophe so Excel treats it as text and
 * never evaluates it. Leading control characters are stripped.
 *
 * Note: xlsx stores string cells as shared strings and only parses formulas
 * from dedicated formula nodes, so this is defence in depth — it also
 * protects the workbook if it is ever re-saved as CSV.
 *
 * @param {*} value
 * @returns {string}
 */
function sanitizeCellText(value) {
  if (value === null || value === undefined) return "";
  let text = typeof value === "string" ? value : String(value);
  // Drop control characters that can confuse spreadsheet parsers.
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  if (/^[=+\-@\t\r]/.test(text)) return `'${text}`;
  return text;
}

/**
 * Human-readable file size, e.g. "1.25 MB".
 * @param {number} bytes
 * @returns {string}
 */
function humanSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(2)} ${units[unit]}`;
}

/**
 * Resolve the app's configured timezone. Never hardcoded: controlled by
 * APP_TIMEZONE, falling back to UTC when unset or invalid.
 * @returns {string}
 */
function appTimeZone() {
  const configured = String(process.env.APP_TIMEZONE || "").trim();
  if (!configured) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: configured });
    return configured;
  } catch {
    console.warn(`[Export] Invalid APP_TIMEZONE, falling back to UTC.`);
    return "UTC";
  }
}

/**
 * Format a date/time for display in the configured timezone.
 * @param {Date|string|number} value
 * @returns {string}
 */
function formatDateTime(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: appTimeZone(),
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (t) => (parts.find(p => p.type === t) || {}).value || "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
  } catch {
    return d.toISOString().replace("T", " ").slice(0, 19);
  }
}

/**
 * Format a date only, in the configured timezone.
 * @param {Date|string|number} value
 * @returns {string}
 */
function formatDate(value) {
  const full = formatDateTime(value);
  return full ? full.slice(0, 10) : "";
}

/**
 * Columns, in order. `key` maps to the row object produced by the query.
 * `link: true` marks a column written as a real Excel hyperlink.
 */
const COLUMNS = [
  { header: "S.No.", key: "sno", width: 7 },
  { header: "User Name", key: "user_name", width: 24 },
  { header: "User ID", key: "user_id", width: 26 },
  { header: "User Role", key: "user_role", width: 12 },
  { header: "Email", key: "email", width: 30 },
  { header: "Department / Program", key: "department_program", width: 30 },
  { header: "Task ID", key: "task_id", width: 16 },
  { header: "Task Name", key: "task_name", width: 36 },
  { header: "Task Day / Date", key: "task_date", width: 14 },
  { header: "Submission ID", key: "submission_id", width: 18 },
  { header: "Original File Name", key: "original_file_name", width: 38 },
  { header: "File Type", key: "file_type", width: 30 },
  { header: "File Size", key: "file_size", width: 12 },
  { header: "Upload Date & Time", key: "upload_date_time", width: 21 },
  { header: "Upload Status", key: "upload_status", width: 14 },
  { header: "Storage Provider", key: "storage_provider", width: 16 },
  { header: "Drive Folder Name", key: "drive_folder_name", width: 34 },
  { header: "Drive Folder ID", key: "drive_folder_id", width: 40 },
  { header: "Drive File ID", key: "drive_file_id", width: 40 },
  { header: "Drive File Link", key: "drive_file_link", width: 46, link: true },
  { header: "Drive Folder Link", key: "drive_folder_link", width: 46, link: true },
];

/** Footer note appended under the data. */
const FOOTER_NOTE =
  "Note: Drive links open only for people who already have the required Google Workspace permission. " +
  "All files are private and are never shared publicly. Files marked with a non-Drive storage provider were " +
  "uploaded before Drive storage was enabled and have no Drive link.";

/**
 * Build the Drive view URL for a verified file id.
 * @param {string} fileId
 * @returns {string}
 */
function driveFileUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * Build the Drive folder URL for a verified folder id.
 * @param {string} folderId
 * @returns {string}
 */
function driveFolderUrl(folderId) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

/**
 * Turn a raw file record plus its joined user/task/submission into a safe row.
 * Every user-controlled string passes through sanitizeCellText.
 *
 * @param {Object} args
 * @returns {Object} row keyed by COLUMNS[].key, plus a `_links` map
 */
function buildRow({ sno, file, user, task, submission }) {
  const isDrive = file.storage_type === "gdrive" && file.drive_file_id;
  // A Drive link is only ever emitted from a real, verified Drive id.
  const fileLink = isDrive ? driveFileUrl(String(file.drive_file_id)) : null;
  const folderLink = isDrive && file.drive_folder_id ? driveFolderUrl(String(file.drive_folder_id)) : null;

  return {
    sno,
    user_name: sanitizeCellText(user?.name || file.user_display_name || ""),
    user_id: sanitizeCellText(user?.student_id || file.user_id || ""),
    user_role: sanitizeCellText(file.user_role || user?.role || ""),
    email: sanitizeCellText(user?.email || file.user_email || ""),
    department_program: sanitizeCellText(
      [user?.department, user?.program].filter(Boolean).join(" / ")
    ),
    task_id: sanitizeCellText(task?.task_code || file.task_code || ""),
    task_name: sanitizeCellText(task?.title || file.task_title || ""),
    // The tasks collection has no day/number field; the real start date is
    // used and left blank when the task has none. Nothing is invented.
    task_date: formatDate(task?.start_date),
    submission_id: sanitizeCellText(submission?.submission_code || file.submission_id || ""),
    original_file_name: sanitizeCellText(file.original_name || ""),
    file_type: sanitizeCellText(file.mime_type || ""),
    file_size: humanSize(file.size ?? file.actual_size),
    upload_date_time: formatDateTime(file.created_at),
    upload_status: sanitizeCellText(file.upload_status || (isDrive ? "complete" : "")),
    storage_provider: sanitizeCellText(file.storage_type || "gridfs"),
    drive_folder_name: sanitizeCellText(file.drive_folder_name || ""),
    drive_folder_id: sanitizeCellText(file.drive_folder_id || ""),
    drive_file_id: sanitizeCellText(file.drive_file_id || ""),
    drive_file_link: fileLink,
    drive_folder_link: folderLink,
  };
}

/**
 * Render rows into a workbook with a styled + frozen header, auto-filter and
 * clickable hyperlinks.
 * @param {Array<Object>} rows
 * @returns {Promise<Buffer>}
 */
async function buildWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TECHINS Work Portal";
  wb.created = new Date();

  const ws = wb.addWorksheet(SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 28;

  let lastRow = 1;
  for (const row of rows) {
    const added = ws.addRow(row);
    lastRow = added.number;

    // Hyperlink cells: real Excel links built from verified Drive ids.
    for (const col of COLUMNS) {
      if (!col.link) continue;
      const cell = added.getCell(col.key);
      const url = row[col.key];
      if (url) {
        cell.value = { text: "Open", hyperlink: url };
        cell.font = { color: { argb: "FF0563C1" }, underline: true };
      } else {
        cell.value = "";
      }
    }
    // Borders for readability.
    added.eachCell({ includeEmpty: true }, cell => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9D9D9" } },
        left: { style: "thin", color: { argb: "FFD9D9D9" } },
        bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
        right: { style: "thin", color: { argb: "FFD9D9D9" } },
      };
    });
  }

  // Auto-filter across the data range (header row only if there is no data).
  ws.autoFilter = `A1:${columnLetter(COLUMNS.length)}${Math.max(lastRow, 1)}`;

  // Footer note, a row below the data.
  const noteRow = ws.addRow({});
  noteRow.getCell(1).value = FOOTER_NOTE;
  noteRow.getCell(1).font = { italic: true, size: 9, color: { argb: "FF555555" } };
  noteRow.getCell(1).alignment = { wrapText: true, vertical: "top" };
  ws.mergeCells(noteRow.number, 1, noteRow.number, COLUMNS.length);
  noteRow.height = 32;

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** 1 -> A, 27 -> AA */
function columnLetter(n) {
  let s = "";
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/**
 * Download filename, with the date generated at runtime in the configured
 * timezone (never hardcoded).
 * @returns {string}
 */
function exportFileName() {
  return `TECHINS_File_Records_${formatDate(new Date())}.xlsx`;
}

module.exports = {
  SHEET_NAME, COLUMNS, MAX_ROWS, MAX_BYTES_PER_FILE, FOOTER_NOTE,
  sanitizeCellText, humanSize, formatDate, formatDateTime, appTimeZone,
  buildRow, buildWorkbook, exportFileName, driveFileUrl, driveFolderUrl, columnLetter,
};