#!/usr/bin/env python3
"""
Broken-link guard for /home/supe/brain.

The ONE machine-enforceable link invariant: every internal entity reference must
resolve to a page that EXISTS. Link STYLE is not enforced — the gbrain engine
extracts edges from both markdown `[Name](path)` links and `[[wikilinks]]`, and
normalizes root- vs file-relative paths to the same target (verified in
gbrain/src/core/link-extraction.ts). So this checks resolution only, never style.

Catches:
  - markdown `[Name](dir/slug)` / `[Name](../dir/slug.md)` -> page must exist
  - prefixed wikilink `[[dir/slug]]`                       -> page must exist
  - bare wikilink `[[slug]]`                               -> some page basename must match

Usage:
  python3 brain_broken_links.py            # human report, exit 0
  python3 brain_broken_links.py --strict   # exit 1 if any broken (for hooks/CI)
  python3 brain_broken_links.py --files a.md b.md   # only scan these (pre-commit)
"""
import glob, re, os, sys

BRAIN = "/home/supe/brain"
# entity dirs the engine treats as link targets (mirror of DIR_PATTERN in link-extraction.ts)
DIRS = ("people","companies","meetings","concepts","deal","civic","project","projects",
        "source","media","yc","tech","finance","personal","openclaw","entities")
DIR_RE = "|".join(DIRS)

MD_RE   = re.compile(r'(?<!\!)\[[^\]]*\]\((?:\.\./)*((?:%s)/[^)\s#]+?)(?:\.md)?(?:#[^)]*)?\)' % DIR_RE)
WL_PREF = re.compile(r'\[\[((?:%s)/[^\]|#]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]' % DIR_RE)
WL_BARE = re.compile(r'\[\[([^\]|#/\n]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]')

def page_exists(slug):
    p = os.path.join(BRAIN, slug)
    return os.path.isfile(p) or os.path.isfile(p + ".md")

def build_basename_index():
    idx = set()
    for f in glob.glob(os.path.join(BRAIN, "**/*.md"), recursive=True):
        idx.add(os.path.splitext(os.path.basename(f))[0].lower())
    return idx

def scan(files=None):
    basenames = build_basename_index()
    targets = files or glob.glob(os.path.join(BRAIN, "**/*.md"), recursive=True)
    broken = []  # (relpath, kind, raw_target)
    for f in targets:
        f = f if os.path.isabs(f) else os.path.join(BRAIN, f)
        if not os.path.isfile(f) or "/sources/" in f:
            continue
        rel = os.path.relpath(f, BRAIN)
        txt = open(f, encoding="utf-8", errors="replace").read()
        for slug in MD_RE.findall(txt):
            if not page_exists(slug):
                broken.append((rel, "markdown", slug))
        for slug in WL_PREF.findall(txt):
            if not page_exists(slug):
                broken.append((rel, "wikilink", slug))
        # bare wikilinks: broken only if NO page anywhere shares the basename
        masked = WL_PREF.sub(" ", txt)
        for name in WL_BARE.findall(masked):
            if name.strip().lower() not in basenames:
                broken.append((rel, "wikilink-bare", name.strip()))
    # de-dup
    seen, out = set(), []
    for b in broken:
        if b not in seen:
            seen.add(b); out.append(b)
    return out

if __name__ == "__main__":
    strict = "--strict" in sys.argv
    files = None
    if "--files" in sys.argv:
        files = [a for a in sys.argv[sys.argv.index("--files")+1:] if not a.startswith("--")]
    broken = scan(files)
    # machine-readable summary line for cron grep
    print(f"BROKEN_LINKS: {len(broken)}")
    if broken:
        # group by missing target = "pages to create"
        from collections import defaultdict
        by_target = defaultdict(list)
        for rel, kind, slug in broken:
            by_target[slug].append(f"{rel} ({kind})")
        print(f"\n{len(by_target)} missing target(s):")
        for slug, refs in sorted(by_target.items()):
            print(f"  - {slug}")
            for r in refs:
                print(f"      <- {r}")
    sys.exit(1 if (strict and broken) else 0)
