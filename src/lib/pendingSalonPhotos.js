// Salon photos taken during registration have nowhere to live yet: the salon
// record is only created once the plan payment succeeds, and `create-salon`
// accepts no image fields. So the photos are uploaded at registration time (the
// upload endpoint is public) and their URLs are parked here until the onboarding
// editor opens, where the partner saves the profile — that save is the first
// moment the salon can store images at all.
//
// Session-scoped on purpose: it is a hand-off between two screens in one signup,
// not a place to keep data.
const KEY = 'mynaai:pendingSalonPhotos';

const read = () => {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || '[]');
    return Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()) : [];
  } catch {
    return [];
  }
};

export function stashPendingSalonPhotos(urls = []) {
  const list = (Array.isArray(urls) ? urls : []).filter(item => typeof item === 'string' && item.trim()).slice(0, 4);
  try {
    if (list.length) sessionStorage.setItem(KEY, JSON.stringify(list));
    else sessionStorage.removeItem(KEY);
  } catch {
    // A full or blocked storage must not fail a signup over an optional photo.
  }
  return list;
}

// One-shot read: the editor takes the photos over and clears the hand-off, so a
// later visit to the editor never resurrects a photo the partner already
// replaced or removed.
export function takePendingSalonPhotos() {
  const list = read();
  if (list.length) {
    try { sessionStorage.removeItem(KEY); } catch { /* nothing to clear */ }
  }
  return list;
}

export function clearPendingSalonPhotos() {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
