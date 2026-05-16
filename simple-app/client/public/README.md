# Public assets

Files in this folder are served at the site root by Vite.

## Logos (required for the rebrand)

Save the two DigiLite logo images here with these exact filenames:

| File | What it is | Where it shows |
|------|-----------|----------------|
| `digilite-logo.png` | Full colour wordmark — "DIGILITE ADVERTISING" with the D-mark | Login screen (over the dark gradient) |
| `digilite-logo-mark.png` | Compact D-mark with "ADVERTISING" subtitle | Sidebar (auto-whitened via CSS filter) + browser favicon |

PNG with transparent background works best. The sidebar applies `filter: brightness(0) invert(1)` so the mark file should be a dark image on transparent background — anything dark will read as white on the deep-blue sidebar.
