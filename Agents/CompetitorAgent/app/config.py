"""Environment loading for the Competitor Agent (CompetitorAgent/.env)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
import os

from crew import tinyfish

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def _flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    model: str
    temperature: float
    search_provider: str
    port: int
    database_url: str
    max_competitors: int
    max_idea_chars: int
    crew_verbose: bool
    cors_origins: tuple[str, ...]

    @property
    def search_configured(self) -> bool:
        """TinyFish is the only provider — key from env or the TinyFish CLI."""
        if self.search_provider == "none":
            return False
        return tinyfish.is_configured()

    @property
    def llm_configured(self) -> bool:
        """Ollama/LM Studio need no key; hosted providers do."""
        model = self.model.lower()
        if model.startswith(("ollama/", "lm_studio/", "local/")):
            return True
        return bool(
            os.getenv("OPENAI_API_KEY", "").strip()
            or os.getenv("OPENROUTER_API_KEY", "").strip()
            or os.getenv("GROQ_API_KEY", "").strip()
            or os.getenv("ANTHROPIC_API_KEY", "").strip()
        )


settings = Settings(
    model=os.getenv("MODEL", "openai/gpt-4.1-mini"),
    temperature=float(os.getenv("LLM_TEMPERATURE", "0.2")),
    search_provider="tinyfish",
    port=int(os.getenv("PORT", "3007")),
    database_url=os.getenv(
        "DATABASE_URL",
        "postgresql://competitor:competitor_local_password@localhost:5436/competitor_agent",
    ),
    max_competitors=int(os.getenv("MAX_COMPETITORS", "5")),
    max_idea_chars=int(os.getenv("MAX_IDEA_CHARS", "4000")),
    crew_verbose=_flag("CREW_VERBOSE"),
    cors_origins=tuple(
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:3007,http://127.0.0.1:3007",
        ).split(",")
        if origin.strip()
    ),
)
