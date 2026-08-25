FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
RUN chown -R node:node /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=25s --retries=3 \
  CMD ["node", "dist/infrastructure/ops/health-cli.js"]
CMD ["node", "dist/main.js"]
