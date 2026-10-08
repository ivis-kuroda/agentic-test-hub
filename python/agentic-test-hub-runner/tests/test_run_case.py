from __future__ import annotations

from agentic_test_hub_runner import run_case


def _resolved(baseline: dict) -> dict:
    return {
        "preconditions": [],
        "config": {},
        "context": baseline["context"],
        "action": baseline["action"],
    }


def test_passes_when_the_action_succeeds_and_evidence_is_clean(
    context, registry_with, sequenced_fetch, baseline, make_case
) -> None:
    registry = registry_with(sequenced_fetch(201, "all quiet"))
    result = run_case(make_case(), _resolved(baseline), {"channel": "email"}, registry, context)

    assert result.expectations[0].outcome.verdict == "satisfied"
    assert result.evidence.verdict == "pass"
    assert result.verdict == "pass"


def test_fails_when_an_expectation_is_violated_even_if_evidence_is_clean(
    context, registry_with, sequenced_fetch, baseline, make_case
) -> None:
    # The action returns 200, not the 201 the case expects.
    registry = registry_with(sequenced_fetch(200, "all quiet"))
    result = run_case(make_case(), _resolved(baseline), {"channel": "email"}, registry, context)

    assert result.expectations[0].outcome.verdict == "violated"
    assert result.evidence.verdict == "pass"
    assert result.verdict == "fail"


def test_fails_when_evidence_is_dirty_even_though_every_expectation_is_satisfied(
    context, registry_with, sequenced_fetch, baseline, make_case
) -> None:
    registry = registry_with(sequenced_fetch(201, "error: something broke"))
    result = run_case(make_case(), _resolved(baseline), {"channel": "email"}, registry, context)

    assert result.expectations[0].outcome.verdict == "satisfied"
    assert result.evidence.verdict == "fail"
    assert result.verdict == "fail"


def test_is_inconclusive_and_runs_nothing_when_a_precondition_is_not_ready(
    context, registry_with, sequenced_fetch, baseline, make_case
) -> None:
    unready_resolved = {**_resolved(baseline), "preconditions": ["never.ready"]}
    fetch = sequenced_fetch(201, "all quiet")
    registry = registry_with(fetch)
    result = run_case(make_case(), unready_resolved, {"channel": "email"}, registry, context)

    assert result.preparation.ready is False
    assert result.action is None
    assert result.verdict == "inconclusive"


def test_a_plans_ignore_patterns_suppress_known_noise_in_the_verdict(
    context, registry_with, sequenced_fetch, baseline, make_case
) -> None:
    dirty = "ERROR expected rejection of recipient"
    plain = run_case(
        make_case(),
        _resolved(baseline),
        {"channel": "email"},
        registry_with(sequenced_fetch(201, dirty)),
        context,
    )
    assert plain.evidence.verdict == "fail"

    ignoring = run_case(
        make_case(evidence={"sources": ["app_log"], "ignore": ["expected rejection"]}),
        _resolved(baseline),
        {"channel": "email"},
        registry_with(sequenced_fetch(201, dirty)),
        context,
    )
    assert ignoring.observations[0].errors == []
    assert ignoring.observations[0].suppressed == 1
    assert ignoring.evidence.verdict == "pass"
    assert ignoring.verdict == "pass"


def test_a_plans_ignore_merges_with_caller_supplied_observe_options(
    context, registry_with, sequenced_fetch, baseline, make_case
) -> None:
    from agentic_test_hub_runner import ObserveOptions, RunOptions

    log = "ERROR first\nERROR second"
    result = run_case(
        make_case(evidence={"sources": ["app_log"], "ignore": ["first"]}),
        _resolved(baseline),
        {"channel": "email"},
        registry_with(sequenced_fetch(201, log)),
        context,
        RunOptions(observe=ObserveOptions(ignore=["second"])),
    )
    assert result.observations[0].errors == []
    assert result.observations[0].suppressed == 2
