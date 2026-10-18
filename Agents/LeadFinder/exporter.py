from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Union
from models import UniversalLeadReport


def export_to_json(report: UniversalLeadReport, filepath: Union[str, Path]) -> Path:
    """Exports UniversalLeadReport to formatted JSON."""
    path = Path(filepath)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report.model_dump(), f, indent=2, ensure_ascii=False)
    return path


def export_to_csv(report: UniversalLeadReport, filepath: Union[str, Path]) -> Path:
    """
    Exports dynamic leads to CSV.
    Headers are generated dynamically from the user's required_fields.
    """
    path = Path(filepath)
    path.parent.mkdir(parents=True, exist_ok=True)

    # Determine dynamic columns from report required_fields and leads
    fields = list(report.required_fields)
    for lead in report.leads:
        for k in lead.data.keys():
            if k not in fields:
                fields.append(k)

    headers = [f.replace("_", " ").title() for f in fields] + ["Evidence Source URL", "Critic Audit Verdict"]

    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(headers)

        for lead in report.leads:
            row = []
            for f in fields:
                val = lead.data.get(f)
                if val is None:
                    row.append("")
                elif isinstance(val, (list, dict)):
                    row.append(json.dumps(val, ensure_ascii=False))
                else:
                    row.append(str(val))
            row.append(lead.source_url)
            row.append(lead.critic_verdict)
            writer.writerow(row)

    return path
