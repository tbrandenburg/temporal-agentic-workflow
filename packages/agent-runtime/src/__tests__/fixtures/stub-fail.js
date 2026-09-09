#!/usr/bin/env node
// Exits non-zero with stderr output, exercising the subprocess-failure path.
process.stderr.write('simulated fatal error\n');
process.exit(3);
