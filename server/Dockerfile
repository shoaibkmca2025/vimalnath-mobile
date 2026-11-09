FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY migrations ./migrations
COPY src ./src
USER node
EXPOSE 3000
# Migrations are safe to run on every start: they take a lock and skip what's already applied.
CMD ["sh", "-c", "node src/migrate.ts && exec node src/server.ts"]
