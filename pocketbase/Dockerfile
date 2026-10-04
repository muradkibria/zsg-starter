# DigiLite Hub — PocketBase, deployed as its own service.
#
# ══════════════════════════════════════════════════════════════════════════════
# THIS IMAGE HOLDS NO STATE. MOUNT A PERSISTENT VOLUME AT /pb/pb_data.
#
# PocketBase is DigiLite Hub's source of truth and keeps everything permanently:
# the schema, every bag's GPS history and ad plays, riders and their documents,
# loops and ad files, pay periods and the audit log. A container filesystem does
# not survive a redeploy, so with no volume this deploys green, works, and loses
# all of it the next time anyone pushes. Nothing logs a warning.
#
# Why that exact path: PocketBase puts its data directory BESIDE THE EXECUTABLE,
# not in the working directory. The release unzips to /pb, so the data is
# /pb/pb_data, and the hooks copied to /pb/pb_hooks are found. Moving the binary,
# adding a WORKDIR or passing --dir moves the data directory and orphans the
# volume: the mount stays empty while a new database appears beside the binary,
# which looks exactly like the volume not persisting. pocketbase/README.md has the
# check that proves a deploy kept its data.
# ══════════════════════════════════════════════════════════════════════════════
FROM alpine:latest

# Keep in step with PB_VERSION in dashboard/scripts/pocketbase.mjs (the local binary).
ARG PB_VERSION=0.40.4
# amd64 or arm64; docker buildx fills it in for the platform being built.
ARG TARGETARCH=amd64

RUN apk add --no-cache unzip ca-certificates

ADD https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip /tmp/pb.zip
RUN unzip /tmp/pb.zip -d /pb/ && rm /tmp/pb.zip

# Baked into the image, not the volume: a deploy ships the hooks and the next one
# replaces them. /pb/pb_hooks is where PocketBase looks, given the binary is at
# /pb/pocketbase.
COPY pb_hooks /pb/pb_hooks
# Empty on purpose (see README.md): the schema is scripts/setup-schema.js.
COPY pb_migrations /pb/pb_migrations

# Hosts like Railway inject PORT, and it isn't always 8080: binding a fixed port
# fails the health check while the process is fine.
ENV PORT=8080
EXPOSE 8080

# `superuser upsert` before serve, so POCKETBASE_EMAIL / POCKETBASE_PASSWORD create
# the account on an empty volume and rotate the password when they change. Guarded
# on both being set, and not `&&`, so a missing variable can't stop serve starting.
# --automigrate=false: schema changes made by the setup script must not write
# migration files.
CMD ["sh", "-c", "\
if [ -n \"$POCKETBASE_EMAIL\" ] && [ -n \"$POCKETBASE_PASSWORD\" ]; then \
  /pb/pocketbase superuser upsert \"$POCKETBASE_EMAIL\" \"$POCKETBASE_PASSWORD\" || echo 'superuser upsert failed'; \
fi; \
exec /pb/pocketbase serve --http=0.0.0.0:${PORT} --automigrate=false"]
