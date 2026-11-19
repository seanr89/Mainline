APP_NAME         := Mainline
BIN_NAME         := git-workspace-manager
TAURI_DIR        := src-tauri
PNPM             := pnpm
CARGO            := cargo

# Set location for staged release executable / app bundle (overrideable: make release RELEASE_DIR=/path/to/dir)
RELEASE_DIR      ?= $(CURDIR)/release
INSTALL_DIR      ?= $(HOME)/Applications

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

.PHONY: help deps build build-frontend build-backend dev test check release run run-bin install-app clean

help: ## Show available Makefile targets and configuration
	@echo "Mainline — Build, Release & Execution Makefile"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Configurable paths:"
	@echo "  RELEASE_DIR = $(RELEASE_DIR)"
	@echo "  INSTALL_DIR = $(INSTALL_DIR)"

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
	@cp -R "$(RELEASE_DIR)/$(APP_NAME).app" "$(INSTALL_DIR)/$(APP_NAME).app"
	@echo "Installed $(INSTALL_DIR)/$(APP_NAME).app"
else
	@echo "install-app is macOS-only; use 'make release RELEASE_DIR=/usr/local/bin' on Linux."
endif

clean: ## Remove frontend dist, staged release artifacts, and Rust target outputs
	rm -rf dist "$(RELEASE_DIR)"
	cd $(TAURI_DIR) && $(CARGO) clean
