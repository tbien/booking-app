FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN npm ci
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk upgrade --no-cache
COPY package.json package-lock.json ./
RUN npm ci --only=production
COPY --from=base /app/dist ./dist
COPY public ./public
COPY config ./config
RUN mkdir -p logs && chown -R node:node /app
USER node
EXPOSE 8080
CMD ["node", "dist/app.js"]

