"""Unit tests for the JSON-recovery helpers (no network, no LLM)."""

import json

import pytest

from crew.parsing import as_model, extract_json
from crew.schemas import AnalysisResult, IdeaValidation, Verdict


def test_plain_json():
    assert extract_json('{"a": 1}') == {"a": 1}


def test_markdown_fenced_json():
    text = '```json\n{"a": 1, "b": [1, 2]}\n```'
    assert extract_json(text) == {"a": 1, "b": [1, 2]}


def test_preamble_and_fences():
    text = 'Sure! Here is the analysis you asked for:\n```json\n{"verdict": "go"}\n```\nHope that helps.'
    assert extract_json(text) == {"verdict": "go"}


def test_nested_strings_with_braces():
    payload = {"summary": "ships {fast} and [clean]"}
    assert extract_json("preamble " + json.dumps(payload)) == payload


def test_trailing_comma_tolerated():
    assert extract_json('{"a": 1, "b": 2,}') == {"a": 1, "b": 2}


def test_array_payload():
    assert extract_json("results: [1, 2, 3]") == [1, 2, 3]


def test_garbage_raises():
    with pytest.raises(ValueError):
        extract_json("no json here at all")


def test_validation_defaults_from_partial_payload():
    model = as_model({"refined_idea": "AI coach", "novelty_score": 61}, IdeaValidation)
    assert model.refined_idea == "AI coach"
    assert model.novelty_score == 61
    assert model.search_queries == []
    assert model.verdict == "unclear"


def test_validation_tolerates_wrong_types():
    model = as_model({"risks": "one big risk", "novelty_score": "42"}, IdeaValidation)
    assert model.risks == ["one big risk"]
    assert model.novelty_score == 42


def test_verdict_nested_gaps():
    data = {
        "overall_score": 72,
        "recommendation": "niche",
        "gaps": [{"gap": "no cheap tier", "how_to_capitalize": "offer $9 plan"}],
    }
    verdict = as_model(data, Verdict)
    assert verdict.gaps[0].gap == "no cheap tier"
    assert verdict.next_steps == []


def test_analysis_result_round_trip():
    result = AnalysisResult(idea="test idea")
    again = AnalysisResult.model_validate(json.loads(result.model_dump_json()))
    assert again.idea == "test idea"
    assert again.verdict.recommendation == "no-go"
