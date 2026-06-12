#!/usr/bin/env python3
"""
Shadow-comparison HTML report generator.

Reads the JSONL log written by src/core/ai/shadow-compare.ts and renders a
single self-contained HTML file with a side-by-side view of the Anthropic
(runtime) answer against each shadow model's answer, so you can quickly judge
which output you prefer.

Usage:
    python scripts/shadow_report.py [INPUT.jsonl] [-o OUTPUT.html] [--open]

If INPUT is omitted, the newest shadow-compare-*.jsonl in ~/.gbrain (or
$GBRAIN_SHADOW_DIR) is used. If -o is omitted, the HTML is written next to this
script (the gbrain scripts/ dir), named after the input log.

No third-party dependencies — standard library only.
"""

from __future__ import annotations

import argparse
import glob
import html
import json
import os
import sys
import webbrowser
from pathlib import Path


def default_dir() -> Path:
    return Path(os.environ.get("GBRAIN_SHADOW_DIR", str(Path.home() / ".gbrain")))


def newest_log() -> Path | None:
    matches = sorted(
        glob.glob(str(default_dir() / "shadow-compare-*.jsonl")),
        key=os.path.getmtime,
        reverse=True,
    )
    return Path(matches[0]) if matches else None


def load_records(path: Path) -> list[dict]:
    records: list[dict] = []
    with path.open("r", encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, 1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                print(f"warn: skipping malformed line {line_no}: {exc}", file=sys.stderr)
    return records


def esc(value) -> str:
    if value is None:
        return ""
    return html.escape(str(value))


def render_usage(answer: dict) -> str:
    usage = answer.get("usage")
    stop = answer.get("stop_reason")
    bits = []
    if usage:
        bits.append(f"in {usage.get('input_tokens', 0)} / out {usage.get('output_tokens', 0)} tok")
    if stop:
        bits.append(f"stop={esc(stop)}")
    return " · ".join(bits)


def render_answer_card(answer: dict, *, is_real: bool, index: int) -> str:
    label = "ANTHROPIC — runtime" if is_real else f"SHADOW {index}"
    klass = "card real" if is_real else "card shadow"
    model = esc(answer.get("model", "?"))
    meta = render_usage(answer)
    error = answer.get("error")
    if error:
        body = f'<pre class="error">ERROR: {esc(error)}</pre>'
    else:
        text = answer.get("text") or "(no text content)"
        body = f'<pre>{esc(text)}</pre>'
    return f"""
      <div class="{klass}">
        <div class="card-head">
          <span class="badge">{esc(label)}</span>
          <code class="model">{model}</code>
          <span class="meta">{meta}</span>
        </div>
        {body}
      </div>"""


def render_prompt(prompt: dict) -> str:
    parts = []
    system = prompt.get("system")
    if system:
        parts.append(f'<div class="msg system"><span class="role">SYSTEM</span><pre>{esc(system)}</pre></div>')
    for msg in prompt.get("messages", []):
        role = esc(msg.get("role", "?")).upper()
        content = esc(msg.get("content", ""))
        parts.append(f'<div class="msg"><span class="role">{role}</span><pre>{content}</pre></div>')
    return "\n".join(parts)


def render_record(record: dict, idx: int) -> str:
    ts = esc(record.get("timestamp", ""))
    requested = esc(record.get("requested_model", "?"))
    tier = esc(record.get("tier", "?"))
    prompt_html = render_prompt(record.get("prompt", {}))

    cards = [render_answer_card(record.get("anthropic", {}), is_real=True, index=0)]
    for i, shadow in enumerate(record.get("shadows", []), 1):
        cards.append(render_answer_card(shadow, is_real=False, index=i))

    cols = len(cards)
    return f"""
    <section class="record" data-tier="{tier}">
      <header class="record-head" onclick="this.parentElement.classList.toggle('collapsed')">
        <span class="idx">#{idx}</span>
        <span class="ts">{ts}</span>
        <span class="pill tier-{tier}">{tier}</span>
        <code class="req">{requested}</code>
        <span class="spacer"></span>
        <span class="toggle">▾</span>
      </header>
      <div class="record-body">
        <details class="prompt-wrap">
          <summary>Prompt ({len(record.get('prompt', {}).get('messages', []))} message(s))</summary>
          <div class="prompt">{prompt_html}</div>
        </details>
        <div class="cards" style="--cols:{cols}">
          {''.join(cards)}
        </div>
      </div>
    </section>"""


def build_html(records: list[dict], source: Path) -> str:
    tiers = sorted({r.get("tier", "?") for r in records})
    tier_buttons = "".join(
        f'<button class="filter" data-tier="{esc(t)}">{esc(t)}</button>' for t in tiers
    )
    body = "\n".join(render_record(r, i) for i, r in enumerate(records, 1))

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>gbrain shadow comparison — {esc(source.name)}</title>
<style>
  :root {{
    --bg: #0d1117; --panel: #161b22; --border: #30363d; --text: #e6edf3;
    --muted: #8b949e; --real: #2ea043; --shadow: #4493f8; --error: #f85149;
    --code-bg: #0a0e14;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }}
  header.top {{
    position: sticky; top: 0; z-index: 10; background: var(--panel);
    border-bottom: 1px solid var(--border); padding: 14px 20px;
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  }}
  header.top h1 {{ font-size: 16px; margin: 0; font-weight: 600; }}
  header.top .src {{ color: var(--muted); font-size: 12px; }}
  .filters {{ display: flex; gap: 8px; margin-left: auto; }}
  .filter {{
    background: var(--bg); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 4px 12px; cursor: pointer; font-size: 12px;
  }}
  .filter.active {{ background: var(--shadow); border-color: var(--shadow); color: #fff; }}
  main {{ padding: 20px; max-width: 1600px; margin: 0 auto; }}
  .record {{
    background: var(--panel); border: 1px solid var(--border);
    border-radius: 10px; margin-bottom: 18px; overflow: hidden;
  }}
  .record-head {{
    display: flex; align-items: center; gap: 12px; padding: 12px 16px;
    cursor: pointer; user-select: none; border-bottom: 1px solid var(--border);
  }}
  .record.collapsed .record-body {{ display: none; }}
  .record.collapsed .toggle {{ transform: rotate(-90deg); }}
  .toggle {{ transition: transform .15s; color: var(--muted); }}
  .idx {{ color: var(--muted); font-variant-numeric: tabular-nums; }}
  .ts {{ color: var(--muted); font-size: 12px; }}
  .req {{ color: var(--text); font-size: 12px; }}
  .spacer {{ flex: 1; }}
  .pill {{
    font-size: 11px; padding: 2px 9px; border-radius: 999px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .03em;
  }}
  .tier-sonnet {{ background: rgba(46,160,67,.18); color: #6fd585; }}
  .tier-haiku {{ background: rgba(68,147,248,.18); color: #79b8ff; }}
  .record-body {{ padding: 16px; }}
  .prompt-wrap {{ margin-bottom: 16px; }}
  .prompt-wrap summary {{
    cursor: pointer; color: var(--muted); font-size: 12px; padding: 6px 0;
  }}
  .prompt {{
    margin-top: 8px; border: 1px solid var(--border); border-radius: 8px;
    padding: 12px; background: var(--code-bg);
  }}
  .msg {{ margin-bottom: 10px; }}
  .msg:last-child {{ margin-bottom: 0; }}
  .role {{
    display: inline-block; font-size: 10px; font-weight: 700; color: var(--muted);
    letter-spacing: .06em; margin-bottom: 4px;
  }}
  .cards {{
    display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
    gap: 14px;
  }}
  @media (max-width: 900px) {{ .cards {{ grid-template-columns: 1fr; }} }}
  .card {{
    border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
    background: var(--bg); display: flex; flex-direction: column;
  }}
  .card.real {{ border-color: var(--real); }}
  .card.shadow {{ border-color: var(--shadow); }}
  .card-head {{
    display: flex; align-items: center; gap: 8px; padding: 8px 12px;
    border-bottom: 1px solid var(--border); flex-wrap: wrap;
  }}
  .badge {{ font-size: 10px; font-weight: 700; letter-spacing: .04em; }}
  .card.real .badge {{ color: var(--real); }}
  .card.shadow .badge {{ color: var(--shadow); }}
  .card .model {{ font-size: 11px; color: var(--text); }}
  .card .meta {{ font-size: 11px; color: var(--muted); margin-left: auto; }}
  pre {{
    margin: 0; padding: 12px; white-space: pre-wrap; word-wrap: break-word;
    font: 12.5px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    overflow-x: auto; flex: 1;
  }}
  pre.error {{ color: var(--error); }}
  .empty {{ color: var(--muted); padding: 40px; text-align: center; }}
</style>
</head>
<body>
  <header class="top">
    <h1>gbrain shadow comparison</h1>
    <span class="src">{esc(source)} · {len(records)} call(s)</span>
    <div class="filters">
      <button class="filter active" data-tier="all">all</button>
      {tier_buttons}
    </div>
  </header>
  <main>
    {body if records else '<div class="empty">No comparison records found.</div>'}
  </main>
<script>
  const buttons = document.querySelectorAll('.filter');
  buttons.forEach(btn => btn.addEventListener('click', () => {{
    buttons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const want = btn.dataset.tier;
    document.querySelectorAll('.record').forEach(rec => {{
      rec.style.display = (want === 'all' || rec.dataset.tier === want) ? '' : 'none';
    }});
  }}));
</script>
</body>
</html>"""


def main() -> int:
    parser = argparse.ArgumentParser(description="Render gbrain shadow-comparison JSONL into HTML.")
    parser.add_argument("input", nargs="?", help="Path to shadow-compare-*.jsonl (default: newest in ~/.gbrain)")
    parser.add_argument("-o", "--output", help="Output HTML path (default: alongside this script)")
    parser.add_argument("--open", action="store_true", help="Open the HTML in a browser when done")
    parser.add_argument(
        "--since-minutes",
        type=float,
        default=None,
        help="Only include records whose timestamp is within the last N minutes (default: all)",
    )
    args = parser.parse_args()

    if args.input:
        src = Path(args.input)
    else:
        src = newest_log()
        if src is None:
            print(f"error: no shadow-compare-*.jsonl found in {default_dir()}", file=sys.stderr)
            return 1

    if not src.exists():
        print(f"error: input not found: {src}", file=sys.stderr)
        return 1

    records = load_records(src)

    if args.since_minutes is not None:
        from datetime import datetime, timezone, timedelta

        cutoff = datetime.now(timezone.utc) - timedelta(minutes=args.since_minutes)

        def _within(rec: dict) -> bool:
            raw = rec.get("timestamp")
            if not raw:
                return False
            try:
                ts = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            except ValueError:
                return False
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            return ts >= cutoff

        before = len(records)
        records = [r for r in records if _within(r)]
        print(f"filtered to last {args.since_minutes:g} min: {len(records)}/{before} record(s)")

    # Default output lands next to this script (the gbrain scripts/ dir), not next
    # to the input log in ~/.gbrain — predictable location regardless of cwd.
    if args.output:
        out = Path(args.output)
    else:
        out = Path(__file__).resolve().parent / f"{src.stem}.html"
    out.write_text(build_html(records, src), encoding="utf-8")
    print(f"wrote {out} ({len(records)} record(s))")

    if args.open:
        webbrowser.open(out.resolve().as_uri())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
