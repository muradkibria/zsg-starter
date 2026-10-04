# PocketBase — DigiLite Hub's database

PocketBase is DigiLite Hub's **record**: everything the dashboard shows is read from here, and everything is kept **permanently**, with no retention windows. The data comes from **Colorlight**, the only data source for now: the API server's Colorlight sync pulls bag status, GPS, ad plays, ads and loops on timers and records them here. If Colorlight later changes or drops something, the record here stands.

| path | what it is |
|---|---|
| `Dockerfile` | the image: PocketBase 0.40.4 unzipped to `/pb`, hooks copied in |
| `pb_hooks/` | `keep-history.pb.js` (history and audit records can't be deleted) and the `vacuum` route. Baked into the image |
| `scripts/setup-schema.js` | the schema, the API rules, the settings PocketBase needs, and the first rows. `npm run setup` |
| `pb_migrations/` | empty on purpose: the schema is the setup script, not a migration history |

Only the API server talks to PocketBase. Every collection is locked to the superuser, and the API server enforces roles itself. The browser never sees a PocketBase URL or token.

---

## 1. A persistent volume at `/pb/pb_data`, before anything else

**Mount a volume at exactly `/pb/pb_data`** (on Railway: Settings → Volumes → mount path `/pb/pb_data`).

Without one, this service works and then throws everything away on the next deploy: the schema, every bag's GPS and play history, riders and their documents, loops, ad files, pay periods and the audit log. Nothing warns you; the deploy is green either way.

**Why that exact path.** PocketBase puts its data directory beside the executable, not in the working directory. The release unzips to `/pb`, so the data is `/pb/pb_data` and the hooks in `/pb/pb_hooks` are found. Moving the binary, adding a `WORKDIR` or passing `--dir` moves the data directory and orphans the volume.

**The check that proves it took.** After a deploy, read the service log. A line offering a one-time superuser installer URL means the data directory was empty: either the volume isn't mounted where PocketBase looks, or it was just created. A data directory that survived prints only `Server started at …`. `df -h /pb/pb_data` in the service shell shows a mounted volume as its own device.

## 2. Backups

Data is kept for good, so back it up. The setup script turns on PocketBase's daily backup (03:30, keeping 3) if no schedule exists. Those land in `pb_data/backups`, on the same volume, so also point backups at S3: admin UI (`/_/`) → Settings → Backups. A schedule set there is left alone by the setup script.

## 3. The schema: `npm run setup`

```sh
# from this directory (npm install once); reads ../dashboard/.env for anything not set
npm run setup                               # apply
npm run setup -- --check                    # show what would change, change nothing
POCKETBASE_URL=https://… npm run setup      # against another instance (e.g. production)

# or from dashboard/
npm run setup:schema                        # same script; add -- --check to preview
```

It needs a superuser on the target instance: the image creates one at boot from `POCKETBASE_EMAIL` / `POCKETBASE_PASSWORD`. **Run it against production before deploying a version of the dashboard that needs new fields.** The API server checks the schema when it starts and refuses to run against one that's missing anything it relies on, so a forgotten run fails loudly instead of losing data (PocketBase would otherwise drop the unknown fields and answer 200).

What it promises:
- **Idempotent.** Missing collections are created; existing ones have their fields, indexes and API rules brought in line. A second run reports `ok` for everything.
- **It never drops data by itself.** A field that's in the database but not in the script stops the run with nothing changed. Check, then re-run with `--allow-drop`. A field can't change type in place; add one with a new name instead.
- **Fields keep their ids**, so a reconciled field keeps its column and its data.
- **Seeds are created once and never overwritten:** the settings row (`app_settings`, key `main`), the six provisional zones (only when there are no zones at all), and the first owner login from `OWNER_EMAIL` / `OWNER_PASSWORD` (only when no owner exists).
- **History never cascades.** No relation deletes history with its parent: deleting a bag, rider or loop that has history is refused.

## 4. What runs inside PocketBase

| hook | what it does |
|---|---|
| `keep-history.pb.js` | refuses to delete GPS points, ad plays, bag days, screenshots, changes sent to bags, loop sends, audit log entries and pay periods, whoever asks (the API, the admin UI or a cascade) |
| `POST /api/custom/vacuum` | superuser only: compacts the database file |

Two things worth knowing before writing a hook:
- **Each hook callback runs in its own JS runtime and can't see anything declared at the top of the file.** Put everything a callback needs inside it.
- With no `--hooksDir`, PocketBase loads `pb_hooks` from beside the executable: `/pb/pb_hooks` in the image, this directory's `pb_hooks` locally.

## 5. Running it locally

`npm run dev` from `dashboard/` starts it with everything else. On its own:

```sh
node scripts/pocketbase.mjs serve     # from dashboard/: downloads the binary on first use
```

The binary sits in this directory (gitignored), so its data (`pb_data/`, gitignored), hooks and migrations are the folders beside it, exactly as in the image. It runs with `--automigrate=false`: otherwise every schema change the setup script makes through the API is also written out as a migration file into `pb_migrations/`, which the image would replay on a fresh volume.

For a throwaway instance that can't touch the real data:

```sh
cd pocketbase
./pocketbase superuser upsert scratch@example.com scratchpw12345 --dir /tmp/pb/pb_data
./pocketbase serve --http=127.0.0.1:8199 --dir /tmp/pb/pb_data --migrationsDir /tmp/pb/pb_migrations --hooksDir ./pb_hooks --automigrate=false
POCKETBASE_URL=http://127.0.0.1:8199 POCKETBASE_EMAIL=scratch@example.com POCKETBASE_PASSWORD=scratchpw12345 npm run setup
```

## 6. Deploying (two services)

| service | built from | needs |
|---|---|---|
| `pocketbase` | `pocketbase/Dockerfile` (this directory) | a volume at `/pb/pb_data`; `POCKETBASE_EMAIL`, `POCKETBASE_PASSWORD`. Keep it private: only the API server needs to reach it |
| `hub` (API + web app) | `dashboard/Dockerfile` | `POCKETBASE_URL` pointing at the service above (e.g. `http://pocketbase.railway.internal:8080`), the same superuser login, and the rest of `.env.example` |

Order for a deploy that changes the schema: deploy `pocketbase` if its hooks changed, run `npm run setup` from here against it, then deploy `hub`.

**Restarting PocketBase revokes the API server's token.** Setting the superuser's password, which the image does at every boot, revokes every superuser token issued before it. The API server expects this: when PocketBase refuses its token it signs in again (one sign-in shared by every request refused at that moment) and resends the request, so a PocketBase redeploy needs no API restart.
