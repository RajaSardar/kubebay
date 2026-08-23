FROM node:20-alpine AS web
RUN corepack enable
WORKDIR /src
COPY web/ ./web/
RUN cd web && pnpm install --frozen-lockfile && pnpm build

FROM golang:1.22-alpine AS engine
WORKDIR /src
COPY engine/ ./engine/
COPY --from=web /src/web/apps/shell/dist ./engine/internal/httpapi/static/dist
RUN cd engine && CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath -ldflags "-s -w" -o /out/kubebay ./cmd/kubebay

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=engine /out/kubebay /kubebay
EXPOSE 8080
ENTRYPOINT ["/kubebay"]
