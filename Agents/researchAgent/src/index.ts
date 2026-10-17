import { evaluateInputGuardrail } from "./guardrail/jev-guard.js";
import { generateDirectAnswer } from "./graph/nodes/direct-answer.js";
import { researchGraph } from "./graph/research-graph.js";
import { langfuse, createLangfuseHandler } from "./observability/langfuse.js";

export interface AgentExecutionOptions {
  userId?: string;
  sessionId?: string;
  onProgress?: (step: string) => void;
}

export interface AgentExecutionResult {
  status: "COMPLETED" | "GUARDRAIL_BLOCKED" | "DIRECT_ANSWER";
  prompt: string;
  answer: string;
  sourcesCount: number;
  durationSeconds: number;
  metadata?: Record<string, any>;
}

/**
 * Main execution handler for the Research Agent with Langfuse observability
 */
export async function runResearchAgent(
  userPrompt: string,
  options?: AgentExecutionOptions
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  options?.onProgress?.("Initializing request & guardrails");

  // Create Langfuse trace
  const trace = langfuse.trace({
    name: "research-agent-run",
    userId: options?.userId,
    sessionId: options?.sessionId,
    input: { prompt: userPrompt },
    tags: ["research-agent", "production"],
  });

  console.log(`\n======================================================`);
  console.log(`[Research Agent] Received prompt: "${userPrompt}"`);
  console.log(`======================================================`);

  // STEP 1: JEV Input Guardrail & Intent Classification
  options?.onProgress?.("Evaluating input guardrail with JEV");
  console.log("[Phase 1.1] Evaluating input guardrails with JEV...");
  const guard = await evaluateInputGuardrail(userPrompt);

  trace.update({
    metadata: {
      guardrailScores: guard.scores,
      isAllowed: guard.isAllowed,
      needsResearch: guard.needsResearch,
    },
  });

  if (!guard.isAllowed) {
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);
    console.warn(`[Guardrail] Request rejected: ${guard.rejectionReason}`);

    trace.update({
      output: { error: guard.rejectionReason, status: "GUARDRAIL_BLOCKED" },
    });
    await langfuse.flushAsync();

    return {
      status: "GUARDRAIL_BLOCKED",
      prompt: userPrompt,
      answer: guard.rejectionReason || "Request blocked by safety guardrails.",
      sourcesCount: 0,
      durationSeconds,
      metadata: { scores: guard.scores },
    };
  }

  // STEP 2: Intent Routing (Direct Answer vs. Deep Research)
  if (!guard.needsResearch) {
    options?.onProgress?.("Generating quick response with Groq");
    console.log("[Phase 1.2] Prompt identified as conversational / direct question. Routing to Groq...");
    const directAns = await generateDirectAnswer(userPrompt);
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);

    trace.update({
      output: { answer: directAns, status: "DIRECT_ANSWER" },
    });
    await langfuse.flushAsync();

    return {
      status: "DIRECT_ANSWER",
      prompt: userPrompt,
      answer: directAns,
      sourcesCount: 0,
      durationSeconds,
      metadata: { model: "groq-openai/gpt-oss-120b", scores: guard.scores },
    };
  }

  // STEP 3: Deep Research Graph Execution
  options?.onProgress?.("Starting deep research with LangGraph & Firecrawl");
  console.log("[Phase 1.3] Topic requires deep multi-source research. Initiating LangGraph research engine...");

  const langfuseHandler = createLangfuseHandler({
    userId: options?.userId,
    sessionId: options?.sessionId,
    tags: ["langgraph-deep-research"],
  });

  const graphResult: any = await researchGraph.invoke(
    {
      topic: userPrompt,
    },
    {
      callbacks: [langfuseHandler],
    }
  );

  const durationSeconds = Math.round((Date.now() - startTime) / 1000);
  const totalSources = graphResult.sections?.flatMap((s: any) => s.sources || []).length || 0;

  console.log(`\n======================================================`);
  console.log(`[Research Agent] Completed in ${durationSeconds}s (${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60}s)`);
  console.log(`[Research Agent] Total Sources Referenced: ${totalSources}`);
  console.log(`======================================================`);

  trace.update({
    output: {
      reportLength: graphResult.finalReport?.length || 0,
      sourcesCount: totalSources,
      sectionsCount: graphResult.sections?.length || 0,
      status: "COMPLETED",
    },
  });
  await langfuse.flushAsync();

  return {
    status: "COMPLETED",
    prompt: userPrompt,
    answer: graphResult.finalReport,
    sourcesCount: totalSources,
    durationSeconds,
    metadata: {
      model: "gpt-4.1-mini",
      sections: graphResult.sections?.map((s: any) => ({
        id: s.id,
        title: s.title,
        sourcesCount: s.sources?.length || 0,
      })),
      critiqueCount: graphResult.critiqueCount,
    },
  };
}
