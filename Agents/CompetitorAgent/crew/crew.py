"""The CrewAI pipeline: four sequential stages, one job per stage.

    validate  →  scout  →  analyst  →  strategist

Each stage runs as its own single-agent crew and returns parsed JSON, so the
runner can persist progress between stages and keep whatever was produced even
if a later stage fails.
"""

from __future__ import annotations

import json
import os

from crewai import Agent, Crew, LLM, Process, Task

from .parsing import as_model, extract_json
from .schemas import AnalystResult, IdeaValidation, ScoutResult, Verdict
from .stages import STAGES, STAGE_LABELS  # noqa: F401  (re-exported for callers)
from .tools import fetch_webpage, web_search


def _llm() -> LLM:
    return LLM(
        model=os.getenv("MODEL", "openai/gpt-4.1-mini"),
        temperature=float(os.getenv("LLM_TEMPERATURE", "0.2")),
    )


def _kickoff(agent: Agent, description: str, expected_output: str, verbose: bool = False):
    task = Task(description=description, expected_output=expected_output, agent=agent)
    crew = Crew(
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        verbose=verbose,
    )
    output = crew.kickoff()
    raw = getattr(output, "raw", None) or str(output)
    return extract_json(raw)


def _agent(role: str, goal: str, backstory: str, tools=None) -> Agent:
    return Agent(
        role=role,
        goal=goal,
        backstory=backstory,
        llm=_llm(),
        tools=tools or [],
        verbose=False,
        allow_delegation=False,
    )


JSON_ONLY = "Reply with ONLY the JSON object described above — no prose, no markdown fences, no comments."


# ───────────────────────────── stage 1 ─────────────────────────────

def run_validation(idea: str, audience: str) -> IdeaValidation:
    agent = _agent(
        role="Idea Validator",
        goal="Decide whether a product idea is worth building before anyone spends money on it.",
        backstory=(
            "You are a pragmatic market analyst. You have killed more ideas than you "
            "have approved, and you are respected for it. You never invent facts: you "
            "check the market with web_search and quote what you find."
        ),
        tools=[web_search],
    )
    description = f"""Validate this product idea.

IDEA:
{idea}

TARGET AUDIENCE (may be empty): {audience or "not specified"}

Method:
1. Restate the idea in one crisp sentence (refined_idea).
2. Name the product category and the job-to-be-done (category, problem_solved).
3. Say exactly who buys it: consumer vs B2B, company size, role/persona (target_audience).
4. Run web_search 2-4 times to test reality, e.g. "<category> market size", "<category> tools",
   "<category> startups", "alternatives to <known product>". Capture concrete demand signals.
5. List the risks that could sink this idea (risks): saturation, incumbents, regulation, willingness to pay...
6. Invent 4-6 sharp search queries that would find every serious competitor (search_queries),
   including an "alternatives to X" style query for the best-known incumbent you found.
7. Score novelty_score (0-100, 100 = nobody does this) and feasibility_score (0-100, a small
   team could ship an MVP in ~8 weeks = high), then pick verdict:
   "promising" | "crowded-but-viable" | "saturated" | "unclear".

{JSON_ONLY}

Expected JSON keys: refined_idea, category, target_audience, problem_solved, demand_signals[],
risks[], search_queries[], novelty_score, feasibility_score, verdict, summary
"""
    data = _kickoff(
        agent,
        description,
        "A single JSON object with the validation fields listed in the description.",
    )
    return as_model(data, IdeaValidation)


# ───────────────────────────── stage 2 ─────────────────────────────

def run_scout(validation: IdeaValidation, max_competitors: int) -> ScoutResult:
    agent = _agent(
        role="Competitor Scout",
        goal="Find every serious competitor for a product idea in the current market.",
        backstory=(
            "You are a competitive-intelligence scout. You know that the first search "
            "results are ads, so you run several differently-worded searches and merge "
            "the answers. You only list real, shipping products — never vaporware or "
            "blog listicles pretending to be tools."
        ),
        tools=[web_search],
    )
    queries = "\n".join(f"- {q}" for q in validation.search_queries) or "- (none given — invent your own)"
    description = f"""Find the real competitors for this idea.

REFINED IDEA: {validation.refined_idea or validation.summary or "n/a"}
CATEGORY: {validation.category}
AUDIENCE: {validation.target_audience}

Starter queries:
{queries}

Method:
1. Run web_search for each starter query, plus 2-4 of your own such as
   "best <category> tools", "<category> software comparison", "<category> startups 2026".
2. Merge and de-duplicate by company name. Drop agencies, consultants, directories,
   and anything that is not a product competing for the same user.
3. Rank by how directly it competes with the refined idea.
4. Keep the top {max_competitors}.

{JSON_ONLY}

Expected JSON keys: competitors[] with {{name, website, one_liner, source_url}}, notes
"""
    data = _kickoff(
        agent,
        description,
        f"A single JSON object whose competitors array holds at most {max_competitors} real products.",
    )
    result = as_model(data, ScoutResult)
    result.competitors = [c for c in result.competitors if c.name.strip()][:max_competitors]
    return result


# ───────────────────────────── stage 3 ─────────────────────────────

def run_competitor_analysis(validation: IdeaValidation, scout: ScoutResult) -> AnalystResult:
    agent = _agent(
        role="Competitor Analyst",
        goal="Explain what each competitor does and how they do it, with evidence.",
        backstory=(
            "You are a product analyst. For each competitor you read what they ship, "
            "how the product actually works, what it costs and who it is for. You keep "
            "every claim tied to a source URL you found with web_search, and you open "
            "the competitor's own pages with fetch_webpage rather than guessing."
        ),
        tools=[web_search, fetch_webpage],
    )
    shortlist = json.dumps(
        [c.model_dump() for c in scout.competitors], ensure_ascii=False, indent=2
    )
    description = f"""Research each competitor below in depth.

CONTEXT — our idea: {validation.refined_idea or validation.summary}
CATEGORY: {validation.category}    AUDIENCE: {validation.target_audience}

COMPETITOR SHORTLIST:
{shortlist}

Method, for every competitor:
1. Run web_search: "<name> product", "<name> pricing", "<name> how it works" (skip searches you
   already have enough signal for, but do not answer from memory alone).
2. Then fetch_webpage on that competitor's own site (product or pricing page) to confirm what they
   actually ship. If the fetch fails, fall back to the search snippets and say so in sources only.
3. what_they_do — the offer in 1-2 concrete sentences (not marketing fluff).
4. how_they_do_it — the mechanism: the approach, tech, workflow, delivery model, moat.
5. pricing_model — free / freemium / per-seat / usage-based / enterprise, with numbers if found.
6. target_users — who actually pays.
7. strengths[] and weaknesses[] — 2-4 each, grounded in evidence (reviews, docs, comparisons).
8. threat_level vs our idea: "high" (same user, same job) | "medium" | "low".
9. sources[] — the URLs you actually used.

Keep every competitor in the shortlist. {JSON_ONLY}

Expected JSON keys: competitors[] with {{name, website, one_liner, what_they_do,
how_they_do_it, pricing_model, target_users, threat_level, strengths[], weaknesses[], sources[]}}, notes
"""
    data = _kickoff(
        agent,
        description,
        "A single JSON object with one researched entry per shortlisted competitor.",
    )
    result = as_model(data, AnalystResult)
    result.competitors = [c for c in result.competitors if c.name.strip()]
    return result


# ───────────────────────────── stage 4 ─────────────────────────────

def run_verdict(
    validation: IdeaValidation,
    competitors: list,
    audience: str,
) -> Verdict:
    agent = _agent(
        role="Strategy Verdict",
        goal="Compare the idea against the researched competition and say what to do.",
        backstory=(
            "You are a founder-facing strategist. You decide between go, pivot, niche "
            "and no-go, and you always show the whitespace the team could actually own."
        ),
        tools=[web_search],
    )
    rivals = json.dumps([c.model_dump() for c in competitors], ensure_ascii=False, indent=2)
    description = f"""Give the verdict on this idea against the competition.

IDEA: {validation.refined_idea or validation.summary}
AUDIENCE: {audience or validation.target_audience}
CATEGORY: {validation.category}
VALIDATION: verdict={validation.verdict}, novelty={validation.novelty_score}/100,
feasibility={validation.feasibility_score}/100

COMPETITORS (researched):
{rivals}

Do:
1. Compare head-to-head. Who takes the same user for the same job?
2. Find the gaps[] — real whitespace: unserved segment, missing pricing tier, ignored
   channel, underserved platform, compliance angle. For each, say how_to_capitalize.
3. differentiators[] — 3-5 moves that would make this idea distinct from the list above.
4. risks[] — the 3-5 biggest reasons this fails anyway.
5. next_steps[] — 4-6 concrete validation actions for the coming two weeks.
6. overall_score 0-100 (100 = obvious winner) and recommendation:
   "go" (clear gap, pursue) | "pivot" (reposition around a gap) |
   "niche" (own a small segment first) | "no-go" (market already won).
7. summary — 3-4 sentences a founder could quote back to their team.

{JSON_ONLY}

Expected JSON keys: overall_score, recommendation, summary, gaps[] with {{gap, how_to_capitalize}},
differentiators[], risks[], next_steps[]
"""
    data = _kickoff(
        agent,
        description,
        "A single JSON object with the verdict fields listed in the description.",
    )
    return as_model(data, Verdict)
