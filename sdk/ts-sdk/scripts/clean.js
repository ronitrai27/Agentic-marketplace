#!/usr/bin/env node
import { rmSync } from "node:fs";

rmSync(new URL("../dist/", import.meta.url), { recursive: true, force: true });
