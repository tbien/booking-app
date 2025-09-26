FROM node:20-alpine AS base
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN npm install --production=false
RUN npx tsc

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache curl
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist
COPY public ./public
COPY config ./config
EXPOSE 4000
CMD node dist/app.js

