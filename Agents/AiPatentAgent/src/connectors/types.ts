/** Connector contract: every source degrades to `unavailable` instead of failing the run. */

export interface SearchQuery {
  terms: string[];        // keyword terms from the draft / LLM query formulator
  phrase: string;         // one human-readable query
  cpc?: string;           // optional CPC hint
  max: number;            // per-source cap
  queryIndex: number;     // for connector throttle pacing
}

export interface Candidate {
  publicationNumber?: string;
  familyId?: string;
  kind: 'patent' | 'npl' | 'web';
  office?: string;        // US, EP, WO, arXiv, web...
  title?: string;
  assignee?: string;
  cpc?: string;
  priorityDate?: string;  // ISO date
  publicationDate?: string;
  url: string;
  snippet: string;        // searchable text used for lexical fallback charting
  source: string;         // connector name (provenance)
}

export class SourceError extends Error {
  constructor(
    public readonly source: string,
    message: string,
    public readonly retriable = false,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

export interface Connector {
  name: string;
  /** Static availability (key present, flag enabled). No network. */
  available(): boolean;
  /** Human reason when unavailable — surfaced in F9 honest-coverage line. */
  unavailableReason?(): string;
  search(q: SearchQuery): Promise<Candidate[]>;
}
