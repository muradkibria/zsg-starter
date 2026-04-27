# Starter App — Using Claude Code

A blank React + Express scaffold designed to be built out by Claude Code. This guide is for people who are new to Claude Code (and maybe new to coding) and want to get the most out of it on this repo.

## First run

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. You should see "Starter App". That's your blank canvas.

Stop the server with `Ctrl+C`. Re-run `npm run dev` whenever you want to work on the app.

## What's in here

| Folder | What it is |
| --- | --- |
| `client/` | The frontend (React + Tailwind). Pages and UI live here. |
| `server/` | The backend (Express). API routes live in `server/routes.ts`. |
| `test/` | Test setup. Tests live next to the code they test. |

Both the frontend and backend run on the same port (3000) when you're developing — you don't need to think about it.

## How to talk to Claude Code

The single biggest factor in good results is **how clearly you describe what you want**. A few rules of thumb:

### Be specific

Not great: *"add a login page"*

Better: *"Add a login page at `/login` with email and password fields. On submit, POST to `/api/login`. For now, the server can just log the email and return `{ ok: true }`."*

### Work in small steps

Ask for one thing at a time, run it, see it work, then ask for the next thing. Trying to do everything at once leads to messes that are hard to undo.

### Show, don't describe

If you have an example screenshot, paste it. If you have a CSV of data, paste a few rows. If something is broken, paste the exact error message. Claude is much better at responding to concrete inputs than vague descriptions.

### Ask Claude to read first

For changes to existing code: *"Read `server/routes.ts`, then add a new route…"* This is faster and more reliable than guessing.

### Use plan mode for big changes

Press `Shift+Tab` to toggle plan mode. Claude will describe what it's going to do before doing it. Approve the plan if it looks right; redirect if it doesn't.

## Useful slash commands

- `/clear` — Start a fresh conversation. Use this between unrelated tasks so context doesn't get muddled.
- `/init` — Once you've built some of your app, run this to generate a `CLAUDE.md` file. Claude will read that file at the start of every future session, so it remembers your project's shape.
- `/help` — Lists all built-in commands.

## Patterns that work well

- **Refer to files with `@`** — typing `@server/routes.ts` in the chat tells Claude to read that file.
- **Paste error messages verbatim** — copy the entire error from the terminal or browser console.
- **Ask Claude to verify** — *"Run the dev server and check that the new page actually loads."*
- **Commit often** — after each working step, run `git add -A && git commit -m "what changed"`. If a later change breaks something, you can roll back.

## Things to avoid

- **Don't paste secrets into chat.** API keys, passwords, etc., go in a `.env` file (which is gitignored). Tell Claude *"the secret lives in `.env` as `OPENAI_API_KEY`"* — don't paste the value.
- **Don't accept changes you don't understand.** Ask: *"Explain what you changed and why."* If the answer doesn't make sense, push back.
- **Don't ask for "the whole app" in one prompt.** Build it piece by piece.

## When something breaks

1. **Read the error.** Paste it to Claude verbatim.
2. **Check the dev server log** in the terminal where `npm run dev` is running.
3. **Check the browser console** (right-click → Inspect → Console tab).
4. **Restart the dev server** if hot-reload gets confused (`Ctrl+C`, then `npm run dev`).
5. **`git diff`** shows you exactly what changed since your last commit. Ask Claude to explain anything that looks suspicious.

## Common scripts

```bash
npm run dev      # Start the dev server on http://localhost:3000
npm run build    # Build for production
npm start        # Run the production build
npm test         # Run tests
npm run check    # Type-check the code
```

## When you outgrow this guide

Once your app has real shape, run `/init` to create a `CLAUDE.md`. Add anything Claude should know about your project — conventions, deploy targets, gotchas. That file becomes the long-term memory for the repo.
