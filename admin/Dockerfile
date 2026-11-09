# Built from the repo root: the admin's data comes from the mobile app's files.
FROM node:24-alpine AS build
WORKDIR /repo/admin
COPY admin/package.json admin/package-lock.json ./
RUN npm ci
WORKDIR /repo
COPY app.json ./
COPY src ./src
COPY assets ./assets
COPY admin ./admin
WORKDIR /repo/admin
RUN npm run build

FROM nginx:1.28-alpine
COPY admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/admin/dist /usr/share/nginx/html
