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
	pnpm --filter @poc/agent-contracts run emit-json-schema

up: ## docker compose up -d + wait-healthy + register search attributes
	docker compose -f infra/temporal/docker-compose.yaml up -d
	@echo "waiting for temporal frontend to accept connections..."
	@for i in $$(seq 1 60); do \
		if docker compose -f infra/temporal/docker-compose.yaml exec -T temporal-admin-tools tctl cluster health >/dev/null 2>&1; then \
			echo "temporal is healthy"; \
			break; \
		fi; \
		sleep 2; \
	done
	./infra/temporal/register-search-attributes.sh

down: ## docker compose down
	docker compose -f infra/temporal/docker-compose.yaml down

worker: ## run agent-default worker (host)
	pnpm --filter @poc/worker exec node dist/main.js

worker-val: ## run tool-validation worker (host)
	pnpm --filter @poc/worker exec node dist/validation-worker.js

api: ## run Run API on :3300
	pnpm --filter @poc/run-api exec node dist/server.js

run: up ## up + reminder to run api/worker in separate terminals (dev convenience)
	@echo "stack is up. Run 'make worker' and 'make api' in separate terminals."

stop: down ## stop host processes + compose down
	@pkill -f 'packages/worker/dist/main.js' 2>/dev/null || true
	@pkill -f 'apps/run-api/dist/server.js' 2>/dev/null || true


e2e: ## all non-mocked gates G1..G5 against the live stack; GATE=n selects one
	@echo "not yet implemented: Phase 1 adds e2e/gate-1-baseline.e2e.ts"

e2e-ui: ## Playwright UI gate (GU) against Temporal UI on :8233
	@echo "not yet implemented: Phase 1 adds the Playwright UI gate"

clean: ## rm dist, .turbo, tmp artifacts
	rm -rf dist .turbo tmp
	find apps packages -maxdepth 2 -name dist -type d -exec rm -rf {} +
	find . -maxdepth 3 -name "*.tsbuildinfo" -not -path "./node_modules/*" -delete
