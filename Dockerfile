# ── Stage 1: Build backend ────────────────────────────────────────────────────
FROM node:20-alpine AS backend-build
WORKDIR /app
COPY package*.json tsconfig.json tsconfig.backend.json ./
COPY src ./src
RUN npm ci && npm run build

# ── Stage 2: Build frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 3: Production image ────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk upgrade --no-cache
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=backend-build /app/dist ./dist
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
COPY scripts/wait-for-mongo.ts scripts/init-admin.ts ./scripts/
RUN mkdir -p logs && chown -R node:node /app
USER node
EXPOSE 4000
CMD ["node", "dist/app.js"]

