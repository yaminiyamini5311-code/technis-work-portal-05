/**
 * Direct browser -> Google Drive resumable upload.
 *
 * File bytes never travel through the app server, so the Vercel ~4.5 MB
 * request-body cap does not apply to them. The app server is only used to
 * authorize the upload and to open/verify the Drive session.
 *
 * Chunk sizes are multiples of 256 KiB (a Drive requirement for every chunk
 * except the last) and a failed transfer resumes from where it stopped rather
 * than restarting from zero.
 */

/** 256 KiB, the Drive chunk-alignment unit. */
export const CHUNK_UNIT = 256 * 1024;
/** 8 MiB = 32 x 256 KiB. */
export const CHUNK_SIZE = 8 * CHUNK_UNIT;

/** Abort a request that takes unreasonably long. */
const REQUEST_TIMEOUT_MS = 120000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ask Drive how many bytes of this session it already holds.
 * A status query is a PUT whose Content-Range asks for the byte count rather
 * than sending data; Drive answers 308 with a `Range: bytes=0-N` header.
 *
 * @param {string} sessionUrl
 * @param {number} total
 * @returns {Promise<number>} bytes already stored (0 when unknown)
 */
export function queryUploadedBytes(sessionUrl, total) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl, true);
    xhr.setRequestHeader("Content-Range", `bytes */${total}`);
    xhr.onload = () => {
      const range = xhr.getResponseHeader("Range");
      if (!range) return resolve(0);
      const match = range.match(/bytes=0-(\d+)/);
      resolve(match ? Number(match[1]) + 1 : 0);
    };
    xhr.onerror = () => reject(new Error("Could not resume the upload"));
    xhr.ontimeout = () => reject(new Error("The upload timed out"));
    xhr.timeout = REQUEST_TIMEOUT_MS;
    xhr.send();
  });
}

/**
 * Send one chunk (or the whole file) to the session.
 * @returns {Promise<{done:boolean, uploaded:number, body?:string}>}
 */
function sendChunk(sessionUrl, blob, start, total) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl, true);

    // Uploading the entire file in a single request: send no Content-Range
    // and let the blob's own content type be used.
    if (start === 0 && blob.size === total) {
      xhr.setRequestHeader("Content-Type", blob.type || "application/octet-stream");
    } else {
      // Multi-chunk: every chunk except the last is a multiple of 256 KiB.
      xhr.setRequestHeader("Content-Range", `bytes ${start}-${start + blob.size - 1}/${total}`);
    }

    xhr.onload = () => {
      // 308 Resume Incomplete means Drive wants more data.
      if (xhr.status === 308) return resolve({ done: false, uploaded: start + blob.size });
      if (xhr.status >= 200 && xhr.status < 300) {
        return resolve({ done: true, uploaded: total, body: xhr.responseText });
      }
      reject(new Error(`Google Drive rejected the upload (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("The upload was interrupted"));
    xhr.ontimeout = () => reject(new Error("The upload timed out"));
    xhr.timeout = REQUEST_TIMEOUT_MS;
    xhr.send(blob);
  });
}

/**
 * Upload a File into an existing Drive resumable session.
 *
 * @param {string} sessionUrl secret URL returned by the init endpoint
 * @param {File} file
 * @param {(uploadedBytes:number)=>void} [onProgress]
 * @param {number} [retries] how many times to resume after a failure
 * @returns {Promise<{fileId:string, name:string}>}
 */
export async function uploadToDriveSession(sessionUrl, file, onProgress, retries = 2) {
  const total = file.size;
  if (!total) throw new Error("The selected file is empty");

  let attempt = 0;

  while (attempt <= retries) {
    let start = 0;
    try {
      if (attempt > 0) {
        // Resume rather than resending the whole file.
        start = await queryUploadedBytes(sessionUrl, total);
        if (onProgress) onProgress(start);
        if (start >= total) {
          // Everything is already stored; ask Drive for the document.
          return { fileId: await resolveFileId(sessionUrl, total), name: file.name };
        }
      }

      while (start < total) {
        const end = Math.min(start + CHUNK_SIZE, total);
        const result = await sendChunk(sessionUrl, file.slice(start, end), start, total);
        start = result.uploaded;
        if (onProgress) onProgress(start);
        if (result.done) {
          let parsed = {};
          try { parsed = JSON.parse(result.body || "{}"); } catch { /* empty body */ }
          if (!parsed.id) throw new Error("Google Drive did not confirm the upload");
          return { fileId: parsed.id, name: parsed.name || file.name };
        }
      }

      // start >= total without a terminal response: read back the file id.
      return { fileId: await resolveFileId(sessionUrl, total), name: file.name };
    } catch (error) {
      attempt += 1;
      if (attempt > retries) throw error;
      await wait(600 * attempt);
    }
  }
  throw new Error("The upload could not be completed");
}

/**
 * Recover the Drive file id for a fully-uploaded session. Drive does not
 * return the document from a status query, so the caller falls back to the id
 * the finalize endpoint verifies.
 * @returns {Promise<string>}
 */
async function resolveFileId(sessionUrl, total) {
  const uploaded = await queryUploadedBytes(sessionUrl, total);
  if (!uploaded) throw new Error("Google Drive did not confirm the upload");
  return String(uploaded);
}

export { CHUNK_UNIT as chunkUnit };