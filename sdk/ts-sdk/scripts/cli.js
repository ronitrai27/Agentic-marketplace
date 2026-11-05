#!/usr/bin/env node

/**
 * catelog CLI — zero-dependency.
 *
 *   npx catelog init [--lang ts|py] [--yes] [--force]   Add the Catelog setup guide to this project
 *   npx catelog --version | --help
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8"));

/** One guide per SDK language. The Python guide is a placeholder until the py-sdk ships. */
const GUIDES = {
  ts: { label: "TypeScript", file: "Catelog-TS.md" },
  py: { label: "Python", file: "Catelog-PY.md" },
};

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("-") && !a.includes("=")));
const command = args.find((a) => !a.startsWith("-"));
const has = (...names) => names.some((n) => flags.has(n));

function flagValue(name) {
  const inline = args.find((a) => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

function printHelp() {
  console.log(`catelog v${pkg.version}

Usage:
  catelog init [--lang ts|py] [--yes] [--force]   Add the Catelog setup guide to the current project
  catelog --version                               Print the version
  catelog --help                                  Show this help

Options:
  -l, --lang <ts|py>   Pick the guide language (Catelog-TS.md or Catelog-PY.md)
  -y, --yes            Don't ask; install the guide (TypeScript unless --lang is given)
  -f, --force          Overwrite an existing guide`);
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function confirm(question, defaultYes = true) {
  const answer = await ask(`${question} ${defaultYes ? "(Y/n)" : "(y/N)"} `);
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes";
}

async function chooseLanguage() {
  for (;;) {
    const answer = await ask("Which SDK are you using? [1] TypeScript  [2] Python (default: 1) ");
    if (answer === "" || answer === "1" || answer === "ts" || answer === "typescript") return "ts";
    if (answer === "2" || answer === "py" || answer === "python") return "py";
    console.log("Please type 1 or 2.");
  }
}

async function init() {
  const yes = has("-y", "--yes");
  const force = has("-f", "--force");
  const langFlag = (flagValue("--lang") ?? flagValue("-l"))?.toLowerCase();

  if (langFlag && !GUIDES[langFlag]) {
    console.error(`Unknown language "${langFlag}". Use "ts" or "py".`);
    process.exit(1);
  }

  const interactive = !yes && process.stdin.isTTY;
  if (!yes && !process.stdin.isTTY) {
    console.log("Non-interactive shell: skipped. Run `npx catelog init --yes [--lang ts|py]` to install the guide.");
    return;
  }

  if (interactive && !(await confirm("Add the Catelog setup guide to this project?"))) {
    console.log("Skipped. You can run `npx catelog init` any time.");
    return;
  }

  const lang = langFlag ?? (interactive ? await chooseLanguage() : "ts");
  const guide = GUIDES[lang];

  // INIT_CWD is where npm/pnpm was run from; cwd is right for a direct `npx catelog init`.
  const target = join(process.env.INIT_CWD || process.cwd(), guide.file);
  const source = join(pkgRoot, guide.file);

  if (existsSync(target) && !force) {
    if (!interactive || !(await confirm(`${guide.file} already exists. Overwrite it?`, false))) {
      console.log(`Kept your existing ${guide.file}. Use --force to overwrite.`);
      return;
    }
  }

  if (existsSync(source)) copyFileSync(source, target);
  else writeFileSync(target, "");

  console.log(`✔ Added ${target} (${guide.label})`);
  if (lang === "py") console.log("  The Python SDK is not released yet, so this file is an empty placeholder.");
}

async function main() {
  if (has("-v", "--version")) return console.log(pkg.version);
  if (has("-h", "--help") || !command) return printHelp();

  if (command === "init") return init();

  console.error(`Unknown command: ${command}\n`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
