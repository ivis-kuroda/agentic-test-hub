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


def test_render_rejects_substituting_an_object_into_text() -> None:
    with pytest.raises(TemplateError, match="cannot be substituted"):
        render("{{param.nested}}", {"param": {"nested": {"id": 42}}})


def test_render_deep_passes_a_whole_placeholder_dict_value_through_raw() -> None:
    result = render_deep({"entity": "{{param.nested}}"}, {"param": {"nested": {"id": 42}}})
    assert result == {"entity": {"id": 42}}


def test_render_deep_passes_a_whole_placeholder_list_value_through_raw() -> None:
    result = render_deep({"tags": "{{param.tags}}"}, {"param": {"tags": ["a", "b"]}})
    assert result == {"tags": ["a", "b"]}


def test_render_deep_mixes_raw_passthrough_with_ordinary_text_substitution() -> None:
    result = render_deep(
        {"entity": "{{param.nested}}", "label": "for {{param.user}}"},
        {"param": {"nested": {"id": 42}, "user": "ada"}},
    )
    assert result == {"entity": {"id": 42}, "label": "for ada"}


def test_render_deep_still_renders_a_whole_placeholder_scalar_as_text() -> None:
    result = render_deep({"user": "{{param.user}}"}, {"param": {"user": "ada"}})
    assert result == {"user": "ada"}


def test_render_deep_tolerates_surrounding_whitespace_around_a_whole_placeholder() -> None:
    result = render_deep({"entity": "  {{ param.nested }}  "}, {"param": {"nested": {"id": 42}}})
    assert result == {"entity": {"id": 42}}


def test_render_deep_still_raises_for_an_unresolved_whole_placeholder() -> None:
    with pytest.raises(TemplateError):
        render_deep({"entity": "{{param.missing}}"}, {"param": {}})
