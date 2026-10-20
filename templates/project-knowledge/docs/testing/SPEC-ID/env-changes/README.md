# Changes made to the running SUT (test environment log)

Every change an agent makes to the running SUT (data, settings, services,
injected faults) is recorded here, newest last, with its restore proof.
Environment: `<repo> <branch>`, <how it was installed>.

Foreign edits found with `git status` (changes nobody in this campaign made)
are recorded too, and left alone unless the owner decides otherwise.

| Date | Change | How | Why (step) | Revert / proof |
|---|---|---|---|---|
| <YYYY-MM-DD> | <what changed, ids, before → after> | <UI / API / config guard / helper> | <step id or exploration> | <reverted: proof command and output; or kept on purpose: decision N> |
