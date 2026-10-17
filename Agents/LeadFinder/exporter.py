from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Union
from models import FinalLeadReport, LeadItem


def export_to_json(report: FinalLeadReport, filepath: Union[str, Path]) -> Path:
    """Exports FinalLeadReport to a formatted JSON file."""
    path = Path(filepath)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report.model_dump(), f, indent=2, ensure_ascii=False)
    return path


def export_to_csv(report: FinalLeadReport, filepath: Union[str, Path]) -> Path:
    """
    Exports FinalLeadReport leads to a clean, outreach-ready CSV file.
    Compatible with Google Sheets, Excel, Instantly, Apollo, and HubSpot.
    """
    path = Path(filepath)
    path.parent.mkdir(parents=True, exist_ok=True)

    headers = [
        "Title",
        "Primary URL",
        "Phone",
        "Email",
        "Contact Person",
        "Location",
        "Match Reason",
        "Social Links",
        "Rating",
        "Reviews Count",
        "Extra Attributes",
    ]

    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(headers)

        for lead in report.leads:
            socials_str = "; ".join(lead.social_links) if lead.social_links else ""
            rating = lead.attributes.get("rating", "")
            reviews = lead.attributes.get("reviews_count", "")
            
            # Format remaining attributes cleanly
            other_attrs = {
                k: v for k, v in lead.attributes.items()
                if k not in ("rating", "reviews_count")
            }
            attrs_str = json.dumps(other_attrs, ensure_ascii=False) if other_attrs else ""

            writer.writerow([
                lead.title,
                lead.primary_url,
                lead.phone or "",
                lead.email or "",
                lead.contact_name or "",
                lead.location or "",
                lead.match_reason,
                socials_str,
                rating,
                reviews,
                attrs_str,
            ])

    return path
