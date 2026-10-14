/**
 * Google Drive storage — folder service + resumable upload + private download.
 *
 * Design notes
 * ------------
 * - Target is a SHARED DRIVE where the service account is a member. A service
 *   account in a personal My Drive has no storage quota, so uploads would fail
 *   with a quota error. Every call passes `supportsAllDrives: true`.
 * - Files are PRIVATE. Nothing here ever sets a public/anyone permission, and
 *   `webViewLink` is never treated as an access grant — downloads are streamed
 *   through this server with the service account credentials.
 * - Folders are matched by a STABLE KEY written into Drive `appProperties`
 *   (never by display name), so a renamed user or task can never orphan or
 *   collide with a folder.
 * - Credentials are read from the environment and are never logged, returned,
 *   or persisted. Only env var NAMES appear in error messages.
 */

const { google } = require("googleapis");

/* ─── CONFIGURATION ──────────────────────────────────────────────────────── */

// Required env var names. Only names are ever surfaced to callers/logs.
const ENV_EMAIL = "GOOGLE_SERVICE_ACCOUNT_EMAIL";
const ENV_KEY = "GOOGLE_PRIVATE_KEY";
const ENV_PARENT = "GOOGLE_DRIVE_PARENT_FOLDER_ID";

// Minimal scope: every file this portal creates is app-created, so per-file
// access is sufficient and avoids granting blanket Drive access. Widenable to
// the full `drive` scope via this env var if that assumption ever stops
// holding (no code change / no redeploy required).
const DEFAULT_SCOPES = ["https://www.googleapis.com/auth/drive.file"];

// Drive/OS-unsafe characters plus control characters. Unicode letters,
// digits and marks are preserved.
const UNSAFE_NAME_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const MAX_FOLDER_NAME = 120;
const MAX_FILE_NAME = 180;

/**
 * Make a value safe to use as a Drive folder/file display name.
 * Strips unsafe characters, collapses whitespace, caps length, keeps Unicode.
 * @param {string} raw
 * @param {number} [maxLength]
 * @returns {string}
 */
function sanitizeName(raw, maxLength = MAX_FOLDER_NAME) {
  const text = String(raw == null ? "" : raw)
    // Reject control characters (including newlines/tabs) before anything else.
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(UNSAFE_NAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Untitled";
  // Truncate without splitting a surrogate pair (keeps emoji/intl intact).
  let out = text.slice(0, maxLength);
  if (out.length && /[\uD800-\uDBFF]/.test(out[out.length - 1])) out = out.slice(0, -1);
  return out.trim() || "Untitled";
}

/**
 * Short, stable suffix derived from an id so folders never collide even when
 * two users share a display name. 6 hex chars of a SHA-256 digest.
 * @param {string} id
 * @returns {string}
 */
function shortId(id) {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(String(id || "")).digest("hex").slice(0, 6);
}

/**
 * Map an authenticated role to its Drive root folder. Role comes from the
 * verified JWT (req.user.role) and NEVER from the request body or a parameter.
 * @param {string} role
 * @returns {string}
 */
function roleRoot(role) {
  const r = String(role || "").toLowerCase();
  if (r === "ceo") return "CEO";
  if (r === "manager" || r === "admin") return "Management";
  // students, members and any unknown role are confined to the Students root
  return "Students";
}

/**
 * Folder display name for a user: sanitized display name + stable id suffix so
 * same-name users never collide and a rename does not orphan the folder.
 * @param {string} displayName
 * @param {string} userId
 * @returns {string}
 */
function userFolderName(displayName, userId) {
  const base = sanitizeName(displayName, 60) || "User";
  return `${base}__${shortId(userId)}`.slice(0, MAX_FOLDER_NAME);
}

/**
 * Folder display name for a task, derived from REAL task data only.
 * The tasks collection has no day/number field, so we use the real, stable
 * `task_code` (e.g. TNS-2026-0007) plus the task title and a short id.
 * Nothing is invented.
 * @param {Object} task
 * @returns {string}
 */
function taskFolderName(task) {
  const code = task?.task_code ? sanitizeName(task.task_code, 40) : null;
  const title = task?.title ? sanitizeName(task.title, 60) : null;
  const parts = [];
  if (code) parts.push(code);
  if (title) parts.push(title);
  if (!parts.length) parts.push("Task");
  parts.push(shortId(task?._id || task?.id || ""));
  return parts.join("__").slice(0, MAX_FOLDER_NAME);
}

/**
 * True when all required Drive env vars are present. Never logs values.
 * @returns {boolean}
 */
function isDriveConfigured() {
  return Boolean(process.env[ENV_EMAIL] && process.env[ENV_KEY] && process.env[ENV_PARENT]);
}

/**
 * Throw a clear, value-free error when Drive is not configured.
 * Only env var NAMES are included in the message.
 */
function assertDriveConfigured() {
  const missing = [ENV_EMAIL, ENV_KEY, ENV_PARENT].filter(k => !process.env[k]);
  if (missing.length) {
    const err = new Error(
      `Google Drive storage is not configured. Missing environment variable(s): ${missing.join(", ")}. ` +
      `Set them in Vercel → Settings → Environment Variables (and in server/.env for local development).`
    );
    err.code = "DRIVE_NOT_CONFIGURED";
    err.missingEnv = missing;
    throw err;
  }
}

/* ─── CLIENT ─────────────────────────────────────────────────────────────── */

let _driveClient = null;
let _authClient = null;

/**
 * Lazily build (and cache) the Drive client from the service account.
 * The private key arrives from env with literal "\n" sequences when copied
 * through a dashboard, so those are expanded before it is used.
 * @returns {Promise<object>} Drive v3 client
 */
async function getDrive() {
  assertDriveConfigured();
  if (_driveClient) return _driveClient;

  const rawKey = String(process.env[ENV_KEY]);
  const privateKey = rawKey.replace(/\\n/g, "\n");

  _authClient = new google.auth.JWT({
    email: process.env[ENV_EMAIL],
    key: privateKey,
    scopes: process.env.GOOGLE_DRIVE_SCOPES
      ? String(process.env.GOOGLE_DRIVE_SCOPES).split(",").map(s => s.trim()).filter(Boolean)
      : DEFAULT_SCOPES,
  });

  _driveClient = google.drive({ version: "v3", auth: _authClient });
  return _driveClient;
}

/**
 * Retry transient Google API failures (429 / 5xx / network) with backoff.
 * 403/404 are surfaced immediately — they are configuration or existence
 * problems that retrying cannot fix.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {number} [attempts]
 */
async function withRetry(fn, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error?.code ?? error?.response?.status;
      const transient = status === 429 || (typeof status === "number" && status >= 500) || status === undefined;
      if (!transient || i === attempts - 1) throw error;
      await new Promise(r => setTimeout(r, 300 * Math.pow(2, i)));
    }
  }
  throw lastError;
}

/**
 * Convert a Google API error into a short, non-secret message safe to show a
 * user. Never includes stack traces, tokens, or session URLs.
 * @param {Error} error
 * @param {string} fallback
 * @returns {string}
 */
function driveErrorMessage(error, fallback) {
  const status = error?.code ?? error?.response?.status;
  if (status === 403) return "Google Drive denied access. Check that the service account is a member of the shared drive.";
  if (status === 404) return "The target folder or file was not found in Google Drive.";
  if (status === 429) return "Google Drive is rate limiting uploads. Please try again in a moment.";
  if (status === 507 || status === 4030) return "Google Drive storage quota was reached. Please contact your administrator.";
  if (typeof status === "number" && status >= 500) return "Google Drive is temporarily unavailable. Please try again.";
  return fallback;
}

/* ─── FOLDER CACHE (MongoDB) ─────────────────────────────────────────────── */

const FOLDER_COLLECTION = "drive_folders";

async function ensureFolderIndexes(db) {
  try {
    await db.collection(FOLDER_COLLECTION).createIndex({ key: 1 }, { unique: true });
    await db.collection(FOLDER_COLLECTION).createIndex({ drive_id: 1 });
  } catch (e) {
    // Index creation can fail if another instance is mid-build; unique-key
    // enforcement still works, so this is non-fatal.
    console.warn("[Drive] Folder index setup:", e.message);
  }
}

/**
 * Look for an existing folder by its stable appProperties key.
 * @param {object} drive
 * @param {string} parentId
 * @param {Object} props - appProperties to match exactly
 * @param {string} [name] - also match the name to disambiguate legacy folders
 * @returns {Promise<string|null>} folder id
 */
async function findFolderByProps(drive, parentId, props, name) {
  const clauses = Object.entries(props).map(([key, value]) => `appProperties has { key='${key}' and value='${String(value).replace(/'/g, "\\'")}' }`);
  const escapedName = String(name).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = [`'${parentId}' in parents`, "trashed=false", ...clauses, `name='${escapedName}'`].join(" and ");
  const res = await withRetry(() =>
    drive.files.list({
      q,
      spaces: "drive",
      corpora: "allDrives",     // required for shared drives
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: "files(id,name,trashed)",
      pageSize: 5,
    })
  );
  const files = res.data.files || [];
  return files.length ? files[0].id : null;
}

/**
 * Create a folder in Drive.
 * @returns {Promise<string>} new folder id
 */
async function createFolder(drive, { parentId, name, props }) {
  const res = await withRetry(() =>
    drive.files.create({
      supportsAllDrives: true,
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentId],
        appProperties: props,
      },
      fields: "id,name",
    })
  );
  return res.data.id;
}

/**
 * Confirm a cached folder id still exists and is not trashed.
 * @returns {Promise<boolean>}
 */
async function folderStillExists(drive, folderId) {
  try {
    const res = await withRetry(() =>
      drive.files.get({ fileId: folderId, supportsAllDrives: true, fields: "id,trashed" })
    );
    return Boolean(res.data && res.data.trashed !== true);
  } catch (e) {
    if ((e?.code ?? e?.response?.status) === 404) return false;
    throw e;
  }
}

/**
 * Find-or-create a single folder, cached in MongoDB.
 *
 * Concurrency: the cache has a UNIQUE index on `key`. If two requests race,
 * the loser's insert throws E11000, and it re-reads the winner's row instead
 * of creating a second folder. If a cached folder was trashed/deleted in
 * Drive, it is recreated and the cache is repointed.
 *
 * @param {import('mongodb').Db} db
 * @param {string|null} parentId - null for the root folder under the parent
 * @param {string} name - display name (sanitized before use)
 * @param {Object} props - stable appProperties identifying this folder
 * @param {string} key - stable cache key (derived from props, not from name)
 * @returns {Promise<{id: string, cached: boolean}>}
 */
async function ensureFolderCached(db, { parentId, name, props, key }) {
  await ensureFolderIndexes(db);
  const cache = db.collection(FOLDER_COLLECTION);

  // 1. Fast path: cache hit.
  const cachedRow = await cache.findOne({ key });
  if (cachedRow?.drive_id) {
    const drive = await getDrive();
    if (await folderStillExists(drive, cachedRow.drive_id)) {
      return { id: cachedRow.drive_id, cached: true };
    }
    // Cached folder was deleted/trashed. Drop the dead row so the recreation
    // below can be cached: leaving it in place would make every insert fail
    // with E11000 and hand back the dead id forever.
    await cache.deleteOne({ key });
    console.warn(`[Drive] Cached folder ${key} no longer exists in Drive; recreating.`);
  }

  const drive = await getDrive();

  // 2. Verify via Drive by stable appProperties before creating anything.
  const existingId = await findFolderByProps(drive, parentId, props, name);
  if (existingId) {
    await cache.updateOne(
      { key },
      { $set: { key, drive_id: existingId, name, props, parent_id: parentId, updated_at: new Date().toISOString() },
        $setOnInsert: { created_at: new Date().toISOString() } },
      { upsert: true }
    );
    return { id: existingId, cached: true };
  }

  // 3. Create.
  const newId = await createFolder(drive, { parentId, name, props });
  try {
    await cache.insertOne({ key, drive_id: newId, name, props, parent_id: parentId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  } catch (e) {
    // 4. Lost the race: another request cached the same key. Re-read winner.
    if (e?.code === 11000) {
      const winner = await cache.findOne({ key });
      if (winner?.drive_id && winner.drive_id !== newId) {
        // The concurrent request already created a folder for this key; adopt
        // theirs and trash the duplicate we just made so the tree stays clean.
        try {
          await withRetry(() => drive.files.update({ fileId: newId, supportsAllDrives: true, requestBody: { trashed: true } }));
        } catch (cleanupErr) {
          console.warn("[Drive] Could not trash duplicate folder:", cleanupErr.message);
        }
        return { id: winner.drive_id, cached: true };
      }
    }
    throw e;
  }
  return { id: newId, cached: false };
}

/**
 * Resolve (creating only what's missing) the full folder path for an upload.
 * Structure under the configured parent:
 *   Students/<UserFolder>/<TaskFolder>
 *   Management/<UserFolder>/<TaskFolder>
 *   CEO/<UserFolder>/<TaskFolder>
 *
 * @param {import('mongodb').Db} db
 * @param {Object} p
 * @param {string} p.role      - role from the verified JWT
 * @param {string} p.userId    - id from the verified JWT
 * @param {string} p.userName  - real display name from the users collection
 * @param {Object} p.task      - real task document
 * @returns {Promise<{taskFolderId: string, taskFolderName: string, userFolderId: string, userFolderName: string, rootName: string}>}
 */
async function ensureTaskFolder(db, { role, userId, userName, task }) {
  const parentFolderId = process.env[ENV_PARENT];
  const rootName = roleRoot(role);
  const taskId = String(task._id || task.id || "");
  if (!taskId) throw new Error("Cannot resolve a Drive folder without a real task id.");

  const uName = userFolderName(userName, userId);
  const tName = taskFolderName(task);

  const rootProps = { techinsType: "root", techinsRoleRoot: rootName };
  const root = await ensureFolderCached(db, {
    parentId: parentFolderId,
    name: rootName,
    props: rootProps,
    key: `root:${rootName}`,
  });

  const userProps = { techinsType: "user", techinsUserId: String(userId), techinsRoleRoot: rootName };
  const userFolder = await ensureFolderCached(db, {
    parentId: root.id,
    name: uName,
    props: userProps,
    key: `user:${rootName}:${userId}`,
  });

  const taskProps = { techinsType: "task", techinsUserId: String(userId), techinsTaskId: taskId, techinsRoleRoot: rootName };
  const taskFolder = await ensureFolderCached(db, {
    parentId: userFolder.id,
    name: tName,
    props: taskProps,
    key: `task:${rootName}:${userId}:${taskId}`,
  });

  return {
    taskFolderId: taskFolder.id,
    taskFolderName: tName,
    userFolderId: userFolder.id,
    userFolderName: uName,
    rootName,
  };
}

/* ─── UPLOAD ─────────────────────────────────────────────────────────────── */

/**
 * Build a collision-safe stored filename: `name (2).ext` style, never
 * overwriting. The ORIGINAL name is preserved separately in metadata.
 * @param {string} originalName
 * @param {Set<string>} taken - stored names already used in the target folder
 * @returns {string}
 */
function uniqueStoredFileName(originalName, taken) {
  const raw = String(originalName || "file");
  const dot = raw.lastIndexOf(".");
  const ext = dot > 0 ? raw.slice(dot) : "";
  let stem = dot > 0 ? raw.slice(0, dot) : raw;
  stem = sanitizeName(stem, MAX_FILE_NAME - ext.length) || "file";

  if (!taken || !taken.has(stem + ext)) return `${stem}${ext}`;

  // Probe increasing suffixes rather than assuming a count, so a name that
  // was deleted in between cannot produce a collision.
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  const stamped = `${stem} (${Date.now()})${ext}`;
  return stamped.slice(0, MAX_FILE_NAME);
}

/**
 * Read stored names already present in a folder (for collision handling).
 * @returns {Promise<Set<string>>}
 */
async function listFolderFileNames(drive, folderId) {
  const names = new Set();
  let pageToken;
  do {
    const res = await withRetry(() =>
      drive.files.list({
        q: `'${folderId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`,
        spaces: "drive",
        corpora: "allDrives",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        fields: "nextPageToken,files(name)",
        pageToken,
        pageSize: 1000,
      })
    );
    for (const f of res.data.files || []) if (f.name) names.add(f.name);
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return names;
}

/**
 * Create a Drive resumable upload session. Returns the session URL, which is a
 * SECRET: it is returned only to the authenticated client that requested it,
 * never logged and never persisted.
 *
 * @param {Object} p
 * @param {string} p.folderId
 * @param {string} p.storedFileName
 * @param {string} p.mimeType
 * @param {string} p.originalFileName
 * @param {string} p.userId
 * @param {string} p.taskId
 * @param {string} [p.submissionId]
 * @param {string} [p.userRole]
 * @returns {Promise<string>} resumable session URL
 */
async function createResumableSession({ folderId, storedFileName, mimeType, originalFileName, userId, taskId, submissionId, userRole }) {
  const drive = await getDrive();
  const session = await withRetry(() =>
    drive.files.create({
      supportsAllDrives: true,
      uploadType: "resumable",
      requestBody: {
        name: storedFileName,
        mimeType,
        parents: [folderId],
        appProperties: {
          techinsFile: "1",
          techinsUserId: String(userId),
          techinsUserRole: String(userRole || ""),
          techinsTaskId: String(taskId),
          techinsSubmissionId: String(submissionId || ""),
          techinsOriginalName: String(originalFileName || "").slice(0, 200),
        },
      },
      media: { mimeType },
    })
  );
  if (!session?.data?.uploadUrl) {
    const err = new Error("Google Drive did not return a resumable upload URL.");
    err.code = "DRIVE_SESSION_FAILED";
    throw err;
  }
  return session.data.uploadUrl;
}

/**
 * Fetch authoritative metadata for a Drive file. Used at finalize time to
 * verify what the client claims — the client is never trusted.
 * @param {string} fileId
 * @returns {Promise<{id:string,name:string,size:number,mimeType:string,parents:string[],appProperties:Object}>}
 */
async function getFileMetadata(fileId) {
  const drive = await getDrive();
  const res = await withRetry(() =>
    drive.files.get({
      fileId,
      supportsAllDrives: true,
      fields: "id,name,size,mimeType,parents,appProperties,trashed",
    })
  );
  return {
    id: res.data.id,
    name: res.data.name,
    size: Number(res.data.size || 0),
    mimeType: res.data.mimeType,
    parents: res.data.parents || [],
    appProperties: res.data.appProperties || {},
    trashed: res.data.trashed === true,
  };
}

/**
 * Stream a file's bytes from Drive using the service account credentials.
 * The resulting stream is piped to the authenticated caller; no public link is
 * ever created or used.
 * @param {string} fileId
 * @returns {Promise<ReadableStream>}
 */
async function downloadStream(fileId) {
  const drive = await getDrive();
  const res = await withRetry(() =>
    drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "stream" })
  );
  return res.data;
}

module.exports = {
  // config
  ENV_EMAIL, ENV_KEY, ENV_PARENT,
  isDriveConfigured,
  assertDriveConfigured,
  getDrive,
  // naming
  sanitizeName, shortId, roleRoot, userFolderName, taskFolderName, uniqueStoredFileName,
  // folders
  ensureFolderCached, ensureTaskFolder, listFolderFileNames, FOLDER_COLLECTION,
  // files
  createResumableSession, getFileMetadata, downloadStream,
  // errors
  driveErrorMessage, withRetry,
};