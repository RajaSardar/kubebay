SHELL := /bin/bash

ENGINE_DIR := engine
WEB_DIR := web
ENGINE_BIN := $(ENGINE_DIR)/bin/kubebay
DIST_DIR := $(WEB_DIR)/apps/shell/dist
ADDR ?= 127.0.0.1:9898

.PHONY: help build engine web web-install test typecheck run clean

help:
	@echo "make build       - build SPA + engine binary"
	@echo "make run         - build everything, serve UI from engine"
	@echo "make test        - engine tests + web typecheck"
	@echo "make dev-engine  - run engine only (API on $(ADDR))"
	@echo "make dev-web     - vite dev server with proxy to engine"

build: web engine

web-install:
	cd $(WEB_DIR) && pnpm install --frozen-lockfile

web:
	cd $(WEB_DIR) && pnpm build

engine:
	GOTOOLCHAIN=local go -C $(ENGINE_DIR) build -o bin/kubebay ./cmd/kubebay

test:
	GOTOOLCHAIN=local go -C $(ENGINE_DIR) vet ./...
	GOTOOLCHAIN=local go -C $(ENGINE_DIR) test ./...
	cd $(WEB_DIR) && pnpm typecheck

typecheck: test

run: build
	$(ENGINE_BIN) --addr $(ADDR) --web-dist $(DIST_DIR)

dev-engine:
	GOTOOLCHAIN=local go -C $(ENGINE_DIR) run ./cmd/kubebay --addr $(ADDR)

dev-web:
	cd $(WEB_DIR) && pnpm dev

clean:
	rm -rf $(ENGINE_DIR)/bin $(DIST_DIR)
