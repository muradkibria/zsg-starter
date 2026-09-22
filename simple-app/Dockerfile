# ─────────────────────────────────────────────────────────────────────────────
# Route screenshot capture (server/screenshots/capture.ts) needs a real headless
# Chromium at runtime, which Railway's default Nixpacks build doesn't provide.
# This Dockerfile builds the app normally, then runs it on Microsoft's official
# Playwright image, which ships Chromium + all its system libraries preinstalled.
#
# Keep the runtime image tag's version in lockstep with the `playwright` npm
# dependency in package.json — a mismatch here is a common source of "browser
# not found" errors after bumping the package.
# ─────────────────────────────────────────────────────────────────────────────

# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.56.1-jammy AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# Chromium is already preinstalled in this base image, matched to the tag
# above — `npm ci` here only needs to bring in the JS dependencies.
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
