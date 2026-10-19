import { useEffect, useRef, useState } from "react";
import FixedOverlay from "./FixedOverlay";
import { fetchFileObjectUrl, downloadFile, formatBytes } from "../utils/api";
import TechinsIcon from "./TechinsIcon";
import "./FilePreview.css";

/**
 * One file preview for the whole app.
 *
 * Extracted from the Task Manager's inline dialog and shared with the CEO
 * Student Submissions page rather than duplicated.
 *
 * Behaviour that matters here:
 *   • The bytes always come from the authenticated endpoint
 *     (`fetchFileObjectUrl` sends the Authorization header), so Drive / GridFS
 *     is never exposed and a preview is never a public URL.
 *   • The overlay is a portal into <body>, so `position: fixed` resolves
 *     against the viewport and the panel is ~95vw x 95vh with its own scroll.
 *     Previously it was nested inside the animated page container and was
 *     sized against the scrolling page, which is what clipped it.
 *   • Preview and Download are separate actions. Download always sends the
 *     file to disk with its original name; it never opens the preview.
 */

const IMAGE_MIME = /^image\/(png|jpeg|gif|webp|bmp|avif)$/i;
const TEXT_MIME = /^text\/plain$/i;

/** Open parameters for the browser's native PDF viewer. */
const PDF_PARAMS = "#toolbar=1&navpanes=0&view=FitH";

/**
 * Hard ceiling on the byte fetch.
 *
 * The panel used to be able to sit on "Loading preview…" indefinitely: nothing
 * raced the request, so a hung socket left `loading` true forever with no way
 * out except closing the dialog. This bounds the wait and reports it as the
 * error it is. It is generous enough that a slow Drive or GridFS read on a
 * large PDF is not cut off.
 */
const LOAD_TIMEOUT_MS = 25000;

function isPreviewable(mime = "") {
  const m = String(mime).toLowerCase();
  return IMAGE_MIME.test(m) || m === "application/pdf" || TEXT_MIME.test(m);
}

function previewKind(mime = "") {
  const m = String(mime).toLowerCase();
  if (IMAGE_MIME.test(m)) return "image";
  if (m === "application/pdf") return "pdf";
  if (TEXT_MIME.test(m)) return "text";
  return "unsupported";
}

/** Plain-text preview: read the blob already in hand, never a second request. */
function TextPreview({ url }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => r.text())
      .then((t) => { if (!cancelled) setText(t.slice(0, 200000)); })
      .catch(() => { if (!cancelled) setError("Unable to read this text file."); });
    return () => { cancelled = true; };
  }, [url]);
  if (error) return <p className="fp-message fp-message-error">{error}</p>;
  return <pre className="fp-text">{text}</pre>;
}

export default function FilePreview({ file, onClose }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [zoom, setZoom] = useState(100); // Store as percentage for clearer UI
  const objectUrlRef = useRef(null);
  const iframeRef = useRef(null);

  const name = file?.name || "File";
  const kind = previewKind(file?.mime);
  const supported = isPreviewable(file?.mime);

  useEffect(() => {
    if (!file) return undefined;
    let cancelled = false;
    let timer = null;
    setUrl(null);
    setError("");
    setLoading(true);
    setZoom(100); // Reset zoom on file change
    (async () => {
      try {
        // Race the fetch against a timer so a hung socket cannot pin the panel
        // on "Loading preview…" with no way to recover.
        const objectUrl = await Promise.race([
          fetchFileObjectUrl(file.preview_url || file.download_url),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Timed out while loading this file. Download it instead.")),
              LOAD_TIMEOUT_MS,
            );
          }),
        ]);
        if (cancelled) { URL.revokeObjectURL(objectUrl); return; }
        objectUrlRef.current = objectUrl;
        setUrl(objectUrl);
      } catch (e) {
        if (!cancelled) setError(e.message || "Unable to preview this file.");
      } finally {
        if (timer) clearTimeout(timer);
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; if (timer) clearTimeout(timer); if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); };
  }, [file]);

  async function handleDownload() {
    if (downloading) return;
    setDownloading(true);
    setError("");
    try {
      await downloadFile(file);
    } catch (e) {
      setError(e.message || "Unable to download this file.");
    } finally {
      setDownloading(false);
    }
  }

  const handleZoomIn = () => setZoom(z => Math.min(300, z + 25));
  const handleZoomOut = () => setZoom(z => Math.max(50, z - 25));
  const handleZoomReset = () => setZoom(100);

  return (
    <FixedOverlay
      open={Boolean(file)}
      onClose={onClose}
      label={`Preview of ${name}`}
      panelClassName="fixed-overlay-panel fp-panel"
      zIndex={2000}
    >
      {/* Header: filename on left, controls on right */}
      <div className="panel-head fp-head">
        <div className="fp-title">
          <span className="section-kicker">FILE PREVIEW</span>
          <h3 title={name}>{name}</h3>
          <small>
            {file?.mime || "unknown type"}
            {file?.size ? ` · ${formatBytes(file.size)}` : ""}
          </small>
        </div>
        <div className="fp-actions">
          <button type="button" className="fp-btn fp-btn-download" onClick={handleDownload} disabled={downloading}>
            <TechinsIcon name="download" size={14} variant="light" ariaHidden />
            {downloading ? "Downloading…" : "Download"}
          </button>
          {/* Zoom controls for PDF - moved to header */}
          {!loading && !error && supported && url && kind === "pdf" && (
            <>
              <button type="button" className="fp-btn fp-btn-zoom" onClick={handleZoomOut} aria-label="Zoom out" disabled={zoom <= 50}>−</button>
              <span className="fp-zoom-display" aria-live="polite">{zoom}%</span>
              <button type="button" className="fp-btn fp-btn-zoom" onClick={handleZoomIn} aria-label="Zoom in" disabled={zoom >= 300}>+</button>
              <button type="button" className="fp-btn fp-btn-zoom" onClick={handleZoomReset} disabled={zoom === 100}>Reset</button>
            </>
          )}
          <button type="button" className="fp-btn fp-btn-close" onClick={onClose} data-autofocus>Close</button>
        </div>
      </div>

      <div className="panel-body fp-body">
        {/* Centred in the preview area. Previously this was a 12px-tall
            left-aligned strip with no min-height, so in a ~700px-tall body it
            read as an empty panel with a spinner stuck to the left edge. */}
        {loading && (
          <div className="fp-loading" role="status">
            <span className="fp-spinner" aria-hidden="true" />
            <span>Loading preview…</span>
          </div>
        )}

        {!loading && error && (
          <div className="fp-message fp-message-error" role="alert">
            <span>{error}</span>
            <button type="button" className="fp-btn fp-btn-download" onClick={handleDownload} disabled={downloading}>
              <TechinsIcon name="download" size={14} variant="light" ariaHidden />
              {downloading ? "Downloading…" : "Download instead"}
            </button>
          </div>
        )}

        {!loading && !error && !supported && (
          <div className="fp-message">
            <strong>Preview not available for this file type.</strong>
            <span>
              {file?.mime || "This file"} cannot be shown safely in the browser.
              Download it to open it in its own application.
            </span>
            <button type="button" className="fp-btn fp-btn-download" onClick={handleDownload} disabled={downloading}>
              <TechinsIcon name="download" size={14} variant="light" ariaHidden />
              {downloading ? "Downloading…" : "Download file"}
            </button>
          </div>
        )}

        {!loading && !error && supported && url && (
          <>
            <div className="fp-stage">
              {kind === "image" && (
                <img
                  className="fp-image"
                  src={url}
                  alt={name}
                  style={zoom !== 100 ? { width: `${zoom}%`, maxWidth: "none" } : undefined}
                />
              )}
              {kind === "pdf" && (
                <iframe
                  ref={iframeRef}
                  className="fp-pdf"
                  src={`${url}${PDF_PARAMS}`}
                  title={`Preview of ${name}`}
                  style={zoom !== 100 ? { 
                    width: `${10000 / zoom}%`, 
                    height: `${10000 / zoom}%`, 
                    transform: `scale(${zoom / 100})`, 
                    transformOrigin: 'top left' 
                  } : undefined}
                />
              )}
              {kind === "text" && <TextPreview url={url} />}
            </div>
          </>
        )}
      </div>
    </FixedOverlay>
  );
}

export { isPreviewable, previewKind };