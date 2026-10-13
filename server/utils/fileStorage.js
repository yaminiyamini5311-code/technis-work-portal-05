/**
 * File Storage Utility - MongoDB GridFS
 * 
 * Serverless-compatible file storage using MongoDB GridFS.
 * Works on Vercel and locally without filesystem dependencies.
 * 
 * GridFS stores files in MongoDB chunks collection, with metadata
 * in files collection. Supports files up to 16MB (MongoDB document limit
 * is handled by chunking larger files automatically).
 */

const { GridFSBucket, ObjectId } = require("mongodb");

/**
 * Upload file to MongoDB GridFS
 * @param {Object} db - MongoDB database connection
 * @param {Buffer} buffer - File buffer from multer
 * @param {string} filename - Original filename
 * @param {Object} metadata - Additional metadata (mimetype, size, etc)
 * @returns {Promise<string>} - GridFS file ID
 */
async function uploadFile(db, buffer, filename, metadata = {}) {
  try {
    const bucket = new GridFSBucket(db, { bucketName: "submissions" });
    
    return new Promise((resolve, reject) => {
      const uploadStream = bucket.openUploadStream(filename, {
        metadata: {
          ...metadata,
          uploadedAt: new Date().toISOString()
        }
      });
      
      uploadStream.on("error", reject);
      uploadStream.on("finish", () => resolve(String(uploadStream.id)));
      
      uploadStream.end(buffer);
    });
  } catch (error) {
    console.error("[FileStorage] Upload error:", error.message);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}

/**
 * Download file from MongoDB GridFS
 * @param {Object} db - MongoDB database connection
 * @param {string} fileId - GridFS file ID
 * @returns {Promise<{stream: ReadableStream, file: Object}>}
 */
async function downloadFile(db, fileId) {
  try {
    const bucket = new GridFSBucket(db, { bucketName: "submissions" });
    
    // Get file metadata
    const files = await db.collection("submissions.files").find({ _id: new ObjectId(fileId) }).toArray();
    
    if (!files.length) {
      throw new Error("File not found");
    }
    
    const file = files[0];
    const downloadStream = bucket.openDownloadStream(new ObjectId(fileId));
    
    return { stream: downloadStream, file };
  } catch (error) {
    console.error("[FileStorage] Download error:", error.message);
    throw new Error(`Failed to download file: ${error.message}`);
  }
}

/**
 * Delete file from MongoDB GridFS
 * @param {Object} db - MongoDB database connection
 * @param {string} fileId - GridFS file ID
 */
async function deleteFile(db, fileId) {
  try {
    const bucket = new GridFSBucket(db, { bucketName: "submissions" });
    await bucket.delete(new ObjectId(fileId));
  } catch (error) {
    console.error("[FileStorage] Delete error:", error.message);
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}

/**
 * Check if file exists in GridFS
 * @param {Object} db - MongoDB database connection
 * @param {string} fileId - GridFS file ID
 * @returns {Promise<boolean>}
 */
async function fileExists(db, fileId) {
  try {
    const files = await db.collection("submissions.files").find({ _id: new ObjectId(fileId) }).limit(1).toArray();
    return files.length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Migrate old file from filesystem to GridFS
 * Called when downloading a file that has storage_path but no gridfs_id
 * @param {Object} db - MongoDB database connection
 * @param {string} storagePath - Local filesystem path
 * @param {string} filename - Original filename
 * @param {Object} metadata - File metadata
 * @returns {Promise<string|null>} - GridFS file ID or null if migration failed
 */
async function migrateFileToGridFS(db, storagePath, filename, metadata = {}) {
  try {
    const fs = require("fs");
    const path = require("path");
    
    // Check if file exists on filesystem
    const fullPath = path.isAbsolute(storagePath) ? storagePath : path.join(__dirname, "..", storagePath);
    
    if (!fs.existsSync(fullPath)) {
      console.log(`[FileStorage] Cannot migrate - file not found: ${storagePath}`);
      return null;
    }
    
    // Read file and upload to GridFS
    const buffer = fs.readFileSync(fullPath);
    const gridfsId = await uploadFile(db, buffer, filename, metadata);
    
    console.log(`[FileStorage] Migrated file to GridFS: ${storagePath} -> ${gridfsId}`);
    return gridfsId;
  } catch (error) {
    console.error(`[FileStorage] Migration error for ${storagePath}:`, error.message);
    return null;
  }
}

module.exports = {
  uploadFile,
  downloadFile,
  deleteFile,
  fileExists,
  migrateFileToGridFS
};
