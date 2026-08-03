# syntax=docker/dockerfile:1.7

ARG GO_IMAGE_VERSION
ARG ALPINE_VERSION

FROM golang:${GO_IMAGE_VERSION} AS builder

ARG MINIO_SERVER_VERSION
ARG MINIO_CLIENT_VERSION

ENV CGO_ENABLED=0

RUN test -n "${MINIO_SERVER_VERSION}" \
  && test -n "${MINIO_CLIENT_VERSION}" \
  && GOBIN=/out go install "github.com/minio/minio@${MINIO_SERVER_VERSION}" \
  && GOBIN=/out go install "github.com/minio/mc@${MINIO_CLIENT_VERSION}"

FROM alpine:${ALPINE_VERSION} AS runtime

RUN apk add --no-cache ca-certificates curl \
  && addgroup -g 1000 -S minio \
  && adduser -u 1000 -S -D -H -G minio minio \
  && mkdir -p /data \
  && chown minio:minio /data

COPY --from=builder /out/minio /usr/local/bin/minio
COPY --from=builder /out/mc /usr/local/bin/mc

USER minio:minio
WORKDIR /data

EXPOSE 9000 9001

ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
