require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { MongoClient, ObjectId, GridFSBucket } = require("mongodb");
const { ensureStudentFolder, uploadToDrive } = require("../utils/driveStorage");

const args = process.argv.slice(2);
const dryRun = !args.includes("--apply");
const deleteOld = args.includes("--delete-old");

(async () => {
  if (!process.env.MONGODB_URI) { console.error("MONGODB_URI missing"); process.exit(1); }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "techins");
  const files = await db.collection("submission_files").find({ gridfs_id: { $exists: true, $ne: null }, drive_file_id: { $exists: false } }).toArray();
  console.log("Found", files.length, "GridFS files to migrate. dryRun=" + dryRun);
  let ok = 0;
  for (const f of files) {
    const sub = await db.collection("submissions").findOne({ _id: new ObjectId(String(f.submission_id)) });
    const sid = sub ? String(sub.student_id) : null;
    try {
      const bucket = new GridFSBucket(db, { bucketName: "submissions" });
      const chunks = [];
      await new Promise((resolve, reject) => {
        const stream = bucket.openDownloadStream(new ObjectId(String(f.gridfs_id)));
        stream.on("data", (d) => chunks.push(d));
        stream.on("end", resolve);
        stream.on("error", reject);
      });
      const buffer = Buffer.concat(chunks);
      if (dryRun) { console.log("[dry-run] would migrate", f._id, f.original_name, buffer.length, "bytes"); ok++; continue; }
      const folder = sid ? await ensureStudentFolder(db, sid) : null;
      const parentId = folder ? folder.id : process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
      const driveFile = await uploadToDrive(buffer, f.original_name, f.mime_type, parentId, "MIGRATED_" + f.original_name);
      await db.collection("submission_files").updateOne({ _id: f._id }, { $set: { drive_file_id: driveFile.id, drive_folder_id: parentId, storage_type: "drive", migrated_at: new Date().toISOString() } });
      if (deleteOld) await bucket.delete(new ObjectId(String(f.gridfs_id)));
      ok++;
      console.log("Migrated", f._id, "->", driveFile.id);
    } catch (e) {
      console.error("Failed", f._id, e.message);
    }
  }
  console.log("Done. migrated=" + ok + "/" + files.length);
  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
