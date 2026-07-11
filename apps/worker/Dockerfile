FROM oven/bun:1.1.20-slim AS base
WORKDIR /usr/src/app

# Copy lock and package files
COPY package.json bun.lock ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/db/package.json ./packages/db/
COPY packages/core/package.json ./packages/core/
COPY packages/logger/package.json ./packages/logger/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/ui/package.json ./packages/ui/

# Install dependencies
RUN bun install --frozen-lockfile --ignore-scripts

# Copy source files
COPY apps/worker ./apps/worker
COPY packages ./packages

# Set environment
ENV NODE_ENV=production

# Run the worker
CMD ["bun", "run", "--cwd", "apps/worker", "src/index.ts"]
