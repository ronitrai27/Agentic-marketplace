import { evaluateInputGuardrail } from "./guardrail/jev-guard.js";
import { generateDirectAnswer } from "./graph/nodes/direct-answer.js";
import { researchGraph } from "./graph/research-graph.js";
import { langfuse, createLangfuseHandler } from "./observability/langfuse.js";

export interface AgentExecutionOptions {
  userId?: string;
  sessionId?: string;
  runId?: string;
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

export interface ClassificationResult {
  isAllowed: boolean;
  needsResearch: boolean;
  rejectionReason?: string;
  scores: {
    inappropriateProb: number;
    needsResearchProb: number;
  };
}

/**
 * Step 1: Fast Classification & Guardrails (~1s)
 */
export async function classify(
  userPrompt: string,
  options?: AgentExecutionOptions
): Promise<ClassificationResult> {
  const trace = langfuse.trace({
    name: "research-agent-classification",
    userId: options?.userId,
    sessionId: options?.sessionId,
    input: { prompt: userPrompt, runId: options?.runId },
    tags: ["classification", "jev-guardrail"],
  });

  options?.onProgress?.("Evaluating prompt guardrails & intent with TypeSafe JEV-1.14...");
  const guard = await evaluateInputGuardrail(userPrompt);

  trace.update({
    metadata: {
      guardrailScores: guard.scores,
      isAllowed: guard.isAllowed,
      needsResearch: guard.needsResearch,
    },
    output: {
      isAllowed: guard.isAllowed,
      needsResearch: guard.needsResearch,
      rejectionReason: guard.rejectionReason,
    },
  });
  await langfuse.flushAsync();

  return guard;
}

/**
 * Step 2: Fast Conversational Answer via Groq (1-2s, no background workers)
 */
export async function answerDirect(
  userPrompt: string,
  options?: AgentExecutionOptions & { scores?: any }
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  options?.onProgress?.("Generating quick response with Groq (openai/gpt-oss-120b)...");

  const trace = langfuse.trace({
    name: "research-agent-direct-answer",
    userId: options?.userId,
    sessionId: options?.sessionId,
    input: { prompt: userPrompt, runId: options?.runId },
    tags: ["chit-chat", "groq"],
  });

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
    metadata: { model: "groq-openai/gpt-oss-120b", scores: options?.scores },
  };
}

/**
 * Step 3: Deep Research Engine via LangGraph
 * Can be called locally or inside a Temporal Activity.
 */
export async function runDeepResearch(
  userPrompt: string,
  options?: AgentExecutionOptions
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  options?.onProgress?.("Starting deep research with LangGraph & Firecrawl");

  const trace = langfuse.trace({
    name: "research-agent-deep-research",
    userId: options?.userId,
    sessionId: options?.sessionId,
    input: { prompt: userPrompt, runId: options?.runId },
    tags: ["langgraph-deep-research", "temporal"],
  });

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

/**
 * Combined sequential runner (used for CLI tests or direct invocation)
 */
export async function runResearchAgent(
  userPrompt: string,
  options?: AgentExecutionOptions
): Promise<AgentExecutionResult> {
  const startTime = Date.now();
  options?.onProgress?.("Evaluating input guardrail with JEV");

  const guard = await classify(userPrompt, options);

  if (!guard.isAllowed) {
    const durationSeconds = Math.round((Date.now() - startTime) / 1000);
    return {
      status: "GUARDRAIL_BLOCKED",
      prompt: userPrompt,
      answer: guard.rejectionReason || "Request blocked by safety guardrails.",
      sourcesCount: 0,
      durationSeconds,
      metadata: { scores: guard.scores },
    };
  }

  if (!guard.needsResearch) {
    return answerDirect(userPrompt, { ...options, scores: guard.scores });
  }

  return runDeepResearch(userPrompt, options);
}

