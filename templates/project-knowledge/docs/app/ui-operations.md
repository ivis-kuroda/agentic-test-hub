# <SUT> screen operations (selector registry)

Every entry is **UNVERIFIED** (read from templates/scripts, with file:line)
until an explorer saw it work on the live SUT and the orchestrator marked it
`VERIFIED <YYYY-MM-DD>`. Procedures may use VERIFIED entries only.

Conventions: `BASE=<base url>`; <TLS: ignore HTTPS errors?>; blocked hosts:
<list>; default timeout <ms>; one browser context / agent-browser session per
user.

## Known gotchas (cross-screen)

| Gotcha | Where | Handling | Mark |
|---|---|---|---|
| <e.g. page waits on an unreachable host> | all pages | block `<glob>` | VERIFIED <date> |

---

## 1. <Screen or flow name> — `<path>`

- Status: UNVERIFIED (source: `<file>:<line>`)
- Purpose: <what the test uses it for>

| Operation | Selector | Wait / gate | Post-condition | Mark |
|---|---|---|---|---|
| <open> | `<path>` | <ready marker> | <element visible> | UNVERIFIED |
| <fill X> | `<selector>` | — | `.value` read back | UNVERIFIED |
| <submit> | `<selector>` | <async validation done> | <URL / message> | UNVERIFIED |

Measured timings: <what = min/median/max (n, method, date)>.
Notes: <quirks specific to this screen>.
