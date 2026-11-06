// LangGraph quickstart (Graph API, calculator agent), adapted to use any chat model via initChatModel.
// Run: npm run quickstart   (needs OPENAI_API_KEY in chef/.env)
import { initChatModel } from "langchain/chat_models/universal";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import {
  StateGraph,
  StateSchema,
  MessagesValue,
  ReducedValue,
  GraphNode,
  ConditionalEdgeRouter,
  START,
  END,
} from "@langchain/langgraph";
import { SystemMessage, AIMessage, ToolMessage, HumanMessage } from "@langchain/core/messages";
import * as z from "zod";

const modelName = process.env.QUICKSTART_MODEL ?? `openai:${process.env.GPT_HEAVY_MODEL ?? "gpt-5.4-mini"}`;
const model = await initChatModel(modelName);

const add = tool(({ a, b }) => a + b, {
  name: "add",
  description: "Add two numbers",
  schema: z.object({ a: z.number().describe("First number"), b: z.number().describe("Second number") }),
});
const multiply = tool(({ a, b }) => a * b, {
  name: "multiply",
  description: "Multiply two numbers",
  schema: z.object({ a: z.number().describe("First number"), b: z.number().describe("Second number") }),
});
const divide = tool(({ a, b }) => a / b, {
  name: "divide",
  description: "Divide two numbers",
  schema: z.object({ a: z.number().describe("First number"), b: z.number().describe("Second number") }),
});

const toolsByName: Record<string, StructuredToolInterface> = { [add.name]: add, [multiply.name]: multiply, [divide.name]: divide };
const modelWithTools = model.bindTools!(Object.values(toolsByName));

const MessagesState = new StateSchema({
  messages: MessagesValue,
  llmCalls: new ReducedValue(z.number().default(0), { reducer: (x, y) => x + y }),
});

const llmCall: GraphNode<typeof MessagesState> = async (state) => ({
  messages: [
    await modelWithTools.invoke([
      new SystemMessage("You are a helpful assistant tasked with performing arithmetic on a set of inputs."),
      ...state.messages,
    ]),
  ],
  llmCalls: 1,
});

const toolNode: GraphNode<typeof MessagesState> = async (state) => {
  const last = state.messages.at(-1);
  if (last == null || !AIMessage.isInstance(last)) return { messages: [] };
  const result: ToolMessage[] = [];
  for (const call of last.tool_calls ?? []) {
    result.push(await toolsByName[call.name].invoke(call));
  }
  return { messages: result };
};

const shouldContinue: ConditionalEdgeRouter<{ InputSchema: typeof MessagesState; Nodes: "toolNode" }> = (state) => {
  const last = state.messages.at(-1);
  if (!last || !AIMessage.isInstance(last)) return END;
  return last.tool_calls?.length ? "toolNode" : END;
};

export const agent = new StateGraph(MessagesState)
  .addNode("llmCall", llmCall)
  .addNode("toolNode", toolNode)
  .addEdge(START, "llmCall")
  .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
  .addEdge("toolNode", "llmCall")
  .compile();

const result = await agent.invoke({ messages: [new HumanMessage("Add 3 and 4.")] });
for (const message of result.messages) console.log(`[${message.type}]: ${message.text}`);
