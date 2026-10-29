FROM node:22-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
ENV PYTHON=/usr/bin/python3

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .
RUN BETTER_AUTH_SECRET=build-only-not-a-real-secret \
    DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    pnpm build

ENV NODE_ENV=production \
    PORT=3000
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
