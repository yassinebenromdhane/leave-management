# One image: built React app + bundled Hono server, one Node process.
FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY shared shared
COPY server server
COPY web web
RUN pnpm build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST=/app/public \
    UPLOAD_DIR=/data/uploads \
    MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
# Native modules cannot be bundled by esbuild (server/build.mjs NATIVE_EXTERNALS):
# install them for this image's platform (linux-musl), pinned to the server's version.
COPY --from=build /repo/server/package.json /tmp/server-package.json
RUN ARGON2=$(node -p "require('/tmp/server-package.json').dependencies['@node-rs/argon2']") \
 && echo '{"type":"module","private":true}' > package.json \
 && npm install --omit=dev --no-audit --no-fund "@node-rs/argon2@${ARGON2}" \
 && npm cache clean --force && rm /tmp/server-package.json
COPY --from=build /repo/server/dist ./dist
COPY --from=build /repo/server/drizzle ./drizzle
COPY --from=build /repo/web/dist ./public
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000
# Apply pending migrations, then start the server.
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/index.js"]
