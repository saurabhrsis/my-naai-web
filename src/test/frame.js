// Pretends this page is inside another page's <iframe>.
//
// jsdom windows are always top-level, so the only way to exercise
// `isEmbeddedFrame()` / `isCrossOriginEmbeddedFrame()` — and the copy that
// depends on them — is to stand in a different `window.top`:
//
//   · a readable parent object        → a same-origin frame (prompts like a tab);
//   · a parent whose `document` getter throws → the cross-origin frame browsers
//     refuse `Notification.requestPermission()` in (that read is exactly how the
//     two cases are told apart in src/lib/permissions.js).
//
// Always `await` the callback form so the real `window.top` is restored even when
// an assertion throws.
export async function withFrame(top, run) {
  const original = Object.getOwnPropertyDescriptor(window, 'top');
  Object.defineProperty(window, 'top', { value: top, configurable: true });
  try {
    return await run();
  } finally {
    if (original) Object.defineProperty(window, 'top', original);
    else delete window.top;
  }
}

export function withSameOriginFrame(run) {
  return withFrame({ document: {} }, run);
}

export function withCrossOriginFrame(run) {
  const parent = Object.defineProperty({}, 'document', {
    configurable: true,
    get() {
      throw new Error('Blocked a frame with origin "https://example.com" from accessing a cross-origin frame.');
    },
  });
  return withFrame(parent, run);
}
