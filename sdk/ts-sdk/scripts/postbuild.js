#!/usr/bin/env node
// Marks dist/cjs as CommonJS (the package root is "type": "module").
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync(new URL("../dist/cjs/", import.meta.url), { recursive: true });
writeFileSync(new URL("../dist/cjs/package.json", import.meta.url), '{ "type": "commonjs" }\n');
