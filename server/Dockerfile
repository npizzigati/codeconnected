# syntax=docker/dockerfile:1

FROM golang:1.17.8 AS go-builder
WORKDIR /codeconnected-buildstep/
COPY go.mod .
COPY go.sum .
RUN go mod download
COPY . .
RUN GOOS=linux go build -o app .

# FROM gcr.io/distroless/base-debian11
FROM ubuntu:20.04
WORKDIR /app
COPY --from=go-builder /codeconnected-buildstep/app ./
# USER nonroot:nonroot
CMD ["./app"]
