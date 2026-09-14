from __future__ import annotations

import httpx
import pytest

from agentic_test_hub_runner import prepare_states


class _FixedReply:
    """Replies with the same text to every request, for testing ensure_state's
    check-before/check-after logic without depending on call order."""

    def __init__(self, text: str) -> None:
        self.text = text

    def request(self, method, url, **kwargs):
        return httpx.Response(200, text=self.text)


def test_already_satisfied_state_skips_setup(context, registry_with) -> None:
    registry = registry_with(_FixedReply("this text never appears"))
    report = prepare_states(["never.ready"], registry, context)
    assert report.ready is True
    assert report.outcomes[0].status == "already_satisfied"
    assert report.outcomes[0].ensured is False


def test_unsatisfied_state_blocks_readiness(context, registry_with) -> None:
    registry = registry_with(_FixedReply("nothing relevant"))
    report = prepare_states(["never.ready"], registry, context)
    assert report.ready is False
    assert report.outcomes[0].status == "unsatisfied"
    assert report.outcomes[0].ensured is True


def test_raises_for_an_undeclared_state(context, registry_with) -> None:
    registry = registry_with(_FixedReply(""))
    with pytest.raises(ValueError, match="does not provide it"):
        prepare_states(["nope"], registry, context)
