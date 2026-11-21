APP_NAME         := Mainline
BIN_NAME         := git-workspace-manager
TAURI_DIR        := src-tauri
PNPM             := pnpm
CARGO            := cargo

# Set location for staged release executable / app bundle (overrideable: make release RELEASE_DIR=/path/to/dir)
RELEASE_DIR        ?= $(CURDIR)/release
INSTALL_DIR        ?= $(HOME)/Applications
RELAUNCH           ?= 0
INSTALL_DIR_ORIGIN := $(origin INSTALL_DIR)
PLIST_BUDDY        := /usr/libexec/PlistBuddy

UNAME_S          := $(shell uname -s)
TARGET_RELEASE   := $(TAURI_DIR)/target/release
RELEASE_BIN      := $(TARGET_RELEASE)/$(BIN_NAME)
MACOS_APP_SRC    := $(TARGET_RELEASE)/bundle/macos/$(APP_NAME).app
MACOS_DMG_DIR    := $(TARGET_RELEASE)/bundle/dmg

ifeq ($(UNAME_S),Darwin)
  STAGED_EXEC    := $(RELEASE_DIR)/$(APP_NAME).app
else
  STAGED_EXEC    := $(RELEASE_DIR)/$(BIN_NAME)
endif

.DEFAULT_GOAL := help

.PHONY: help deps build build-frontend build-backend dev test check release run run-bin install-app update-app clean

help: ## Show available Makefile targets and configuration
	@echo "Mainline — Build, Release & Execution Makefile"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Configurable paths & options:"
	@echo "  RELEASE_DIR = $(RELEASE_DIR)"
	@echo "  INSTALL_DIR = $(INSTALL_DIR)"
	@echo "  RELAUNCH    = $(RELAUNCH)"

deps: ## Install frontend dependencies via pnpm
	$(PNPM) install

build-frontend: ## Type-check and build the React/Vite frontend bundle
	$(PNPM) build

build-backend: ## Compile the Rust Tauri backend (debug)
	cd $(TAURI_DIR) && $(CARGO) build

build: build-frontend build-backend ## Build both frontend and Rust backend (debug)

dev: ## Launch Mainline in interactive Tauri development mode
	$(PNPM) tauri dev

test: ## Run TypeScript typecheck, Rust unit/integration tests, and Clippy
	$(PNPM) exec tsc --noEmit
	cd $(TAURI_DIR) && $(CARGO) test
	cd $(TAURI_DIR) && $(CARGO) clippy -- -D warnings

check: test ## Alias for test

release: ## Build optimized release bundle/binary and stage it into RELEASE_DIR
	$(PNPM) tauri build
	@mkdir -p "$(RELEASE_DIR)"
ifeq ($(UNAME_S),Darwin)
	@rm -rf "$(RELEASE_DIR)/$(APP_NAME).app"
	@cp -R "$(MACOS_APP_SRC)" "$(RELEASE_DIR)/$(APP_NAME).app"
	@cp "$(RELEASE_BIN)" "$(RELEASE_DIR)/$(BIN_NAME)"
	@chmod +x "$(RELEASE_DIR)/$(BIN_NAME)"
	@if [ -d "$(MACOS_DMG_DIR)" ]; then cp "$(MACOS_DMG_DIR)"/*.dmg "$(RELEASE_DIR)/" 2>/dev/null || true; fi
	@echo "Release staged in $(RELEASE_DIR):"
	@echo "  App bundle : $(RELEASE_DIR)/$(APP_NAME).app"
	@echo "  Executable : $(RELEASE_DIR)/$(BIN_NAME)"
else
	@cp "$(RELEASE_BIN)" "$(RELEASE_DIR)/$(BIN_NAME)"
	@chmod +x "$(RELEASE_DIR)/$(BIN_NAME)"
	@echo "Release executable staged at $(RELEASE_DIR)/$(BIN_NAME)"
endif

run: ## Run the staged release application from RELEASE_DIR (builds release first if missing)
	@if [ ! -e "$(STAGED_EXEC)" ]; then \
		echo "No release found at $(STAGED_EXEC) — building release first..."; \
		$(MAKE) release; \
	fi
ifeq ($(UNAME_S),Darwin)
	@echo "Launching $(RELEASE_DIR)/$(APP_NAME).app ..."
	@open "$(RELEASE_DIR)/$(APP_NAME).app"
else
	@echo "Launching $(RELEASE_DIR)/$(BIN_NAME) ..."
	@"$(RELEASE_DIR)/$(BIN_NAME)"
endif

run-bin: ## Run the staged release binary directly in the foreground (stdout/stderr attached)
	@if [ ! -x "$(RELEASE_DIR)/$(BIN_NAME)" ]; then \
		echo "No release binary found at $(RELEASE_DIR)/$(BIN_NAME) — building release first..."; \
		$(MAKE) release; \
	fi
	@"$(RELEASE_DIR)/$(BIN_NAME)"

install-app: ## Install Mainline.app into INSTALL_DIR (macOS, defaults to ~/Applications)
ifeq ($(UNAME_S),Darwin)
	@if [ ! -d "$(RELEASE_DIR)/$(APP_NAME).app" ]; then \
		$(MAKE) release; \
	fi
	@mkdir -p "$(INSTALL_DIR)"
	@rm -rf "$(INSTALL_DIR)/$(APP_NAME).app"
	@ditto "$(RELEASE_DIR)/$(APP_NAME).app" "$(INSTALL_DIR)/$(APP_NAME).app"
	@INSTALLED_VER=$$("$(PLIST_BUDDY)" -c "Print :CFBundleShortVersionString" "$(INSTALL_DIR)/$(APP_NAME).app/Contents/Info.plist" 2>/dev/null || echo "unknown"); \
	echo "Installed $(INSTALL_DIR)/$(APP_NAME).app (v$$INSTALLED_VER)"
else
	@echo "install-app is macOS-only; use 'make release RELEASE_DIR=/usr/local/bin' on Linux."
endif

update-app: ## Rebuild release and update an installed Mainline.app in ~/Applications or /Applications
ifeq ($(UNAME_S),Darwin)
	$(MAKE) release
	@if [ "$(INSTALL_DIR_ORIGIN)" = "command line" ] || [ "$(INSTALL_DIR_ORIGIN)" = "environment" ] || [ "$(INSTALL_DIR_ORIGIN)" = "environment override" ]; then \
		TARGET_DIR="$(INSTALL_DIR)"; \
	elif [ -d "$(HOME)/Applications/$(APP_NAME).app" ]; then \
		TARGET_DIR="$(HOME)/Applications"; \
	elif [ -d "/Applications/$(APP_NAME).app" ]; then \
		TARGET_DIR="/Applications"; \
	else \
		TARGET_DIR="$(INSTALL_DIR)"; \
	fi; \
	TARGET_APP="$$TARGET_DIR/$(APP_NAME).app"; \
	if [ -f "$$TARGET_APP/Contents/Info.plist" ]; then \
		OLD_VER=$$("$(PLIST_BUDDY)" -c "Print :CFBundleShortVersionString" "$$TARGET_APP/Contents/Info.plist" 2>/dev/null || echo "unknown"); \
	else \
		OLD_VER="none (fresh install)"; \
	fi; \
	NEW_VER=$$("$(PLIST_BUDDY)" -c "Print :CFBundleShortVersionString" "$(RELEASE_DIR)/$(APP_NAME).app/Contents/Info.plist" 2>/dev/null || echo "unknown"); \
	if pgrep -x "$(APP_NAME)" >/dev/null 2>&1 || pgrep -x "$(BIN_NAME)" >/dev/null 2>&1; then \
		echo "Stopping running $(APP_NAME) instance..."; \
		osascript -e 'tell application "$(APP_NAME)" to quit' >/dev/null 2>&1 || true; \
		WAIT_COUNT=0; \
		while (pgrep -x "$(APP_NAME)" >/dev/null 2>&1 || pgrep -x "$(BIN_NAME)" >/dev/null 2>&1) && [ "$$WAIT_COUNT" -lt 6 ]; do \
			sleep 0.5; \
			WAIT_COUNT=$$((WAIT_COUNT + 1)); \
		done; \
		if pgrep -x "$(APP_NAME)" >/dev/null 2>&1 || pgrep -x "$(BIN_NAME)" >/dev/null 2>&1; then \
			pkill -x "$(APP_NAME)" 2>/dev/null || pkill -x "$(BIN_NAME)" 2>/dev/null || true; \
			sleep 0.5; \
		fi; \
	fi; \
	mkdir -p "$$TARGET_DIR" 2>/dev/null || true; \
	if [ ! -d "$$TARGET_DIR" ] || [ ! -w "$$TARGET_DIR" ] || { [ -e "$$TARGET_APP" ] && [ ! -w "$$TARGET_APP" ]; }; then \
		echo "Error: $$TARGET_DIR is not writable. Re-run with elevated permissions or override INSTALL_DIR."; \
		exit 1; \
	fi; \
	rm -rf "$$TARGET_APP"; \
	ditto "$(RELEASE_DIR)/$(APP_NAME).app" "$$TARGET_APP"; \
	echo "Updated $$TARGET_APP: $$OLD_VER -> $$NEW_VER"; \
	if [ "$(RELAUNCH)" = "1" ] || [ "$(RELAUNCH)" = "true" ]; then \
		echo "Launching $$TARGET_APP ..."; \
		open "$$TARGET_APP"; \
	fi
else
	@echo "update-app is macOS-only; use 'make release RELEASE_DIR=/usr/local/bin' on Linux."
endif

clean: ## Remove frontend dist, staged release artifacts, and Rust target outputs
	rm -rf dist "$(RELEASE_DIR)"
	cd $(TAURI_DIR) && $(CARGO) clean
