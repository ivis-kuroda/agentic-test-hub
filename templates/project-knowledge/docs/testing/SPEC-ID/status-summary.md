# Status — <spec> (<build>), as of <YYYY-MM-DD>

- Source: `<results file>`; computed by `<command>` (no hand counts)
- Scope: <e.g. execution steps only; preparation excluded> — <n> steps

## 1. Per scenario

Verdict definitions:

- **ok**: all checks ok
- **partial-ok**: verdict ng, some checks ok
- **ng**: all checks ng
- **deferred(<reason>)**: <what is missing>
- **not_runnable**: cannot be reproduced without changing the SUT (decision 3)
- **not_issuable**: the SUT refuses to create the precondition

| Scenario | Steps | ok | partial-ok | ng | deferred(<r>) | not_runnable | not_issuable | Non-OK steps |
|---|--:|--:|--:|--:|--:|--:|--:|---|

## 2. Partial-OK and NG steps

### <step id> <title from the spec> (ok n / m)

#### <operation> (ng k checks) — <F-nn>

<expected vs observed; evidence path>

## 3. Deferred steps

### <step id> <title> — deferred(<reason>)

- Missing: <what>
- Unblock path: <who/what, cost, runnable now?>

## 4. Not runnable / not issuable

### <step id> <title>

- Reason: <why>, decision <N>
