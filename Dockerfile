FROM node:22.18-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b AS build

WORKDIR /app

COPY package*.json ./
COPY backend/package*.json ./backend/
RUN npm ci
COPY frontend/package*.json ./frontend/
RUN npm --prefix frontend ci

COPY . .
ARG BACKEND_ORIGIN=http://127.0.0.1:3000
ENV BACKEND_ORIGIN=${BACKEND_ORIGIN}
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22.18-alpine@sha256:1b2479dd35a99687d6638f5976fd235e26c5b37e8122f786fcd5fe231d63de5b AS runtime

WORKDIR /app
ENV NODE_ENV=production
ARG BACKEND_ORIGIN=http://127.0.0.1:3000
ENV BACKEND_ORIGIN=${BACKEND_ORIGIN}
ENV BACKEND_PORT=3000
ENV BACKEND_HOST=127.0.0.1
ENV FRONTEND_PORT=3001
ENV NEXT_INTERNAL_PORT=3002
ENV TRUST_PROXY=1
ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
COPY backend/package*.json ./backend/
RUN npm ci --omit=dev --ignore-scripts
COPY frontend/package*.json ./frontend/
RUN npm --prefix frontend ci --omit=dev --ignore-scripts

COPY backend ./backend
COPY --from=build /app/backend/dist ./backend/dist
COPY scripts/start-next-production.mts ./scripts/start-next-production.mts
COPY frontend/next.config.mjs ./frontend/next.config.mjs
COPY frontend/public ./frontend/public
COPY --from=build /app/frontend/.next ./frontend/.next

EXPOSE 3001

CMD ["node", "--experimental-strip-types", "scripts/start-next-production.mts"]
