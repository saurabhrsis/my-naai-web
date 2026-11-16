import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ImageSourcePicker } from './ImageSourcePicker';

// A partner adding a photo must be able to choose WHERE it comes from: the
// camera in their hand, or the gallery they already filled. This pins that both
// inputs exist, that only the camera one asks for `capture` (the rear camera),
// and that a chosen file reaches the caller.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('ImageSourcePicker', () => {
  let container = null;
  let root = null;

  const mount = props => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<ImageSourcePicker title="Add salon photos" {...props}><span>Add photo</span></ImageSourcePicker>));
  };
  const buttonByText = text => Array.from(container.querySelectorAll('button')).find(node => node.textContent.includes(text));

  beforeEach(() => { vi.clearAllMocks(); });

  afterEach(() => {
    if (root) act(() => root.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it('asks camera or gallery instead of dropping straight into the gallery', () => {
    mount({ onFiles: vi.fn() });

    // Closed until asked: no picker UI leaks onto the form.
    expect(container.querySelector('.image-source-sheet')).toBeNull();

    act(() => { buttonByText('Add photo').click(); });

    expect(container.querySelector('.image-source-sheet')).not.toBeNull();
    expect(buttonByText('Take photo')).toBeTruthy();
    expect(buttonByText('Choose from gallery')).toBeTruthy();

    const inputs = Array.from(container.querySelectorAll('input[type="file"]'));
    expect(inputs).toHaveLength(2);
    const camera = inputs.find(input => input.getAttribute('capture'));
    const gallery = inputs.find(input => !input.getAttribute('capture'));
    // The camera input asks for the REAR camera: a partner photographs the shop.
    expect(camera.getAttribute('capture')).toBe('environment');
    expect(gallery).toBeTruthy();
    expect(inputs.every(input => input.type === 'file' && input.accept === 'image/*')).toBe(true);
  });

  it('hands the chosen file to the caller and closes the chooser', () => {
    const onFiles = vi.fn();
    mount({ onFiles, multiple: true });
    act(() => { buttonByText('Add photo').click(); });

    const camera = container.querySelector('input[capture]');
    const file = new File(['photo'], 'salon.jpg', { type: 'image/jpeg' });
    act(() => {
      Object.defineProperty(camera, 'files', { value: [file], configurable: true });
      camera.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0]).toEqual([file]);
    expect(container.querySelector('.image-source-sheet')).toBeNull();
  });
});
