FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# CLI Prisma e tsx são necessários para migrations, bootstrap e worker nesta fundação.
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/.data/media && chown -R node:node /app/.data
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
