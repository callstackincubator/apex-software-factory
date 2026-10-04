# syntax=docker/dockerfile:1
# Build from the repository root (the image needs the lockfile and the contract):
#   docker build -f apps/api/Dockerfile -t apex-api .
#
# Not `pnpm deploy`: it copies workspace packages into node_modules, and Node
# refuses to strip types from .ts files under node_modules, so @apex/contract
# (which ships TypeScript source) would not load. A pruned, production-only
# install that keeps the workspace layout avoids that and still needs no build.

FROM node:22-alpine AS deps
RUN npm install --global pnpm@11.22.0
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/contract/package.json packages/contract/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@apex/api..."

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /repo ./
COPY packages/contract/src packages/contract/src
COPY apps/api/src apps/api/src
USER node
EXPOSE 3001
CMD ["node", "apps/api/src/main.ts"]
