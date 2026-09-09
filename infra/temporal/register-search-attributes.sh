#!/usr/bin/env bash
# Idempotent registration of the 5 custom search attributes from PLAN.md §4.2.
# Safe to re-run: checks existence (via DescribeNamespace) before mutating.
# Delegates to apps/run-api/scripts/register-search-attributes.js (real
# implementation lives there so it resolves @temporalio/client from that
# package's node_modules; see that file's header comment for why the host
# `temporal` CLI and `tctl` were not used directly for the existence check).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

cd "$REPO_ROOT" && pnpm --filter @poc/run-api exec node scripts/register-search-attributes.js
