# Bun runtime (your server uses Bun.serve, so Node won't work).
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json ./
COPY bun.lock* ./
RUN bun install

# Copy the rest of the source.
COPY . .

ENV NODE_ENV=production
ENV PORT=8000
EXPOSE 8000

CMD ["bun", "run", "main.ts"]
