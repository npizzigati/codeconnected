# syntax=docker/dockerfile:1

FROM golang:1.17.8 AS go-builder
WORKDIR /codeconnected-buildstep
COPY go.mod .
COPY go.sum .
RUN go mod download
COPY . .
RUN GOOS=linux go build -o ./bin/app .


FROM debian:11
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates
RUN groupadd -r appuser && useradd -m -r appuser -g appuser
WORKDIR /home/appuser
COPY --from=go-builder /codeconnected-buildstep/bin/app ./
USER appuser:appuser
CMD ["./app"]
