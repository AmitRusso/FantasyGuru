# Multi-stage build for apps/api. The workspace packages it depends on (@fantasyguru/db,
# @fantasyguru/sleeper) are built here too -- they are TypeScript sources, not published
# packages.

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate

# Manifests first, so a source-only change does not re-resolve the dependency graph.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json ./
COPY packages/sleeper/package.json packages/sleeper/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps apps
RUN pnpm exec tsc --build

FROM node:22-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate

COPY --from=build /repo /repo
# Drop devDependencies. --ignore-scripts because nothing in the production tree needs a
# postinstall, and running one in the deployed image is how supply-chain surprises land.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

EXPOSE 8080

# Not `pnpm start`: an exec-form node process receives SIGTERM directly, which is what the
# graceful shutdown in apps/api/src/index.ts depends on when Fly replaces a machine
# mid-sync.
CMD ["node", "apps/api/dist/index.js"]
