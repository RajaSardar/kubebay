SHELL := /bin/bash

ENGINE_DIR := engine
WEB_DIR := web
ENGINE_BIN := $(ENGINE_DIR)/bin/kubebay
DIST_DIR := $(WEB_DIR)/apps/shell/dist
EMBED_DIR := $(ENGINE_DIR)/internal/httpapi/static/dist
ADDR ?= 127.0.0.1:9898

# The desktop app updates itself only when the build carries the updater's public key,
# the same one release.yml puts in a release. It is public, so building with it is safe;
# only the private half (a release secret) can sign an update.
UPDATER_PUBKEY_FILE ?= $(HOME)/.tauri/kubebay-updater.key.pub
SIDECAR := desktop/src-tauri/binaries/kubebay-engine-aarch64-apple-darwin
# The JSON sits in its own variable: commas inside an argument of $(if ...) would split it.
UPDATER_JSON = {"plugins":{"updater":{"pubkey":"$(shell tr -d '\n' < $(UPDATER_PUBKEY_FILE))","requireSignedVersion":true}}}
UPDATER_CONFIG = $(if $(wildcard $(UPDATER_PUBKEY_FILE)),--config '$(UPDATER_JSON)')

.PHONY: help build desktop engine web web-install sync-ui test run clean

help:
	@echo "make build       - build SPA + self-contained engine binary"
	@echo "make desktop     - build the macOS app (it updates itself if ~/.tauri has the updater key)"
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
	GOTOOLCHAIN=local go -C $(ENGINE_DIR) build -trimpath -tags localshell -ldflags "-s -w" -o bin/kubebay ./cmd/kubebay

build: engine

desktop: build
	mkdir -p desktop/src-tauri/binaries
	cp $(ENGINE_BIN) $(SIDECAR)
	@$(if $(wildcard $(UPDATER_PUBKEY_FILE)),echo "updater key found: this build updates itself from the releases",echo "no $(UPDATER_PUBKEY_FILE): this build won't update itself")
	cd desktop && pnpm tauri build $(UPDATER_CONFIG)

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
