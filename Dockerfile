# Use the official Bun image
FROM oven/bun:1 as base
WORKDIR /app

# Install dependencies into temp directory
# This allows us to cache them and speed up future builds
FROM base AS install
mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
cd /temp/dev && bun install --frozen-lockfile

# Install with --production (exclude devDependencies)
mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
cd /temp/prod && bun install --frozen-lockfile --production

# Copy node_modules from temp directory
# Then copy all source code
FROM base AS release
COPY --from=install /temp/prod/node_modules node_modules
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose the port
EXPOSE 3000

# Start the server
CMD ["bun", "src/app.ts"]
