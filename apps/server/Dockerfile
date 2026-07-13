FROM oven/bun:1.2.4-slim AS base
WORKDIR /usr/src/app

# Copy lock and package files
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/
COPY packages/db/package.json ./packages/db/
COPY packages/core/package.json ./packages/core/
COPY packages/logger/package.json ./packages/logger/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/ui/package.json ./packages/ui/

# Install dependencies
RUN bun install --ignore-scripts

# Copy source files
COPY apps/server ./apps/server
COPY packages ./packages

# Expose server port
EXPOSE 3000

# Set environment
ENV NODE_ENV=production

# Run the server
CMD ["bun", "run", "--cwd", "apps/server", "src/index.ts"]
