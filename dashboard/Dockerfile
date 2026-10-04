# DigiLite Hub — the API server, which also serves the built web app.
#
# PocketBase is a separate service (the repo's pocketbase/Dockerfile) with its own
# persistent volume; this image holds no data. Point POCKETBASE_URL at it, e.g. over
# a private network: POCKETBASE_URL=http://pocketbase.railway.internal:8080
#
# Apply the schema to that instance before deploying a version that needs new fields
# (from pocketbase/: POCKETBASE_URL=… npm run setup). This server refuses to start
# against a schema that's missing anything it relies on, rather than lose data.
#
# Environment: the five variables in the repo's .env.example (POCKETBASE_URL,
# POCKETBASE_EMAIL, POCKETBASE_PASSWORD, COLORLIGHT_USERNAME, COLORLIGHT_PASSWORD),
# the same set the PocketBase service takes, so a host can share one copy between
# them. It listens on the host's PORT, and session cookies are marked Secure when
# the request came over HTTPS.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production API_HOST=0.0.0.0
COPY --from=build /app /app
EXPOSE 4000
CMD ["node", "server/dist/index.js"]
