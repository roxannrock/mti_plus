.PHONY: help install dev build preview typecheck lint clean

.DEFAULT_GOAL := help

help: ## Show available commands
	@echo ""
	@echo "  MTI+ Admin"
	@echo ""
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo ""

install: ## Install dependencies
	npm install

dev: ## Start dev server on localhost:5173
	npm run dev

build: ## Production build
	npm run build

preview: ## Preview the production build locally
	npm run preview

typecheck: ## Type-check without emitting
	npx tsc -b

lint: ## Lint with oxlint
	npm run lint

clean: ## Remove node_modules and build output
	rm -rf node_modules dist
