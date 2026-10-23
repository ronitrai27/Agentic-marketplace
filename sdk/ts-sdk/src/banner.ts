#!/usr/bin/env node

/**
 * Catelog Banner — Terminal splash for installation and agent startup
 */

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",

  cyan: "\x1b[36m",
  brightCyan: "\x1b[96m",
  magenta: "\x1b[35m",
  brightMagenta: "\x1b[95m",
  blue: "\x1b[34m",
  brightBlue: "\x1b[94m",
  green: "\x1b[32m",
  brightGreen: "\x1b[92m",
  yellow: "\x1b[33m",
  brightYellow: "\x1b[93m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  white: "\x1b[97m",

  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgDarkGray: "\x1b[100m",
};

export interface BannerDetails {
  name?: string;
  url?: string;
  mode?: string;
  authConfigured?: boolean;
}

export function renderBanner(mode: "install" | "startup" = "install", details?: BannerDetails): void {
  if (process.env.CI || process.env.CATELOG_SILENT) return;

  const asciiCatelog = `
  ${c.brightCyan}  ██████╗ █████╗ ████████╗███████╗██╗      ██████╗  ██████╗ 
  ${c.brightCyan} ██╔════╝██╔══██╗╚══██╔══╝██╔════╝██║     ██╔═══██╗██╔════╝ 
  ${c.brightMagenta} ██║     ███████║   ██║   █████╗  ██║     ██║   ██║██║  ███╗
  ${c.brightMagenta} ██║     ██╔══██║   ██║   ██╔══╝  ██║     ██║   ██║██║   ██║
  ${c.magenta} ╚██████╗██║  ██║   ██║   ███████╗███████╗╚██████╔╝╚██████╔╝
  ${c.magenta}  ╚═════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚══════╝ ╚═════╝  ╚═════╝ 
`.trimEnd();

  const width = 68;
  const line = c.gray + "─".repeat(width) + c.reset;
  const doubleLine = c.brightMagenta + "═".repeat(width) + c.reset;

  console.log("\n" + doubleLine);
  console.log(asciiCatelog);
  console.log(line);

  console.log(`  ${c.bgMagenta}${c.white}${c.bold} NOTE FROM TEAM ROX ${c.reset}`);
  console.log(
    `  ${c.brightYellow}${c.italic}"Welcome to the agent economy, where humans and agents rent out intelligence."${c.reset}`
  );
  console.log(line);

  if (mode === "install") {
    console.log(`  ${c.green}✔${c.reset} ${c.bold}Catelog SDK installed successfully!${c.reset}`);
    console.log(`  ${c.dim}Supported runtimes & package managers:${c.reset}`);
    console.log(
      `  ${c.cyan}pnpm${c.reset} ${c.gray}|${c.reset} ${c.brightBlue}npm${c.reset} ${c.gray}|${c.reset} ${c.brightMagenta}yarn${c.reset} ${c.gray}|${c.reset} ${c.brightYellow}bun${c.reset} ${c.gray}• Node.js 18+ • TypeScript 5+${c.reset}`
    );
    console.log("");
    console.log(`  ${c.bold}Quick Start:${c.reset}`);
    console.log(`  ${c.dim}import { createAgent } from "catelog";${c.reset}`);
    console.log(`  ${c.dim}const agent = createAgent({ name: "My Agent", execute: ... });${c.reset}`);
    console.log(`  ${c.dim}agent.listen(3000);${c.reset}`);
  } else {
    const name = details?.name || "Catelog Agent";
    const url = details?.url || "http://localhost:3000";
    const execMode = details?.mode || "sync";
    const hasAuth = details?.authConfigured ?? false;

    console.log(`  ${c.green}●${c.reset} ${c.bold}${name}${c.reset} is active and ready for jobs!`);
    console.log(line);

    // Server info
    console.log(`  ${c.dim}URL:${c.reset}       ${c.brightCyan}${url}${c.reset}`);
    console.log(`  ${c.dim}Mode:${c.reset}      ${c.white}${execMode}${c.reset}`);
    console.log(`  ${c.dim}Auth:${c.reset}      ${hasAuth ? `${c.green}✔ Secret key configured${c.reset}` : `${c.yellow}⚠ Dev mode (no auth)${c.reset}`}`);
    console.log(line);

    // Endpoints
    console.log(`  ${c.bold}Endpoints:${c.reset}`);
    console.log(`    ${c.green}GET ${c.reset} ${c.white}${url}/health${c.reset}    ${c.gray}← Ping probe${c.reset}`);
    console.log(`    ${c.green}GET ${c.reset} ${c.white}${url}/schema${c.reset}    ${c.gray}← Agent manifest${c.reset}`);
    console.log(`    ${c.brightMagenta}POST${c.reset} ${c.white}${url}/execute${c.reset}   ${c.gray}← Run agent${c.reset}`);
    if (execMode === "async") {
      console.log(`    ${c.cyan}GET ${c.reset} ${c.white}${url}/tasks/:id${c.reset} ${c.gray}← Poll async job${c.reset}`);
    }
  }

  console.log(doubleLine + "\n");
}

// Direct execution support
if (process.argv[1]?.endsWith("banner.ts") || process.argv[1]?.endsWith("banner.js")) {
  renderBanner("install");
}
