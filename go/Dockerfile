# Basis-Images: Tag UND Digest (Sweep 2026-09-19). Ein Tag allein floatet — ein
# Rebuild desselben Git-Tags lieferte sonst je nach Tag ein anderes Go-Patchlevel
# und eine andere Alpine-Generation; das nach ghcr gepushte Release-Image war als
# Commit fixiert, als Image nicht. Beim Bump Tag und Digest gemeinsam ändern:
#   docker buildx imagetools inspect <tag> --format '{{.Manifest.Digest}}'
# Die e2e-Toolchain pinnt nach demselben Muster in web/e2e/toolchain.lock.

# Stage 0: Frontend (Svelte 5 + TS + Vite, bun) — produces web/dist for go:embed.
FROM oven/bun:1.3-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS frontend
WORKDIR /web
# Dependency layer (cache cut like go.mod/go.sum below):
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ .
RUN bun run check && bun run build

FROM golang:1.27-alpine@sha256:4cb7ac979db5fcc41cae44b2227ba5ab8a51e8807f40d9ba4dee20a0ad960b5b AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Real assets ON TOP of the committed placeholder — must happen BEFORE go
# build, go:embed resolves at compile time (web/web.go: //go:embed all:dist).
COPY --from=frontend /web/dist ./web/dist
RUN CGO_ENABLED=0 go build -o /ctx ./cmd/ctxd

FROM gcr.io/distroless/static-debian13:nonroot@sha256:e2e927ec666bae08560abb3c55d0659eceabb657f56b6782ab500a9fc7f555e3
COPY --from=build /ctx /ctx
ENV GOMEMLIMIT=200MiB
ENV GOGC=100
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/ctx"]
