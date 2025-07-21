FROM node:22-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

FROM base AS build

WORKDIR /app

COPY . .

# Disable frozen lockfile, issue: https://github.com/pnpm/pnpm/issues/9764
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install #--frozen-lockfile

RUN pnpm run -r build

RUN pnpm deploy --filter="@csalih/snapdrop-server" --prod /app/server

FROM oven/bun:1 AS server

WORKDIR /app

COPY --from=build /app/server .

EXPOSE 3000

USER bun
CMD [ "bun", "run", "src/index.ts" ]