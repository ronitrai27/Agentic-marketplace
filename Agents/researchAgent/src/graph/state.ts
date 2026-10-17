import { Annotation } from "@langchain/langgraph";

export interface ResearchSource {
  title: string;
  url: string;
  keyTakeaway?: string;
}

export interface ResearchSection {
  id: string;
  title: string;
  description: string;
  searchQueries: string[];
  findings?: string;
  sources: ResearchSource[];
}

export const ResearchStateAnnotation = Annotation.Root({
  topic: Annotation<string>(),
  // Reducer to merge worker updates by section id
  sections: Annotation<ResearchSection[]>({
    reducer: (current, update) => {
      const map = new Map(current.map((s) => [s.id, s]));
      for (const item of update) {
        const existing = map.get(item.id) || ({} as ResearchSection);
        map.set(item.id, { ...existing, ...item });
      }
      return Array.from(map.values());
    },
    default: () => [],
  }),
  critiqueCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  critiqueFeedback: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  needsMoreResearch: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
  finalReport: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),
});

export type ResearchState = typeof ResearchStateAnnotation.State;
