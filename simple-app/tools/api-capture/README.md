# API Capture — Chrome DevTools extension

A zero-dependency Chrome extension that adds an **"API Capture"** panel to DevTools. While the panel is open, it records every XHR/Fetch on the inspected tab, groups duplicate endpoints, redacts auth credentials, and lets you export the full API surface as a single JSON file.

Built to reverse-engineer the **Colorlight Cloud API** by observing the official dashboard, but works on any web app.

## Install (load unpacked)

1. In Chrome or Edge, go to `chrome://extensions/`
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder: `simple-app/tools/api-capture/`
5. The extension is now installed — no reload needed.

## Capture the Colorlight API

1. Open the Colorlight dashboard tab and log in.
2. Press **F12** to open DevTools.
3. Click the **API Capture** tab (next to Network, Console, etc).
4. The domain filter auto-fills to the current host. Leave it as-is.
5. Click **▶ Start capture**.
6. In the dashboard, do each of these once:
   - Refresh the device / screen list
   - Click into a single device to view its details / GPS
   - Upload a media file
   - Create or edit a program / playbill
   - Assign a program to a device and publish
   - Change a device's brightness
   - Restart a device
7. Click **■ Stop capture**.
8. Click **⬇ Export JSON** — the file saves to your Downloads folder.
9. Drop the file at `simple-app/docs/colorlight-api-capture.json` and let me know.

## What gets captured

For every XHR/Fetch request matching the domain filter:

```json
{
  "method": "GET",
  "path": "/wp-json/wp/v2/leds",
  "fullUrl": "https://example.com/wp-json/wp/v2/leds?page=1",
  "status": 200,
  "queryParams": { "page": "1" },
  "requestHeaders":  { "authorization": "[REDACTED]", "content-type": "application/json" },
  "requestBody":     null,
  "responseHeaders": { "content-type": "application/json" },
  "responseBody":    "[{ ... }]",
  "durationMs":      142,
  "timestamp":       "2026-04-27T10:30:00Z"
}
```

Identical `${method} ${path}` pairs are grouped. The export keeps up to **3 samples per endpoint** (varied by status code) so we see schema variation without bloat.

## Privacy / redaction

By default these are stripped to `[REDACTED]` before anything is shown or exported:

- Headers: `authorization`, `cookie`, `set-cookie`, `x-csrf-token`, `x-api-key`, `x-auth-token`, `x-access-token`
- JSON body fields named: `password`, `token`, `accessToken`, `refreshToken`, `secret`, `apiKey`, `api_key`, `access_token`, `refresh_token`

Uncheck **Redact auth** in the toolbar only if you trust where the export is going.

The extension never sends data anywhere — capture lives entirely in the DevTools session.

## Tips for clean captures

- **Don't refresh or close the inspected tab while capturing.** Chrome's DevTools clears its request store on navigation, which causes some response bodies to come back empty. Stop capture before navigating or use back/forward.
- **Login flows are now captured.** Non-GET requests of any resource type (including form-based logins like `/wp-login.php`) are recorded. Earlier versions only caught XHR/Fetch.
- If you need a focused capture for one feature, click **Clear** before performing the action so the export is small.

## Permissions

None. The extension uses only the `chrome.devtools.network` API, which is automatically scoped to the inspected tab. No host permissions, no content scripts, no background workers.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Manifest V3 |
| `devtools.html` / `devtools.js` | Registers the panel |
| `panel.html` / `panel.css` / `panel.js` | UI + capture / redaction / export logic |
| `icons/icon-{16,48,128}.png` | Extension icons |
