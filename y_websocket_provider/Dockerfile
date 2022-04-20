# syntax=docker/dockerfile:1

FROM node:12
WORKDIR /y_websocket_provider/
COPY . .
CMD npm install
CMD HOST=localhost PORT=1234 ./server.js
# CMD HOST=localhost PORT=1234 npx y-websocket

