"""
Substituting `{{scope.path}}` placeholders, mirroring
`packages/plugin/src/template.ts` exactly (same scopes, same failure mode: an
unresolved placeholder raises rather than becoming an empty string).
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

SCOPES = ("env", "param", "step")

_PLACEHOLDER = re.compile(r"\{\{\s*([a-z]+)\.([A-Za-z0-9_.-]+)\s*\}\}")
# Matches a string that, once stripped, is nothing but one placeholder.
_WHOLE_PLACEHOLDER = re.compile(r"^\{\{\s*([a-z]+)\.([A-Za-z0-9_.-]+)\s*\}\}$")

TemplateScopes = Mapping[str, Mapping[str, Any] | None]


class TemplateError(Exception):
    """A placeholder that could not be resolved."""

    def __init__(self, message: str, placeholder: str) -> None:
        super().__init__(message)
        self.placeholder = placeholder


def _lookup(scopes: TemplateScopes, scope: str, path: str) -> Any:
    root = scopes.get(scope)
    if root is None:
        return None
    current: Any = root
    for segment in path.split("."):
        if not isinstance(current, dict) or segment not in current:
            return None
        current = current[segment]
    return current


def _resolve_placeholder(scope: str, path: str, scopes: TemplateScopes, placeholder: str) -> Any:
    """Resolves one placeholder to its raw value, unresolved and uncoerced.

    Shared by `render()`, which coerces the result to a string (or rejects a
    non-scalar), and `render_deep()`'s whole-placeholder passthrough, which
    does not.

    @raises TemplateError: When the scope is unknown or the value is absent.
    """
    if scope not in SCOPES:
        raise TemplateError(
            f'unknown scope "{scope}" in {{{{{placeholder}}}}}; '
            f"expected one of {', '.join(SCOPES)}",
            placeholder,
        )
    value = _lookup(scopes, scope, path)
    if value is None:
        raise TemplateError(f"{{{{{placeholder}}}}} did not resolve to a value", placeholder)
    return value


def render(text: str, scopes: TemplateScopes) -> str:
    """Substitutes every `{{scope.path}}` placeholder in `text`.

    @raises TemplateError: When a placeholder names an unknown scope or a
        value that is absent.
    """

    def substitute(match: re.Match[str]) -> str:
        scope, path = match.group(1), match.group(2)
        placeholder = f"{scope}.{path}"
        value = _resolve_placeholder(scope, path, scopes, placeholder)
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (str, int, float)):
            return str(value)
        raise TemplateError(
            f"{{{{{placeholder}}}}} resolved to a {type(value).__name__}, "
            "which cannot be substituted into text",
            placeholder,
        )

    return _PLACEHOLDER.sub(substitute, text)


def render_deep(value: Any, scopes: TemplateScopes) -> Any:
    """Renders every string inside `value`, leaving other values alone.

    A leaf that, once stripped, is nothing but a single placeholder (e.g. a
    `body:` field set to `"{{param.entity}}"`) resolves to that placeholder's
    raw value when it is a dict or list, rather than going through
    `render()` and being rejected — `render()` itself is unchanged, since
    text genuinely cannot contain a structured value. Any other placeholder,
    including one whose value is a scalar, still renders as text exactly as
    before.
    """
    if isinstance(value, str):
        stripped = value.strip()
        whole = _WHOLE_PLACEHOLDER.match(stripped)
        if whole is not None:
            scope, path = whole.group(1), whole.group(2)
            placeholder = f"{scope}.{path}"
            resolved = _resolve_placeholder(scope, path, scopes, placeholder)
            if isinstance(resolved, (dict, list)):
                return resolved
        return render(value, scopes)
    if isinstance(value, list):
        return [render_deep(item, scopes) for item in value]
    if isinstance(value, dict):
        return {render(key, scopes): render_deep(item, scopes) for key, item in value.items()}
    return value
