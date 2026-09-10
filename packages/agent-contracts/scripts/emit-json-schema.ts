import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  agentInputSchema,
  agentResultSchema,
  runSummarySchema,
  taskRequestSchema,
  validationResultSchema,
} from '../src/index';

/**
 * Generates `schemas/*.schema.json` from the Zod contract schemas.
 *
 * Deviation note (per PLAN §1.2 point 6 + the task's guidance on adapting to
 * the real Zod 4.5.x API): the plan says "Zod 4 emits JSON Schema
 * natively". Zod 4.5.4, as installed, exposes this as `z.toJSONSchema()`
 * (not a `.toJSONSchema()` instance method) — a top-level function that
 * takes a schema. That native API is what's used below; no
 * `zod-to-json-schema` fallback was needed.
 */
const schemas: Record<string, z.ZodType> = {
  'task-request': taskRequestSchema,
  'agent-input': agentInputSchema,
  'agent-result': agentResultSchema,
  'validation-result': validationResultSchema,
  'run-summary': runSummarySchema,
};

const outDir = join(__dirname, '..', '..', '..', 'schemas');
mkdirSync(outDir, { recursive: true });

for (const [name, schema] of Object.entries(schemas)) {
  const jsonSchema = z.toJSONSchema(schema);
  const outPath = join(outDir, `${name}.schema.json`);
  writeFileSync(outPath, `${JSON.stringify(jsonSchema, null, 2)}\n`);
  console.log(`wrote ${outPath}`);
}
