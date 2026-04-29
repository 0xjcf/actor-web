# syntax=docker/dockerfile:1.4

FROM node:20-bookworm-slim

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

WORKDIR /workspace

COPY . /workspace/actor-web
COPY --from=ignite-element packages /workspace/ignite-element/packages
COPY --from=fas packages/shared-contracts /workspace/fas/packages/shared-contracts

WORKDIR /workspace/actor-web

RUN pnpm install --frozen-lockfile

EXPOSE 4100 4101 4102 4173

CMD ["pnpm", "examples:logistics:server"]
