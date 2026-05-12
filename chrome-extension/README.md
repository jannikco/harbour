# Harbour LinkedIn Bridge — Chrome extension

Lives in your daily Chrome. Does two things for Harbour:

1. **Syncs your LinkedIn session cookies** to Harbour every 5 minutes, so the
   Playwright fallback always has fresh auth (no more "session expired" hours).
2. **Sends approved DM drafts** by calling LinkedIn's Voyager API from your
   real browser. The network traffic looks identical to clicking Send in the
   UI manually — because it IS the same browser, same cookies, same
   fingerprint. LinkedIn cannot distinguish.

Without this extension, Harbour falls back to a headless Playwright Chromium
which has a distinguishable browser fingerprint LinkedIn's bot detection can
flag.

## Install (one-time, ~2 min)

### 1. Generate an extension token in Harbour

1. Open `http://localhost:3000/linkedin` in any browser.
2. Scroll to **Browser session → Extension token**.
3. Click **Generate**. Copy the `hbr_ext_...` value shown ONCE.

### 2. Load this extension in your daily Chrome

1. In your daily Chrome (the one you're logged into LinkedIn with), open
   `chrome://extensions`.
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked**, point at this directory:
   `/Users/jh/GitHub/harbour/chrome-extension/`.
4. The extension appears as **Harbour LinkedIn Bridge**. Pin it to the toolbar.

### 3. Configure the extension

1. Click the extension icon. Popup opens.
2. **Harbour URL**: defaults to `http://localhost:3000`. Change if you run
   Harbour on another port.
3. **Extension token**: paste the `hbr_ext_...` value from step 1.
4. Click **Save**, then **Sync cookies now** to test.
5. You should see 🟢 *"Cookies synced just now · N cookies"*. If it says
   *"no li_at cookie"*, log into LinkedIn in this Chrome profile first.

### 4. Enable extension-mode in Harbour

1. Back in `/linkedin` settings → toggle **"Send via Chrome extension"** ON.
2. Approved drafts will now ship via your real Chrome instead of via the
   Playwright fallback.

## How it works

- **Cookie sync** (every 5 min):
  - Reads ALL cookies for `linkedin.com` and `.linkedin.com` (including
    httpOnly ones like `li_at` via `chrome.cookies.getAll`).
  - Captures `navigator.userAgent` from your real Chrome.
  - POSTs to `${harbourUrl}/api/linkedin/session-sync` with your token.
  - Harbour atomically updates `~/.harbour/state/linkedin-storage.json` so
    any Playwright workflow that still runs uses your real browser's auth.

- **Action polling** (every 1 min):
  - GETs `${harbourUrl}/api/linkedin/extension/pending-actions`.
  - The server returns approved drafts as `{ id, conversation_urn, body, ... }`
    objects, gated by the same pacing rules (active hours, max writes/hour,
    daily cap) that gate Playwright. Returns `[]` outside active hours or
    when the daily cap is hit.
  - For each action, the extension POSTs to LinkedIn Voyager API:
    `POST https://www.linkedin.com/voyager/api/messaging/conversations/<urn>/events?action=create`
    with the `csrf-token` header (from `JSESSIONID` cookie).
  - Reports success/failure to
    `${harbourUrl}/api/linkedin/extension/actions/{id}/report`.
  - Between actions: random 15–45s jitter sleep.

## Troubleshooting

- **Popup shows 🔴 "no li_at cookie"** — log into linkedin.com in this Chrome
  profile, then click "Sync cookies now" again.
- **🔴 "HTTP 401"** — the extension token is wrong or has been revoked.
  Regenerate in `/linkedin` and paste the new value.
- **🔴 "Action poll error"** — Harbour isn't reachable. Confirm
  `http://localhost:3000/linkedin` loads in this Chrome.
- **Actions return but messages don't arrive in LinkedIn** — LinkedIn may
  have changed the Voyager API. Open DevTools → Network on linkedin.com,
  send a manual DM, inspect the POST request. Update the URL/body shape in
  `background.js → executeSendDm`.

## Privacy

- Token and cookies stay between your Chrome and your Harbour. Nothing
  leaves your machine. The extension does not contact any third party.
- The token is rotatable: regenerate in `/linkedin` settings any time. The
  old key is invalidated immediately.

## Permissions explained

- `cookies` — to read your LinkedIn session (httpOnly cookies require this API).
- `storage` — to remember your Harbour URL + token between popups.
- `alarms` — to schedule the periodic sync + poll without keeping the
  service worker awake unnecessarily.
- `host_permissions: linkedin.com + localhost` — to read LinkedIn cookies
  and to call your local Harbour.
