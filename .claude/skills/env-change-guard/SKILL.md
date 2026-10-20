---
name: env-change-guard
description: Change the running system under test for a test step — a server setting, a container/service state, injected data or faults — through backup, apply, verify, restore in finally, verify again, and log; with recipes for a config-file render-and-restart setting and for stopping/starting a service with health probes. Use whenever a step needs a setting with no admin screen, a stopped dependency, or a data-level mock. Not for settings changed through admin screens as part of the spec's own procedure (drive those with the screen procedures) and never for changing SUT source code.
---

# Guarding a change to the SUT

Every change to the running SUT has a restore, and every restore has proof.
A "restored" claim without a query once hid leftover objects for days.

Until EXPRESSIVENESS-GAPS G7 (`restore` block) lands, a plugin may carry its
own implementation of this guard; give it the shape below so it maps onto G7.

## The contract

```python
@contextlib.contextmanager
def restoring(name, *, preflight, backup, apply, verify_applied, restore, verify_restored, ev):
    preflight()                         # clean starting state, else refuse (do not "fix" it)
    saved = backup()                    # copy/dump outside the repo; record path and "before" values
    ev.note(f"{name}: before", saved.summary())
    try:
        apply()
        verify_applied()                # the change is in effect (read the effective value)
        ev.text(f"{name}: changed", ...)
        yield
    finally:
        restore(saved)
        ok, proof = verify_restored(saved)   # byte-clean file, same values, healthy, rows gone
        ev.text(f"{name}: restored", proof)
        if not ok:
            raise RestoreError(proof)   # stops the run; reported to the owner first
```

Rules:

- **Preflight refuses a dirty start** (`git status --short <file>` not empty,
  service already down, leftover injected rows). Report it; do not clean up
  someone else's change.
- **Backup outside the repository**, timestamped, path recorded in evidence.
- Verify the **effective** value (what the running process uses), not just
  the file.
- Restore in `finally`, also on test failure and on exceptions.
- Log every change in the project's `env-changes/README.md`: date, change, how,
  why (step), revert status with proof. Changes kept on purpose (owner
  decision) say so and name the decision.
- Never overlap a restart with a running test step; you are the only SUT
  client.
- A restore failure ends the block: report first, change nothing else.

## Recipe: config file + render + restart

For settings without an admin screen, owned by a tracked template file:

1. Preflight: `git -C <sut> status --short <config file>` prints nothing.
2. Backup: copy the file to the run directory.
3. Read the effective values with a read-only script in the app process.
4. Apply: append marked lines (`# ATH-TEST <date>`) or edit one key.
5. Render where the template's inputs live (often inside the container), then
   restart the service(s) that read it — including workers that read config
   only at start.
6. Wait until the app answers (poll a cheap URL for 200/30x), then verify the
   effective values.
7. Finally: copy the backup back; `git status --short` empty; render;
   restart; wait; effective values equal "before".

Editing such a file is a configuration change, not a source change, only if
the decision log says so.

## Recipe: stop/start a service

1. Preflight: all services up (compose `ps` lists the expected set).
2. Stop the one service; verify it is down and the dependency failure is
   visible (a probe fails the expected way).
3. Run the step.
4. Finally: start it; wait with **health probes per dependency** (DB accepts
   a query, cache answers ping, search answers cluster health, app answers a
   real request) with a deadline; record the time each took.
5. Verify the full service set is up again. Note collateral restarts (one
   service's restart may restart its dependants).

## Recipe: data-level fault/mock

1. Preflight: the fault catalogue is empty (no leftover triggers/rows).
2. Apply through the project's helper, never ad hoc SQL in the step.
3. Finally: remove; verify the catalogue is empty again.
4. A mock that cannot be reproduced by data, config or environment changes is
   `not_runnable` with the reason — never a source patch.

## Heavy or destructive changes

Before them: a backup **validated** (e.g. list the dump and count tables),
resources checked, only one heavy job on the host, the other stack down. After
them: compare the restored state with the backup's counts.
