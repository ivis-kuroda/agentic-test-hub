from __future__ import annotations

from agentic_test_hub_runner import ExecutionContext, Manifest
from agentic_test_hub_runner.executors.shell import ShellExecutor

MANIFEST = Manifest(
    name="x",
    connections={},
    operations={},
    states={},
    evidence={},
    policy=None,
    extension_module=None,
)


def _context(params: dict) -> ExecutionContext:
    return ExecutionContext(manifest=MANIFEST, scopes={"param": params}, root="/tmp")


def test_runs_a_real_command_and_captures_stdout() -> None:
    executor = ShellExecutor()
    operation = {
        "run": ["echo", "hello {{param.name}}"],
        "env": {},
        "timeoutMs": 5_000,
        "stdin": "none",
    }
    result = executor.run(operation, _context({"name": "world"}))
    assert result.ok is True
    assert result.exit_code == 0
    assert (result.stdout or "").strip() == "hello world"


def test_a_non_zero_exit_is_a_completed_operation() -> None:
    executor = ShellExecutor()
    operation = {"run": ["sh", "-c", "exit 3"], "env": {}, "timeoutMs": 5_000, "stdin": "none"}
    result = executor.run(operation, _context({}))
    assert result.ok is True
    assert result.exit_code == 3


def test_stdin_json_passes_the_param_scope_on_stdin() -> None:
    executor = ShellExecutor()
    operation = {"run": ["cat"], "env": {}, "timeoutMs": 5_000, "stdin": "json"}
    result = executor.run(operation, _context({"name": "world"}))
    assert result.ok is True
    assert '"name": "world"' in (result.stdout or "")


def test_an_unreachable_command_is_reported_as_a_failure() -> None:
    executor = ShellExecutor()
    operation = {
        "run": ["this-command-does-not-exist"],
        "env": {},
        "timeoutMs": 5_000,
        "stdin": "none",
    }
    result = executor.run(operation, _context({}))
    assert result.ok is False
    assert "could not be run" in (result.failure or "")
