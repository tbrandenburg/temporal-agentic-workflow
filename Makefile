.PHONY: install up down worker worker-val api run stop test e2e e2e-ui lint build schemas clean

install: ## pnpm install --frozen-lockfile
	pnpm install --frozen-lockfile

build: ## tsc -b across all workspace packages
	pnpm exec tsc -b

lint: ## biome check --write
	pnpm exec biome check --write .

test: ## vitest unit + integration (fast; excludes gates)
	pnpm exec vitest run

schemas: ## regenerate schemas/ from Zod
	@echo "not yet implemented: Phase 2 adds packages/agent-contracts/scripts/emit-json-schema.ts"

up: ## docker compose up -d + wait-healthy + register search attributes
	@echo "not yet implemented: Phase 1 adds infra/temporal/docker-compose.yaml"

down: ## docker compose down
	@echo "not yet implemented: Phase 1 adds infra/temporal/docker-compose.yaml"

worker: ## run agent-default worker (host)
	@echo "not yet implemented: Phase 3 adds packages/worker/src/main.ts"

worker-val: ## run tool-validation worker (host)
	@echo "not yet implemented: Phase 3 adds packages/worker/src/validation-worker.ts"

api: ## run Run API on :3300
	@echo "not yet implemented: Phase 1 wires apps/run-api/src/server.ts to Fastify"

run: up api worker worker-val ## up + api + workers (dev convenience)

stop: down ## stop host processes + compose down
	@echo "not yet implemented: no host processes started yet"

e2e: ## all non-mocked gates G1..G5 against the live stack; GATE=n selects one
	@echo "not yet implemented: Phase 1 adds e2e/gate-1-baseline.e2e.ts"

e2e-ui: ## Playwright UI gate (GU) against Temporal UI on :8233
	@echo "not yet implemented: Phase 1 adds the Playwright UI gate"

clean: ## rm dist, .turbo, tmp artifacts
	rm -rf dist .turbo tmp
	find apps packages -maxdepth 2 -name dist -type d -exec rm -rf {} +
