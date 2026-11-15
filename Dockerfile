FROM node:20-alpine AS web
RUN corepack enable
WORKDIR /src
COPY web/ ./web/
RUN cd web && pnpm install --frozen-lockfile && pnpm build

# The Go release go.mod's toolchain line names, so the image's engine and the
# release binaries come from the same compiler (scripts/engine-builds.test.mjs).
FROM golang:1.26.9-alpine AS engine
WORKDIR /src
COPY engine/ ./engine/
COPY --from=web /src/web/apps/shell/dist ./engine/internal/httpapi/static/dist
# The publish workflow passes the release tag; a local build reports "dev".
ARG VERSION=dev
RUN cd engine && CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/kubebay ./cmd/kubebay

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=engine /out/kubebay /kubebay
EXPOSE 8080
ENTRYPOINT ["/kubebay"]
