"""
Running a resolved case or scenario, and judging the result.

The Python-generated-test counterpart to `@agentic-test-hub/runner`. It
mirrors that package's *runtime* half only — types, assertion, expectation,
policy, verdict, state, executors, registry, run_case — never manifest
schema validation or override resolution, both of which stay TypeScript-only
(see the plan this package was built from). A generated test's own manifest
is loaded here structurally, not re-validated: it already went through the
TypeScript CLI's validated load when the test was generated.
"""

from .assertion import AssertionOutcome, check_assertion, subject_of, text_of
from .evidence import observe_browser, observe_from_result
from .executors.browser import BrowserExecutor, PlaywrightDriver
from .executors.extension import ExtensionExecutor
from .executors.http import HttpExecutor
from .executors.shell import ShellExecutor
from .executors.sql import SqlExecutor
from .expectation import check_expectation
from .manifest import Manifest, load_manifest
from .policy import DEFAULT_VERDICT_POLICY, VerdictPolicy
from .registry import ExecutorRegistry
from .run_case import CaseRunResult, compose_verdict, run_case
from .run_scenario import ScenarioRunResult, StepRunResult, run_scenario, run_step
from .state import PreparationReport, StateOutcome, ensure_state, prepare_states
from .types import ExecutionContext, ExecutionResult, Executor, ExecutorError
from .verdict import Observation, Verdict, VerdictResult, evaluate_verdict

__all__ = [
    "AssertionOutcome",
    "BrowserExecutor",
    "CaseRunResult",
    "DEFAULT_VERDICT_POLICY",
    "ExecutionContext",
    "ExecutionResult",
    "Executor",
    "ExecutorError",
    "ExecutorRegistry",
    "ExtensionExecutor",
    "HttpExecutor",
    "Manifest",
    "Observation",
    "PlaywrightDriver",
    "PreparationReport",
    "ScenarioRunResult",
    "ShellExecutor",
    "SqlExecutor",
    "StateOutcome",
    "StepRunResult",
    "Verdict",
    "VerdictPolicy",
    "VerdictResult",
    "check_assertion",
    "check_expectation",
    "compose_verdict",
    "ensure_state",
    "evaluate_verdict",
    "load_manifest",
    "observe_browser",
    "observe_from_result",
    "prepare_states",
    "run_case",
    "run_scenario",
    "run_step",
    "subject_of",
    "text_of",
]
