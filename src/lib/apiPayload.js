// Shared API payload helpers.
//
// `withDeviceToken` used to live inside App.jsx, which meant any other surface
// that needed to hand the browser's notification token to the API (the Alerts &
// permissions card's end-to-end test alert, for one) had to duplicate a
// mobile-contract rule. One copy, one behaviour:
//
//   · a real token is attached as `deviceToken`, exactly like the mobile app;
//   · when there is no token the key is omitted entirely — never sent as an
//     empty string, so a backend that only validates it when present keeps
//     working while one that requires it answers with a message the app turns
//     into the one-tap alerts sheet.
export function normalizeDeviceToken(token) {
  return typeof token === 'string' ? token.trim() : '';
}

export function withDeviceToken(payload, token) {
  const value = normalizeDeviceToken(token);
  return value ? { ...payload, deviceToken: value } : { ...payload };
}
