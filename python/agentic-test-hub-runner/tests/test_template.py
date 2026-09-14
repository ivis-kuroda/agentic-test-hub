from __future__ import annotations

import pytest

from agentic_test_hub_runner.template import TemplateError, render, render_deep


def test_substitutes_a_known_placeholder() -> None:
    assert render("hello {{param.name}}", {"param": {"name": "world"}}) == "hello world"


def test_stringifies_numbers_and_booleans() -> None:
    assert render("{{param.n}}", {"param": {"n": 3}}) == "3"
    assert render("{{param.flag}}", {"param": {"flag": True}}) == "true"


def test_raises_for_an_unknown_scope() -> None:
    with pytest.raises(TemplateError, match="unknown scope"):
        render("{{bogus.x}}", {})


def test_raises_for_an_unresolved_placeholder() -> None:
    with pytest.raises(TemplateError, match="did not resolve"):
        render("{{param.missing}}", {"param": {}})


def test_render_deep_walks_nested_structures() -> None:
    result = render_deep(
        {"a": ["{{param.x}}", {"b": "{{param.y}}"}], "c": 1}, {"param": {"x": "1", "y": "2"}}
    )
    assert result == {"a": ["1", {"b": "2"}], "c": 1}
