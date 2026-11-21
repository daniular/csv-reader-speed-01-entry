// The program the harness runs: reads every case, answers each with the
// solver, and writes the answers out. Node 22 runs this file as it is.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// Keep V8's incremental marking off for the whole run, set before the
// solver is loaded so all of its work runs under it.
setFlagsFromString('--no-incremental-marking');

const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
};

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const raw = readFileSync(join(inputDir, 'cases.json'), 'utf8');
const cases = JSON.parse(raw) as { id: string; input: unknown }[];

const answers: unknown[] = new Array(cases.length);
for (let i = 0; i < cases.length; i += 1) {
  answers[i] = run(cases[i].input);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
