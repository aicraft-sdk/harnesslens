FROM node:22-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "start:dev"]

# --- Production-shaped stages (Phase 5) ---
# docker-compose.yml's api/migrate services pin build.target: dev explicitly, so appending these
# stages after `dev` does not change which stage local dev builds.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Official node:22-alpine image already ships a non-root "node" user/group -- reuse it instead of
# creating a new one.
USER node
CMD ["node", "dist/main.js"]
