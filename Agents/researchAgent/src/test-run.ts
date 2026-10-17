import { runResearchAgent } from "./index.js";

async function main() {
  const args = process.argv.slice(2);
  const prompt = args.join(" ") || "Analyze the current landscape of humanoid robotics in manufacturing in 2025 and 2026";

  console.log(`\n======================================================`);
  console.log(`Starting Phase 1 Test Run with prompt: "${prompt}"`);
  console.log(`======================================================`);

  try {
    const result = await runResearchAgent(prompt);

    console.log(`\n======================================================`);
    console.log(`[RESULT STATUS]: ${result.status}`);
    console.log(`[DURATION]: ${result.durationSeconds}s`);
    console.log(`[SOURCES]: ${result.sourcesCount}`);
    console.log(`======================================================\n`);
    console.log(result.answer);
    console.log(`\n======================================================\n`);
  } catch (error) {
    console.error("Test run failed with error:", error);
  }
}

main();
