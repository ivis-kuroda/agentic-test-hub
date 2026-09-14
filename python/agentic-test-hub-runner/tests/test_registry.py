from __future__ import annotations

import pytest

from agentic_test_hub_runner import ExecutorError, ExecutorRegistry


def test_run_merges_params_into_the_param_scope(context, registry_with, sequenced_fetch) -> None:
    fetch = sequenced_fetch(201, "ignored")
    registry = registry_with(fetch)
    result = registry.run("OP-SEND", {"channel": "sms"}, context)
    assert result.status == 201
    assert result.operation == "OP-SEND"


def test_raises_for_an_undeclared_operation(context, registry_with, sequenced_fetch) -> None:
    registry = registry_with(sequenced_fetch(200, ""))
    with pytest.raises(ExecutorError, match="not declared"):
        registry.run("OP-NOPE", {}, context)


def test_raises_when_no_executor_is_registered_for_the_kind(context) -> None:
    registry = ExecutorRegistry()
    with pytest.raises(ExecutorError, match="no executor is registered"):
        registry.run("OP-SEND", {"channel": "sms"}, context)


def test_raises_when_a_declared_param_is_missing(context, registry_with, sequenced_fetch) -> None:
    registry = registry_with(sequenced_fetch(201, ""))
    with pytest.raises(ExecutorError, match="channel"):
        registry.run("OP-SEND", {}, context)
