#!/usr/bin/env node
/**
 * A control command for the demo service.
 *
 * Exists so the hub's `shell` executor has something real to run. Real
 * targets are administered through commands like this, and a plugin that
 * could only make HTTP requests would not resemble one.
 *
 * Usage: `democtl <count|drain> --url <address>`
 */
const [command, ...rest] = process.argv.slice(2);

function optionValue(name: string): string | undefined {
  const index = rest.indexOf(`--${name}`);
  return index === -1 ? undefined : rest[index + 1];
}

const url = optionValue("url") ?? process.env["DEMO_URL"];
if (url === undefined) {
  process.stderr.write("democtl: --url or DEMO_URL is required\n");
  process.exit(2);
}

/** Exit codes, chosen so a caller can tell refusal from breakage. */
const EXIT = { ok: 0, refused: 1, misuse: 2 } as const;

try {
  if (command === "count") {
    const response = await fetch(`${url}/notifications`);
    const body = (await response.json()) as { notifications: unknown[] };
    process.stdout.write(`${body.notifications.length}\n`);
    process.exit(EXIT.ok);
  }

  if (command === "drain") {
    const response = await fetch(`${url}/notifications`, { method: "DELETE" });
    const body = (await response.json()) as { removed: number };
    process.stdout.write(`drained ${body.removed} notification(s)\n`);
    process.exit(EXIT.ok);
  }

  process.stderr.write(`democtl: unknown command ${command ?? "(none)"}\n`);
  process.exit(EXIT.misuse);
} catch (cause) {
  process.stderr.write(`democtl: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(EXIT.refused);
}
