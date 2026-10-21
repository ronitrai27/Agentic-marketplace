"""Stage names shared by the crew and the API — no heavy imports here."""

STAGES = ("validating", "scouting", "analysing", "verdict")

STAGE_LABELS = {
    "queued": "Queued",
    "validating": "Validating the idea",
    "scouting": "Scouting competitors",
    "analysing": "Studying what & how competitors build",
    "verdict": "Writing the verdict",
    "completed": "Completed",
    "failed": "Failed",
}
