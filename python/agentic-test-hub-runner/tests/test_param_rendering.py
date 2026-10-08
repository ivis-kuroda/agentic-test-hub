"""
Params are rendered against the context scopes before they reach the `param`
scope, so a spec can write `{{env.X}}` or `{{step.name}}` in them.

The generated-test cases use the real CLI and a real local HTTP server:
placeholders must survive code generation untouched and be rendered only at
run time.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from live_plugin import BASELINE, PLUGIN, make_case
from live_support import (
    generate,
    live_server,
    requires_cli,
    run_generated,
    write_specs,
    write_yaml,
)

from agentic_test_hub_runner import (
    ExecutionContext,
    ExecutionResult,
    ExecutorError,
    ExecutorRegistry,
    Manifest,
)

SECRET = "param-secret-9f8e7d6c5b4a"

PARAM_PLUGIN: dict[str, Any] = {
    **PLUGIN,
    "operations": {
        **PLUGIN["operations"],
        "OP-SEND-AS": {
            "executor": "http",
            "connection": "api",
            "method": "POST",
            "path": "/notifications",
            "params": ["recipient", "token"],
            "headers": {"Authorization": "Bearer {{param.token}}"},
            "body": {"recipient": "{{param.recipient}}"},
        },
    },
}


class _Recorder:
    kind = "shell"

    def __init__(self) -> None:
        self.params: dict[str, Any] = {}

    def run(self, operation: dict[str, Any], context: ExecutionContext) -> ExecutionResult:
        self.params = dict(context.scopes["param"])
        return ExecutionResult(operation="x", ok=True, duration_ms=0)


def _registry_and_context(scopes: dict[str, Any]) -> tuple[ExecutorRegistry, _Recorder, Any]:
    manifest = Manifest(
        name="p",
        connections={},
        operations={"OP": {"executor": "shell", "params": ["a"], "optionalParams": ["b"]}},
        states={},
        evidence={},
        policy=None,
        extension_module=None,
    )
    recorder = _Recorder()
    registry = ExecutorRegistry().register(recorder)
    return registry, recorder, ExecutionContext(manifest=manifest, scopes=scopes)


def test_params_are_rendered_with_the_context_scopes() -> None:
    registry, recorder, context = _registry_and_context(
        {"env": {"TOKEN": "t-1"}, "step": {"recid": "42"}, "run": {"id": "r"}}
    )
    registry.run(
        "OP",
        {"a": "{{env.TOKEN}}", "b": ["x-{{step.recid}}", {"run": "{{run.id}}"}], "n": 3},
        context,
    )
    assert recorder.params == {"a": "t-1", "b": ["x-42", {"run": "r"}], "n": 3}


def test_a_whole_placeholder_keeps_a_structured_value() -> None:
    registry, recorder, context = _registry_and_context({"step": {"doc": {"k": [1, 2]}}})
    registry.run("OP", {"a": "{{step.doc}}"}, context)
    assert recorder.params["a"] == {"k": [1, 2]}


def test_an_unresolved_placeholder_names_operation_param_and_placeholder() -> None:
    registry, _recorder, context = _registry_and_context({"env": {}})
    with pytest.raises(ExecutorError) as raised:
        registry.run("OP", {"a": "{{env.MISSING_VALUE}}"}, context)
    message = str(raised.value)
    assert "OP" in message and '"a"' in message and "env.MISSING_VALUE" in message


@requires_cli
def test_generated_case_renders_env_placeholders_in_action_params_at_run_time(
    tmp_path: Path,
) -> None:
    plugin = tmp_path / "plugin.yaml"
    write_yaml(plugin, PARAM_PLUGIN)
    baseline = {
        **BASELINE,
        "action": {"operation": "OP-SEND-AS", "params": {"token": "{{env.LIVE_SECRET}}"}},
    }
    case = make_case(evidence={"sources": ["app_log"], "timing": "after"})
    specs = write_specs(tmp_path, baseline, [case], [])
    test_file = generate(tmp_path, specs, plugin, "TC-LIVE-001")
    # Generation must not resolve or choke on the placeholder.
    generated = test_file.read_text()
    assert "{{env.LIVE_SECRET}}" in generated and SECRET not in generated

    evidence_root = tmp_path / "evidence"
    with live_server() as (url, state):
        done = run_generated(
            test_file,
            {
                "APP_URL": url,
                "LIVE_TOKEN": "unused",
                "LIVE_SECRET": SECRET,
                "ATH_EVIDENCE_DIR": str(evidence_root),
            },
        )
    assert done.returncode == 0, done.stdout + done.stderr
    # The server really received the rendered token, and logged it...
    assert any(f"token={SECRET}" in line for line in state.log)
    # ...yet it appears nowhere in the saved evidence.
    saved = [p for p in evidence_root.rglob("*") if p.is_file()]
    assert saved
    leaks = [str(p) for p in saved if SECRET.encode() in p.read_bytes()]
    assert leaks == []


@requires_cli
def test_generated_scenario_renders_step_placeholders_in_later_steps(tmp_path: Path) -> None:
    plugin = tmp_path / "plugin.yaml"
    write_yaml(plugin, PARAM_PLUGIN)

    def step(step_id: str, recipient: str, depends: list[str], produces: dict[str, str]):
        return {
            "id": step_id,
            "summary": step_id,
            "action": {
                "operation": "OP-SEND-AS",
                "params": {"recipient": recipient, "token": "{{env.LIVE_SECRET}}"},
            },
            "expect": [{"kind": "http_status", "status": 201, "viewpoints": []}],
            "polarity": "nominal",
            "dependsOn": depends,
            "produces": produces,
            "viewpoints": [],
        }

    scenario = {
        "id": "SC-LIVE-001",
        "title": "send, then send using the first id",
        "preconditions": [],
        "steps": [
            step("S-1", "first@example.invalid", [], {"recid": "body.notification.id"}),
            step("S-2", "{{step.recid}}", ["S-1"], {}),
        ],
        "cleanup": [],
        "evidence": {"sources": ["app_log"], "timing": "after"},
        "evidenceWaivers": [],
        "tags": [],
        "viewpoints": [],
    }
    specs = write_specs(tmp_path, BASELINE, [], [scenario])
    test_file = generate(tmp_path, specs, plugin, "SC-LIVE-001")
    assert "{{step.recid}}" in test_file.read_text()

    with live_server() as (url, state):
        done = run_generated(
            test_file,
            {"APP_URL": url, "LIVE_TOKEN": "unused", "LIVE_SECRET": SECRET},
        )
    assert done.returncode == 0, done.stdout + done.stderr
    assert [n["recipient"] for n in state.notifications] == ["first@example.invalid", "1"]
