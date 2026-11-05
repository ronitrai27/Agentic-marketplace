export type IssueSeverity = "critical" | "high" | "medium" | "low" | "info";

export type IssueCategory =
  | "crawlability"
  | "indexability"
  | "hydration_drop"
  | "rendering_mismatch"
  | "structured_data"
  | "core_web_vitals"
  | "semantic_cannibalization"
  | "geo_visibility";

export interface EvidencePackage {
  url: string;
  timestamp: string;
  contentHash: string;
  rawHtmlSnippet?: string;
  renderedDomSnippet?: string;
  domDiff?: string;
  screenshotUrl?: string;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
    selector: string;
  };
  harRecordId?: string;
}

export interface SeoIssue {
  id: string;
  url: string;
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  evidence: EvidencePackage;
  remediationProposal?: {
    framework: "nextjs" | "schema" | "redirect" | "general";
    suggestedPatch: string;
    filePath?: string;
  };
}

export interface CrawlTarget {
  url: string;
  depth: number;
  priority: number;
  referringUrl?: string;
}
