/**
 * The reviewer view's stylesheet, inlined into the page it decorates.
 *
 * Kept as one constant rather than a file the page links to, because the
 * output is a single self-contained HTML file: something that can be opened
 * from a filesystem, emailed, or dropped into a ticket, with nothing else to
 * carry alongside it.
 */
export const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #6b6b6b;
  --border: #e2e2e2;
  --surface: #f7f7f7;
  --covered: #1b7a3d;
  --covered-bg: #e6f4ea;
  --excluded: #6b6b6b;
  --excluded-bg: #f0f0f0;
  --gap: #b3261e;
  --gap-bg: #fce8e6;
  --risk-high: #b3261e;
  --risk-medium: #9a6700;
  --risk-low: #3b6b3b;
  --link: #0552b5;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14161a;
    --fg: #e8e8e8;
    --muted: #9a9a9a;
    --border: #2c2f36;
    --surface: #1c1f26;
    --covered: #5fd889;
    --covered-bg: #123420;
    --excluded: #9a9a9a;
    --excluded-bg: #23262d;
    --gap: #ff8a80;
    --gap-bg: #3a1a18;
    --risk-high: #ff8a80;
    --risk-medium: #ffca6b;
    --risk-low: #8fd39b;
    --link: #7db8ff;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2rem clamp(1rem, 4vw, 3rem);
  background: var(--bg);
  color: var(--fg);
  font: 15px/1.6 -apple-system, "Segoe UI", "Hiragino Kaku Gothic ProN", sans-serif;
}
h1, h2, h3 { line-height: 1.3; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
h2 { font-size: 1.2rem; margin: 2.5rem 0 1rem; border-bottom: 1px solid var(--border); padding-bottom: .4rem; }
h3 { font-size: 1rem; margin: 0 0 .3rem; }
.subtitle { color: var(--muted); margin: 0 0 2rem; }
.stats { display: flex; flex-wrap: wrap; gap: .75rem; margin: 1rem 0 2rem; }
.stat {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: .6rem 1rem;
  min-width: 7rem;
}
.stat .n { font-size: 1.4rem; font-weight: 600; display: block; }
.stat .label { color: var(--muted); font-size: .8rem; }
.stat.gap { border-color: var(--gap); }
.stat.gap .n { color: var(--gap); }
.viewpoint {
  border: 1px solid var(--border);
  border-left: 4px solid var(--border);
  border-radius: 6px;
  padding: .9rem 1.1rem;
  margin-bottom: .75rem;
}
.viewpoint.risk-high { border-left-color: var(--risk-high); }
.viewpoint.risk-medium { border-left-color: var(--risk-medium); }
.viewpoint.risk-low { border-left-color: var(--risk-low); }
.viewpoint.uncovered { background: var(--gap-bg); }
.badge {
  display: inline-block;
  font-size: .72rem;
  font-weight: 600;
  padding: .1rem .5rem;
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: .02em;
}
.badge.risk-high { color: var(--risk-high); background: var(--gap-bg); }
.badge.risk-medium { color: var(--risk-medium); background: var(--surface); }
.badge.risk-low { color: var(--risk-low); background: var(--covered-bg); }
.badge.uncovered { color: var(--gap); background: var(--gap-bg); }
.viewpoint .rationale { margin: .4rem 0; }
.source-list, .ref-list { list-style: none; padding: 0; margin: .4rem 0 0; font-size: .85rem; color: var(--muted); }
.source-list li, .ref-list li { padding: .1rem 0; }
.source-list code, .ref-list code { color: var(--fg); }
.coverage-line { margin-top: .5rem; font-size: .85rem; }
.coverage-line .n { font-weight: 600; }
table.matrix { border-collapse: collapse; margin: 1rem 0; }
table.matrix caption { caption-side: top; text-align: left; font-weight: 600; margin-bottom: .5rem; }
table.matrix th, table.matrix td {
  border: 1px solid var(--border);
  padding: .5rem .7rem;
  text-align: center;
  vertical-align: middle;
  font-size: .85rem;
}
table.matrix th { background: var(--surface); font-weight: 600; }
table.matrix th.corner { background: transparent; border: none; }
td.cell { min-width: 5rem; }
td.cell.covered { background: var(--covered-bg); color: var(--covered); }
td.cell.excluded { background: var(--excluded-bg); color: var(--excluded); }
td.cell.gap { background: var(--gap-bg); color: var(--gap); font-weight: 600; }
td.cell .count { display: block; font-size: .78rem; }
.matrix-notes { font-size: .82rem; color: var(--muted); margin-top: .3rem; }
.matrix-notes summary { cursor: pointer; }
.legend { display: flex; gap: 1.2rem; font-size: .8rem; color: var(--muted); margin: .5rem 0 1rem; flex-wrap: wrap; }
.legend .swatch { display: inline-block; width: .8rem; height: .8rem; border-radius: 2px; margin-right: .35rem; vertical-align: -1px; }
.legend .swatch.covered { background: var(--covered-bg); border: 1px solid var(--covered); }
.legend .swatch.excluded { background: var(--excluded-bg); border: 1px solid var(--excluded); }
.legend .swatch.gap { background: var(--gap-bg); border: 1px solid var(--gap); }
.empty { color: var(--muted); font-style: italic; }
a { color: var(--link); }
footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: .8rem; }
`;
