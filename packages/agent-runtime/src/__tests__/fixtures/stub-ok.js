#!/usr/bin/env node
// Stub opencode binary for integration-style tests: emits a valid NDJSON
// event stream and exits 0, exercising the real spawn/parse path per
// PLAN §10 ("agent-runtime against a stub opencode binary").
process.stdout.write(
  `${JSON.stringify({ type: 'text', part: { type: 'text', text: 'stub ok response' } })}\n`,
);
process.exit(0);
