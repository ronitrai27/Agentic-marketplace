export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Category =
  | "security"
  | "bug"
  | "performance"
  | "maintainability"
  | "error-handling"
  | "readability"
  | "best-practice"
  | "other";

export type Verdict = "approve" | "request-changes" | "reject";

export type RiskImpact = "low" | "medium" | "high";

export interface ReviewIssue {
  severity: Severity;
  category: Category;
  title: string;
  description: string;
  file: string | null;
  line: number | null;
  suggestion: string;
  snippet: string | null;
}

export interface ReviewRisk {
  title: string;
  description: string;
  impact: RiskImpact;
  likelihood: RiskImpact;
}

export interface ReviewResult {
  summary: string;
  score: number;
  verdict: Verdict;
  issues: ReviewIssue[];
  risks: ReviewRisk[];
  strengths: string[];
  recommendations: string[];
}

export interface SourceFile {
  name: string;
  content: string;
}

export interface ReviewJob {
  mode: "paste" | "upload" | "repo";
  language: string | null;
  context: string | null;
  /** Only set for repo scans — the public URL that was reviewed. */
  repoUrl?: string | null;
  files: SourceFile[];
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};
