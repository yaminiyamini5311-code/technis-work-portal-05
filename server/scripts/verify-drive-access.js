/**
 * Verify Google Drive credentials and root-folder access.
 *
 * Usage:  node scripts/verify-drive-access.js
 *
 * Prints ONLY status information (never secrets). Exit code 0 = accessible.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { verifyRootAccess, authType, ROOT_FOLDER_ID } = require("../utils/driveStorage");

(async () => {
  const result = await verifyRootAccess();
  const out = {
    ok: result.ok,
    authType: result.authType || authType(),
    configured: authType() !== "none",
    rootFolderConfigured: !!process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
    rootFolderIdSuffix: ROOT_FOLDER_ID().slice(-6),
    folderName: result.folder ? result.folder.name : null,
    driveId: result.folder ? result.folder.driveId || null : null,
    status: result.status || null,
    error: result.error || null,
    hint: result.hint || null,
  };
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok && out.authType === "none") {
    console.error("\nACTION REQUIRED: set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET and");
    console.error("GOOGLE_DRIVE_REFRESH_TOKEN (OAuth, recommended for a folder in a personal Drive),");
    console.error("or GOOGLE_SERVICE_ACCOUNT_KEY_PATH / GOOGLE_SERVICE_ACCOUNT_JSON (Shared Drives).");
  } else if (!out.ok) {
    console.error("\nACTION REQUIRED: the configured account cannot open the root folder.");
    console.error("Share the TECHINS 60 root folder with that account as Editor, then re-run this script.");
  }
  process.exit(out.ok ? 0 : 1);
})().catch((e) => {
  console.error("verification failed:", e.message);
  process.exit(1);
});