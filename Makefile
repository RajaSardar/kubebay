SHELL := /bin/bash

ENGINE_DIR := engine
WEB_DIR := web
ENGINE_BIN := $(ENGINE_DIR)/bin/kubebay
DIST_DIR := $(WEB_DIR)/apps/shell/dist
EMBED_DIR := $(ENGINE_DIR)/internal/httpapi/static/dist
ADDR ?= 127.0.0.1:9898

.PHONY: help build engine web web-install sync-ui test run clean

help:
	@echo "make build       - build SPA + self-contained engine binary"
	@echo "make run         - build everything, serve UI from engine"
	@echo "make test        - engine tests + web typecheck"
	@echo "make dev-engine  - engine only, UI from disk dist if present"
	@echo "make dev-web     - vite dev server with proxy to engine"

web-install:
	cd $(WEB_DIR) && pnpm install --frozen-lockfile

web:
	cd $(WEB_DIR) && pnpm build

sync-ui: web
	rm -rf $(EMBED_DIR)
	mkdir -p $(ENGINE_DIR)/internal/httpapi/static
	cp -R $(DIST_DIR) $(EMBED_DIR)

engine: sync-ui
	GOTOOLCHAIN=local go -C $(ENGINE_DIR) build -trimpath -ldflags "-s -w" -o bin/kubebay ./cmd/kubebay

build: engine

test:
	GOTOOLCHAIN=local go -C $(ENGINE_DIR) vet ./...
	GOTOOLCHAIN=local go -C $(ENGINE_DIR) test ./...
	cd $(WEB_DIR) && pnpm typecheck

run: build
	$(ENGINE_BIN) --addr $(ADDR)

dev-engine:
	GOTOOLCHAIN=local go -C $(ENGINE_DIR) run ./cmd/kubebay --addr $(ADDR) --web-dist ../web/apps/shell/dist

dev-web:
	cd $(WEB_DIR) && pnpm dev

clean:
	rm -rf $(ENGINE_DIR)/bin $(DIST_DIR) $(EMBED_DIR)
