# syntax=docker/dockerfile:1

FROM node:12 AS js-builder
WORKDIR /buildstep/
COPY . .
RUN npm run build

FROM nginx:stable
WORKDIR /etc/nginx/conf.d
RUN ["mv", "default.conf", "default.conf.disabled"]
COPY ./codeconnected-nginx.conf .
WORKDIR /usr/share/nginx/html
COPY --from=js-builder /buildstep/index.html .
COPY --from=js-builder /buildstep/public .