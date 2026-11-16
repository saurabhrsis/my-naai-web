import React, { useRef, useState } from 'react';
import { Camera, ImagePlus } from 'lucide-react';
import { Modal } from './Shared';

// Every photo a partner adds can come from one of two places, and only the
// partner knows which: the camera, right there at the salon, or the phone's
// gallery with pictures taken earlier. A plain `<input type="file">` on Android
// and iOS offers the gallery only (or a generic "files" sheet), so a partner
// signing up had no way to shoot a quick photo of their storefront.
//
// This control asks the question, then opens the matching input:
//   • "Take photo"      → `<input capture="environment">`, the back camera;
//   • "Choose from gallery" → the same input without `capture`, the photo library.
//
// It replaces the bare file input everywhere an image is added (product images,
// salon photos, barber photos and salon registration), so the choice is the same
// in every one of them.
export function ImageSourcePicker({
  onFiles,
  multiple = false,
  accept = 'image/*',
  title = 'Add a photo',
  className = '',
  ariaLabel,
  disabled = false,
  children,
}) {
  const [open, setOpen] = useState(false);
  const cameraRef = useRef(null);
  const galleryRef = useRef(null);

  const handleFiles = event => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    setOpen(false);
    if (files.length) onFiles?.(multiple ? files : files.slice(0, 1));
  };

  const openInput = ref => {
    setOpen(false);
    // The click has to happen inside the tap that chose the source: mobile
    // browsers only open the camera/gallery for a user gesture.
    ref.current?.click();
  };

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} size="small">
        <div className="image-source-sheet">
          <p className="image-source-hint">Take a new photo now, or pick one you already have.</p>
          <div className="image-source-actions">
            <button type="button" className="image-source-option" onClick={() => openInput(cameraRef)}>
              <span className="image-source-mark"><Camera size={19} /></span>
              <span><strong>Take photo</strong><small>Opens the camera</small></span>
            </button>
            <button type="button" className="image-source-option" onClick={() => openInput(galleryRef)}>
              <span className="image-source-mark"><ImagePlus size={19} /></span>
              <span><strong>Choose from gallery</strong><small>Photos already on this device</small></span>
            </button>
          </div>
          {/* The camera input asks for the REAR camera: a partner photographs
              the shop, not themself. */}
          <input ref={cameraRef} type="file" accept={accept} capture="environment" multiple={multiple} onChange={handleFiles} className="image-source-input" tabIndex={-1} aria-hidden="true" />
          <input ref={galleryRef} type="file" accept={accept} multiple={multiple} onChange={handleFiles} className="image-source-input" tabIndex={-1} aria-hidden="true" />
        </div>
      </Modal>
    </>
  );
}

export default ImageSourcePicker;
