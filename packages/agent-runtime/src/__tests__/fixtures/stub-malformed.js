#!/usr/bin/env node
// Emits a line that is not valid JSON, exercising the malformed-JSON
// failure path.
process.stdout.write('this is not { valid json\n');
process.exit(0);
