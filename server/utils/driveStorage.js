/**
 * Google Drive storage backend (see master prompt).
 */
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { Readable } = require("stream");
const crypto = require("crypto");

const ROOT_FOLDER_ID = () => String(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "18F5yTfw0ceaZX1z3phu74cg2dJGo47-0").trim();
const MOCK_DRIVE = process.env.GOOGLE_DRIVE_MOCK === "true";
const MOCK_DIR = require("path").join(require("os").tmpdir(), "techins-drive-mock");

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".zip",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".txt", ".csv",
]);

const MIME_BY_EXT = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".zip": "application/zip",
};

function authType() {
  if (MOCK_DRIVE) return "mock";
  if (process.env.GOOGLE_DRIVE_REFRESH_TOKEN && process.env.GOOGLE_DRIVE_CLIENT_ID && process.env.GOOGLE_DRIVE_CLIENT_SECRET) {
    return "oauth2";
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return "service_account";
  }
  return "none";
}

function getOAuthClient() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_DRIVE_CLIENT_ID,
    process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    "urn:ietf:wg:oauth:2.0:oob"
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN });
  return oauth2;
}

function getServiceAccountClient() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return new google.auth.GoogleAuth({ credentials: creds, scopes: ["https://www.googleapis.com/auth/drive"] });
  }
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  return new google.auth.GoogleAuth({ keyFile: keyPath, scopes: ["https://www.googleapis.com/auth/drive"] });
}

function getAuthClient() {
  const type = authType();
  if (type === "oauth2") return getOAuthClient();
  if (type === "service_account") return getServiceAccountClient();
  throw new Error("Google Drive credentials are not configured");
}

function getDriveClient() {
  return google.drive({ version: "v3", auth: getAuthClient() });
}

async function retry(fn, attempts) {
  attempts = attempts || 4;
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      const status = e && (e.code || (e.response && e.response.status));
      const retryable = status === 429 || (status >= 500 && status < 600) || /ECONN|ETIMEDOUT|ENOTFOUND/i.test(String(e && e.message));
      if (!retryable || i === attempts - 1) throw e;
      await new Promise(function (r) { setTimeout(r, Math.pow(2, i) * 500); });
    }
  }
  throw last;
}

async function verifyRootAccess() {
  const type = authType();
  if (type === "mock") {
    return { ok: true, authType: type, folder: { id: ROOT_FOLDER_ID(), name: "MOCK" } };
  }
  if (type === "none") {
    return { ok: false, authType: type, error: "No Google Drive credentials configured" };
  }
  try {
    const drive = getDriveClient();
    const resp = await retry(function () {
      return drive.files.get({ fileId: ROOT_FOLDER_ID(), fields: "id,name,webViewLink,driveId", supportsAllDrives: true });
    });
    return { ok: true, authType: type, folder: resp.data };
  } catch (e) {
    const status = e && (e.code || (e.response && e.response.status));
    return {
      ok: false,
      authType: type,
      error: (e && e.message) || String(e),
      status: status,
      hint: status === 404 ? "Share the root folder with the configured account as Editor, or check GOOGLE_DRIVE_ROOT_FOLDER_ID." : null,
    };
  }
}

async function getStoredFolder(db, key) {
  const row = await db.collection("drive_folders").findOne({ key });
  return row && row.drive_folder_id ? row.drive_folder_id : null;
}

async function storeFolder(db, key, parentId, driveFolderId, name) {
  await db.collection("drive_folders").updateOne(
    { key },
    { $set: { key: key, parent_id: parentId, drive_folder_id: driveFolderId, name: name, updated_at: new Date().toISOString() }, $setOnInsert: { created_at: new Date().toISOString() } },
    { upsert: true }
  );
}

async function findFolderByName(parentId, name) {
  const drive = getDriveClient();
  const q = "'" + parentId + "' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '" + name.replace(/'/g, "\\'") + "' and trashed = false";
  const resp = await retry(function () {
    return drive.files.list({ q: q, fields: "files(id,name,webViewLink)", pageSize: 10, supportsAllDrives: true, includeItemsFromAllDrives: true });
  });
  const files = resp.data.files || [];
  return files.length ? files[0] : null;
}

async function createFolder(parentId, name) {
  const drive = getDriveClient();
  const resp = await retry(function () {
    return drive.files.create({ requestBody: { name: name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }, fields: "id,name,webViewLink", supportsAllDrives: true });
  });
  return resp.data;
}

async function ensureFolder(db, key, parentId, name) {
  if (MOCK_DRIVE) {
    const stored = await getStoredFolder(db, key);
    if (stored) return { id: stored, webViewLink: null, created: false };
    const id = "mock-folder-" + key;
    await storeFolder(db, key, parentId, id, name);
    return { id: id, webViewLink: "https://drive.google.com/drive/folders/" + id, created: true };
  }
  const stored = await getStoredFolder(db, key);
  if (stored) {
    try {
      const drive = getDriveClient();
      const resp = await retry(function () { return drive.files.get({ fileId: stored, fields: "id,name", supportsAllDrives: true }); });
      if (resp.data && resp.data.id) return { id: resp.data.id, webViewLink: null, created: false };
    } catch (e) { /* fall through */ }
  }
  let existing = await findFolderByName(parentId, name);
  if (existing) {
    await storeFolder(db, key, parentId, existing.id, name);
    return { id: existing.id, webViewLink: existing.webViewLink, created: false };
  }
  const created = await createFolder(parentId, name);
  const race = await getStoredFolder(db, key);
  if (race && race !== created.id) {
    return { id: race, webViewLink: null, created: false };
  }
  await storeFolder(db, key, parentId, created.id, name);
  return { id: created.id, webViewLink: created.webViewLink, created: true };
}

async function getStudentsRootFolder(db) {
  return ensureFolder(db, "drive:root:students", ROOT_FOLDER_ID(), "Students");
}

async function ensureStudentFolder(db, studentId) {
  const root = await getStudentsRootFolder(db);
  return ensureFolder(db, "drive:student:" + studentId, root.id, String(studentId));
}

async function ensureDayFolder(db, studentId, dayNumber) {
  const studentFolder = await ensureStudentFolder(db, studentId);
  const dayName = "Day " + String(dayNumber).padStart(2, "0");
  return ensureFolder(db, "drive:student:" + studentId + ":day:" + dayNumber, studentFolder.id, dayName);
}

function splitExt(filename) {
  const idx = (filename || "").lastIndexOf(".");
  if (idx <= 0 || idx === (filename || "").length - 1) return { base: filename || "file", ext: "" };
  return { base: filename.slice(0, idx), ext: filename.slice(idx).toLowerCase() };
}

function sanitizeBaseName(name) {
  return String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

function validateUpload(file, maxSizeBytes) {
  const errors = [];
  if (!file) { errors.push("No file provided"); return { ok: false, errors: errors }; }
  const parts = splitExt(file.originalname || "");
  const ext = parts.ext;
  if (!ALLOWED_EXTENSIONS.has(ext)) errors.push("Unsupported file type: " + (ext || "(none)"));
  const limit = maxSizeBytes || Number(process.env.GOOGLE_DRIVE_UPLOAD_MAX_BYTES || 5 * 1024 * 1024);
  if (file.size > limit) errors.push("File too large: " + file.size + " bytes (max " + limit + ")");
  const buf = file.buffer;
  if (buf && buf.length >= 4) {
    if (ext === ".png" && !(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)) errors.push("Invalid PNG signature");
    if ((ext === ".jpg" || ext === ".jpeg") && !(buf[0] === 0xff && buf[1] === 0xd8)) errors.push("Invalid JPEG signature");
    if (ext === ".pdf" && !(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) errors.push("Invalid PDF signature");
  }
  return { ok: errors.length === 0, errors: errors, limit: limit };
}

async function uploadToDrive(buffer, originalname, mimeType, parentFolderId, nameOverride) {
  if (MOCK_DRIVE) {
    const id = "mock-file-" + crypto.randomUUID();
    const fs = require("fs");
    const path = require("path");
    fs.mkdirSync(MOCK_DIR, { recursive: true });
    fs.writeFileSync(path.join(MOCK_DIR, id), buffer);
    return { id: id, name: nameOverride || originalname, mimeType: mimeType || "application/octet-stream", size: buffer.length, webViewLink: "https://drive.google.com/file/d/" + id + "/view", webContentLink: "https://drive.google.com/uc?id=" + id };
  }
  const drive = getDriveClient();
  const parts = splitExt(originalname || "file");
  const finalName = nameOverride || sanitizeBaseName(parts.base) + parts.ext;
  const resp = await retry(function () {
    return drive.files.create({
      requestBody: { name: finalName, parents: [parentFolderId] },
      media: { mimeType: mimeType || "application/octet-stream", body: Readable.from(buffer) },
      fields: "id,name,mimeType,size,webViewLink,webContentLink",
      supportsAllDrives: true,
    });
  });
  return resp.data;
}

async function downloadFromDrive(fileId) {
  if (MOCK_DRIVE) {
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(MOCK_DIR, fileId);
    if (!fs.existsSync(filePath)) throw new Error("Mock file not found: " + fileId);
    const stream = fs.createReadStream(filePath);
    const stat = fs.statSync(filePath);
    return { stream: stream, meta: { id: fileId, name: fileId, mimeType: "application/octet-stream", size: stat.size } };
  }
  const drive = getDriveClient();
  const meta = await retry(function () { return drive.files.get({ fileId: fileId, fields: "id,name,mimeType,size,webViewLink", supportsAllDrives: true }); });
  const resp = await retry(function () { return drive.files.get({ fileId: fileId, alt: "media", supportsAllDrives: true }, { responseType: "stream" }); });
  return { stream: resp.data, meta: meta.data };
}

async function deleteFromDrive(fileId) {
  if (MOCK_DRIVE) {
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(MOCK_DIR, fileId);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return;
  }
  const drive = getDriveClient();
  await retry(function () { return drive.files.delete({ fileId: fileId, supportsAllDrives: true }); });
}

module.exports = {
  authType: authType,
  verifyRootAccess: verifyRootAccess,
  getDriveClient: getDriveClient,
  retry: retry,
  ensureFolder: ensureFolder,
  getStudentsRootFolder: getStudentsRootFolder,
  ensureStudentFolder: ensureStudentFolder,
  ensureDayFolder: ensureDayFolder,
  validateUpload: validateUpload,
  uploadToDrive: uploadToDrive,
  downloadFromDrive: downloadFromDrive,
  deleteFromDrive: deleteFromDrive,
  splitExt: splitExt,
  sanitizeBaseName: sanitizeBaseName,
  ALLOWED_EXTENSIONS: ALLOWED_EXTENSIONS,
  ROOT_FOLDER_ID: ROOT_FOLDER_ID,
};
