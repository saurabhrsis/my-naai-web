# Push notifications fail with `invalid_grant: Invalid JWT Signature`

The production log, verbatim:

```
Error sending push notification: FirebaseAppError: Credential implementation provided to
initializeApp() via the "credential" property failed to fetch a valid Google OAuth2 access
token with the following error: "invalid_grant: Invalid JWT Signature.". There are two
likely causes: (1) your server time is not properly synced or (2) your certificate key file
has been revoked.
```

Then, immediately after it, this:

```
🚀 FCM PAYLOAD SENT: { "data": { "title": "You missed a booking request", … }, "token": "f6f8vidl…" }
```

Those two lines together are the whole story. Push was **not** sent — that "sent" line was
printed *before* the call, unconditionally — and the same stack trace was printed once per
device token, every 20 seconds, for every salon with a phone. Nothing said which of Google's
two causes applied, and the token was in the log in full.

## What the error means

`Invalid JWT Signature` means Google could not verify the signature on the OAuth token that
`firebase-admin` signs with the service account's private key. There are exactly three ways
to get there, and only one of them is about time:

| Cause | How to tell it apart |
| --- | --- |
| **The key was deleted or revoked** in the Firebase console. This includes Google's automatic revocation of keys found in **public repositories**. | `private_key_id` is no longer in the certificate list Google publishes for that account |
| **The `private_key` does not belong to the `private_key_id`** in the same file — two keys were mixed, or one was edited/truncated while being copied into a variable | the key signs, but the certificate for *its own* key id rejects the signature |
| **The server's clock is minutes off** | the local time and Google's differ by more than a couple of minutes (`iat` in the future, or `exp` in the past) |

## Why this project hit it

`src/firebase/myNaai-firebase.json` — a full service-account key, `private_key` and
`private_key_id` included — was **committed to the repository**, and the repository is public.
Google revokes service-account keys it finds in public code, and a revoked key produces
exactly this error. The key that was in use (project `mynaai-a444d`, key id
`3b4fca39…77cc4`) is not recoverable: once a key is public it can never be trusted again,
whether or not it still works today.

Nothing in the repository could have fixed that, and no restart can. **The key has to be
replaced in the Firebase console**, and then push works again — which is what the patch
below makes possible without editing code.

## The fix, in order

1. **Generate a new key.**
   Firebase console → Project settings → **Service accounts** → *Generate new private key*.
   Download it. Do not commit it.

2. **Put it in the environment** of the API process, not in the repository. Either the whole
   JSON in one variable:

   ```bash
   # .env on the server (never in git)
   FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"mynaai-a444d",…}
   ```

   …or a path outside the repository:

   ```bash
   FIREBASE_SERVICE_ACCOUNT_PATH=/home/mynaai/secrets/mynaai-firebase.json
   ```

   `GOOGLE_APPLICATION_CREDENTIALS`, and the three older variables
   (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`) still work.
   A `.env` cannot hold a real newline, so `private_key` will arrive with literal `\n`;
   the patched loader repairs that (it handles `\n`, double-escaped `\\n`, stray quotes,
   BOMs and re-wrapped bodies) — no hand-editing of the key is needed or wanted.

3. **Delete the old key** in the same console page (Service accounts → your account →
   *Keys* → delete `3b4fca39…`). Assume it is compromised.

4. **Stop tracking the key file**, once the environment is configured:

   ```bash
   git rm --cached src/firebase/myNaai-firebase.json
   ```

   Deleting it from the current tree does not remove it from the history; the console
   deletion in step 3 is what actually neutralises it. `.gitignore` in the patch now
   refuses `src/firebase/*-firebase.json` so it cannot come back.

5. **Restart the API**, then confirm:

   ```bash
   npm run firebase:check                 # what is configured, and can it sign?
   npm run firebase:check -- --online     # is this key still published by Google?
   npm run firebase:check -- --send <device-token>   # one real push
   ```

   `--online` prints one verdict:

   ```
   credentials-look-valid     the key matches the certificate Google publishes
   key-revoked                the key id is gone — generate a new key (step 1)
   key-mismatch               private_key and private_key_id are from different keys
   clock-skew                 this server's clock is N seconds off Google's
   clock-skew-and-key-revoked both at once
   cannot-check-online        no egress; run the check somewhere that has internet
   ```

## What the patch changes (`backend-13-firebase-push-credentials.patch`)

| File | Change |
| --- | --- |
| `src/firebase/credentials.js` *(new)* | Credentials come from the environment first (`FIREBASE_SERVICE_ACCOUNT_JSON` → `_PATH` → `GOOGLE_APPLICATION_CREDENTIALS` → the three legacy variables → the committed file, deprecated). Repairs the ways a key arrives broken, then **validates** it: every required field, an RSA key that actually parses, `client_email` against `project_id`, a placeholder that was never a key. A configured-but-broken variable is reported, never silently skipped |
| `src/firebase/credentialsDoctor.js` *(new)* | Classifies a failure (credential / token / message / transient) and, for a credential failure, produces the verdict above: it signs the exact JWT `firebase-admin` would send and verifies it against the certificate Google publishes for that `private_key_id`, and compares the local clock with Google's. Never throws, never prints the key |
| `src/firebase/firebase.js` | One admin app, built from a checked credential. A broken credential no longer throws at `require` time (it used to be able to take the API down); it logs one actionable block and everything except push keeps working. Logs project, key id and source — never the secret |
| `src/firebase/sendNotification.js` | "sent" is only logged after the send resolved; tokens are masked (`f6f8vi…Tpw`); the payload is logged only with `FIREBASE_PUSH_DEBUG=1`; a credential failure **suspends push** for 10 minutes (`FIREBASE_PUSH_SUSPEND_MS`) with **one** diagnosis instead of a stack per token; a token is deactivated **only** for a genuinely dead token — never because the server's credential is wrong; transient errors get one retry with backoff |
| `cron/bookingRequestSweeper.cron.js` | While push is suspended the sweeper stops querying salon tokens for it. The in-app `Notification` row is still written, so the salon sees the miss in the app the next time it opens |
| `scripts/check-firebase-credentials.js` *(new)* | The operator command above (`npm run firebase:check`) |
| `scripts/test-firebase-credentials.js` *(new)* | 48 offline checks — every documented shape of a mangled key, the validation cases, the resolution order, the four classifications, all six verdicts (with certificates stubbed), and the sender's behaviour: the production error does not throw, does not deactivate the token, suspends push, and a dead token is still deactivated |
| `.gitignore`, `package.json` | Keys can no longer be committed; `firebase:check` / `firebase:test` scripts |

**What this does not do:** it cannot make a revoked key work. Until step 1–3 are done, push
stays off — but it now says so once, in one sentence, instead of burying the server log in
identical stack traces, and the in-app notifications keep being written.

## Verify

```bash
cd my_naai_backend
git am /path/to/patches/backend-13-firebase-push-credentials.patch
node scripts/test-firebase-credentials.js     # 48 checks
npm run firebase:check                        # credential found, signs, warnings printed

# after setting FIREBASE_SERVICE_ACCOUNT_JSON to the new key and restarting:
npm run firebase:check -- --online            # credentials-look-valid
npm run firebase:check -- --send <token>      # one real push
```

Then, in the API log, the only lines that should appear on the next sweep are:

```
🔔 [firebase] push ready — project mynaai-a444d, client firebase-adminsdk-…, key 8f21c0de… (env FIREBASE_SERVICE_ACCOUNT_JSON)
✅ [push] sent BOOKING_REQUEST_MISSED → f6f8vi…Tpw
```
