# The web version of the mobile app. Phone builds can't run in a container.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci's postinstall writes the offline PDF viewer's source from pdfjs-dist.
COPY scripts/build-pdfjs-source.mjs scripts/
RUN npm ci
COPY . .
# The admin address the app logs in through; build args reach RUN as environment variables.
ARG EXPO_PUBLIC_SHOP_URL
RUN CI=1 npx expo export -p web --output-dir dist

FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
