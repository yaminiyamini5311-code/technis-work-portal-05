import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import './SuccessModal.css';
import TechinsIcon from './TechinsIcon';

/**
 * Shared Success Modal Component
 * 
 * Renders via React Portal to document.body to ensure proper viewport-fixed positioning.
 * Prevents positioning issues caused by parent containers with transform, overflow, or position.
 * 
 * Features:
 * - Viewport-fixed centering (works at any scroll position)
 * - Auto-close after 4 seconds
 * - ESC key to close
 * - Click backdrop to close
 * - Accessible focus management
 * - Mobile-responsive (100dvh, proper padding)
 */
function SuccessModal({ isOpen, onClose, title = "Task Submitted Successfully!", details }) {
  useEffect(() => {
    if (!isOpen) return;

    // Auto-close after 4 seconds
    const timer = setTimeout(() => {
      onClose();
    }, 4000);

    // ESC key to close
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };

    // Prevent body scroll while modal is open
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEsc);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="success-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="success-modal-title">
      <div className="success-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="success-modal-icon">
          <TechinsIcon name="check" size={40} variant="light" />
        </div>
        
        <h2 id="success-modal-title" className="success-modal-title">{title}</h2>
        
        <p className="success-modal-message">
          Your task submission has been saved successfully.
        </p>

        {details && (
          <div className="success-modal-details">
            {details.taskTitle && (
              <div className="success-modal-detail-row">
                <strong>Task:</strong>
                <span>{details.taskTitle}</span>
              </div>
            )}
            {details.submissionCode && (
              <div className="success-modal-detail-row">
                <strong>Submission Code:</strong>
                <span>{details.submissionCode}</span>
              </div>
            )}
            {details.version !== undefined && (
              <div className="success-modal-detail-row">
                <strong>Version:</strong>
                <span>v{details.version}</span>
              </div>
            )}
            {details.status && (
              <div className="success-modal-detail-row">
                <strong>Status:</strong>
                <span>{details.status}</span>
              </div>
            )}
            {details.submittedAt && (
              <div className="success-modal-detail-row">
                <strong>Submitted At:</strong>
                <span>{new Date(details.submittedAt).toLocaleString()}</span>
              </div>
            )}
          </div>
        )}

        <button 
          className="success-modal-button gold-btn" 
          onClick={onClose}
          autoFocus
        >
          Done
        </button>
      </div>
    </div>,
    document.body
  );
}

export default SuccessModal;
