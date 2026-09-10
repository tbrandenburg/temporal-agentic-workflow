// Idempotent registration of the 5 custom search attributes from PLAN.md §4.2.
// Invoked by register-search-attributes.sh via `pnpm --filter @poc/run-api exec node`.
//
// Uses @temporalio/client's operatorService (addSearchAttributes /
// listSearchAttributes) directly rather than the `temporal` CLI: the host
// `temporal` CLI (v1.8.2, bundles server 1.31.2 reference code) fails to
// reach our 1.29.7 server with "context deadline exceeded" on every RPC —
// verified in isolation, while this same Node SDK connects fine. See
// infra/temporal/.env for the version-pinning deviation this stems from.
// `tctl` (bundled in admin-tools) also works and does the equivalent
// operator RPC under the hood, confirming this is the right call to make —
// operatorService handles slot allocation server-side, unlike a hand-rolled
// UpdateNamespace(customSearchAttributeAliases) call which raced with the
// generic Custom*Field slots that Temporal's auto-setup allocates on first
// boot and failed with "field name already allocated".
const { Connection } = require('@temporalio/client');

// IndexedValueType enum (temporal.api.enums.v1.IndexedValueType): verified
// empirically against a live server (INDEXED_VALUE_TYPE_UNSPECIFIED=0,
// TEXT=1, KEYWORD=2, ...) — operatorService.addSearchAttributes rejects the
// string enum form ("INDEXED_VALUE_TYPE_KEYWORD") with "type Unspecified"
// even though listSearchAttributes returns that string form on read; the
// write path needs the numeric value.
const INDEXED_VALUE_TYPE_KEYWORD = 2;

// `TaskRunId`, not `RunId` — see the NOTE in
// packages/agent-contracts/src/search-attributes.ts: "RunId" is a
// Temporal-reserved system attribute and cannot be set as a custom one.
const ATTRIBUTES = {
  TaskRunId: INDEXED_VALUE_TYPE_KEYWORD,
  Repository: INDEXED_VALUE_TYPE_KEYWORD,
  RunStatus: INDEXED_VALUE_TYPE_KEYWORD,
  RequestedModel: INDEXED_VALUE_TYPE_KEYWORD,
  TaskClass: INDEXED_VALUE_TYPE_KEYWORD,
};

async function main() {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';

  const connection = await Connection.connect({ address });
  try {
    const { operatorService } = connection;

    const before = await operatorService.listSearchAttributes({ namespace });
    const registered = new Set([
      ...Object.keys(before.customAttributes ?? {}),
      ...Object.keys(before.systemAttributes ?? {}),
    ]);

    const missing = Object.entries(ATTRIBUTES).filter(([name]) => !registered.has(name));

    if (missing.length === 0) {
      console.log('all 5 search attributes already registered, nothing to do.');
    } else {
      for (const [name, type] of missing) {
        console.log(`registering search-attribute: ${name} (${type})`);
      }
      await operatorService.addSearchAttributes({
        namespace,
        searchAttributes: Object.fromEntries(missing),
      });
    }

    const after = await operatorService.listSearchAttributes({ namespace });
    console.log(
      'current custom search attributes:',
      JSON.stringify(after.customAttributes ?? {}, null, 2),
    );

    for (const name of Object.keys(ATTRIBUTES)) {
      const result = await connection.workflowService.countWorkflowExecutions({
        namespace,
        query: `${name}="__probe__"`,
      });
      console.log(`verified queryable: ${name} (count query returned ${JSON.stringify(result)})`);
    }
  } finally {
    await connection.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
