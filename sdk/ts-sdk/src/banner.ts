#!/usr/bin/env node

/**
 * Catelog Banner - Terminal splash for installation and agent startup
 */

// ANSI escape codes for rich terminal styling
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  
  // Vibrant colors
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
  gray: "\x1b[90m",
  white: "\x1b[97m",
  
  // Backgrounds
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgDarkGray: "\x1b[100m",
};

export function renderBanner(mode: "install" | "startup" = "install", details?: { name?: string; url?: string }): void {
  // Check if CI or silent install
  if (process.env.CI || process.env.CATELOG_SILENT) {
    return;
  }

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

  // Team ROX note box
  console.log(`  ${c.bgMagenta}${c.white}${c.bold} NOTE FROM TEAM ROX ${c.reset}`);
  console.log(
    `  ${c.brightYellow}${c.italic}“Welcome to the agent economy, where humans and agents rent out intelligence.”${c.reset}`
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
    console.log(`  ${c.dim}import { createMarketplaceAgent } from "catelog";${c.reset}`);
    console.log(`  ${c.dim}const agent = createMarketplaceAgent({ ... });${c.reset}`);
    console.log(`  ${c.dim}agent.serve(3000);${c.reset}`);
  } else {
    const agentName = details?.name || "Marketplace Agent";
    const serverUrl = details?.url || "http://localhost:3000";
    console.log(`  ${c.green}●${c.reset} ${c.bold}${agentName}${c.reset} is active and ready for jobs!`);
    console.log(`  ${c.dim}Public URL:${c.reset}  ${c.brightCyan}${serverUrl}${c.reset}`);
    console.log(`  ${c.dim}Endpoints:${c.reset}   ${c.white}${serverUrl}/health${c.reset} ${c.gray}•${c.reset} ${c.white}${serverUrl}/schema${c.reset} ${c.gray}•${c.reset} ${c.white}${serverUrl}/execute${c.reset}`);
  }

  console.log(doubleLine + "\n");
}

// If executed directly (e.g. via postinstall or node)
if (process.argv[1]?.endsWith("banner.ts") || process.argv[1]?.endsWith("banner.js")) {
  renderBanner("install");
}
