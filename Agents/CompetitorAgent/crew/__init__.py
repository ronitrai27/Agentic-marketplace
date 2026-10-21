"""CrewAI pipeline for the Competitor Agent.

Heavy imports (``crewai``) deliberately live in :mod:`crew.crew` so the API can
boot — and report health — without waiting on LiteLLM's import time. Import
``crew.crew`` when you actually want to run the agents.
"""

from .schemas import AnalysisResult, Competitor, IdeaValidation, Verdict
from .stages import STAGES, STAGE_LABELS

__all__ = [
    "STAGES",
    "STAGE_LABELS",
    "AnalysisResult",
    "Competitor",
    "IdeaValidation",
    "Verdict",
]
