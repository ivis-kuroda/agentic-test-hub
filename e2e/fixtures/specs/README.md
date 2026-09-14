# Fixture specs for the hub self-test

`e2e/support/start-hub.ts` copies this directory into a fresh temporary
`SPECS_ROOT` before starting `apps/hub` for a test file, so the hub
self-test suite (`e2e/plugin.yaml`, `e2e/specs/`) never reads or writes the
real `examples/demo-app/specs/` or its own `e2e/specs/`.

Empty for now — populated with whatever pre-existing entities (a baseline,
say) the `HUB` cases in `e2e/specs/` actually need once they are written.
