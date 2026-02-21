# ── Stage 1: Install production dependencies ────────────────
FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: Production image ───────────────────────────────
FROM node:22-alpine

WORKDIR /app

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source and data
COPY package.json ./
COPY src/ ./src/
COPY data/ ./data/

# Default environment variables (override via docker-compose / .env)
ENV NODE_ENV=production
ENV PORT=3001
ENV REDIS_URL=redis://redis:6379

EXPOSE 3001

CMD ["node", "src/app.js"]
