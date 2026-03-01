# syntax=docker/dockerfile:1

FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies first (better layer caching)
COPY node_sever/package*.json ./
RUN npm ci --omit=dev

# Copy app source
COPY node_sever/src ./src
COPY node_sever/data ./data
COPY node_sever/scripts ./scripts

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Run the server
CMD ["node", "src/app.js"]