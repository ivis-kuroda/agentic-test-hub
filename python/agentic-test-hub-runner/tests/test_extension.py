from __future__ import annotations

import types

import pytest

from agentic_test_hub_runner import ExecutionContext, ExecutionResult, ExecutorError, Manifest
from agentic_test_hub_runner.executors.extension import ExtensionExecutor

MANIFEST = Manifest(
    name="x",
    connections={},
    operations={},
    states={},
    evidence={},
    policy=None,
    extension_module="plugin.extensions",
)


def _context(params: dict) -> ExecutionContext:
    return ExecutionContext(manifest=MANIFEST, scopes={"param": params}, root="/plugin")


def test_calls_the_named_handler_with_params_and_context() -> None:
    seen = {}

    def seed_item_type(params, context):
        seen["params"] = params
        seen["root"] = context.root
        return {"ok": True, "rows": [{"id": 1}]}

    module = types.SimpleNamespace(seed_item_type=seed_item_type)
    executor = ExtensionExecutor(module)
    result = executor.run(
        {"executor": "extension", "handler": "seed_item_type"}, _context({"name": "book"})
    )

    assert seen["params"] == {"name": "book"}
    assert seen["root"] == "/plugin"
    assert result.ok is True
    assert result.rows == [{"id": 1}]
    assert result.operation == "seed_item_type"


def test_a_handler_may_return_an_execution_result_directly() -> None:
    def handler(params, context):
        return ExecutionResult(operation="custom", ok=False, duration_ms=5, failure="nope")

    module = types.SimpleNamespace(handler=handler)
    executor = ExtensionExecutor(module)
    result = executor.run({"executor": "extension", "handler": "handler"}, _context({}))
    assert result.ok is False
    assert result.operation == "custom"


def test_raises_when_the_module_has_no_such_handler() -> None:
    module = types.SimpleNamespace()
    executor = ExtensionExecutor(module)
    with pytest.raises(ExecutorError, match="no handler named"):
        executor.run({"executor": "extension", "handler": "missing"}, _context({}))
