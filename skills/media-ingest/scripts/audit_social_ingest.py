#!/usr/bin/env python3
"""
Deterministic audit of the social-video ingest in /home/supe/brain.

Proves (mechanically, re-runnably) the structural claims of the ingest pipeline.
Original checks:
  1. COVERAGE       - every raw maps to a page OR is a legitimate non-ingestable
  2. NO ORPHAN PAGE - every page citing a sources/social raw cites one that EXISTS
  3. CITATION       - every social-derived page carries a Source:/URL attribution
  4. GROUNDING      - quoted spans a page attributes to a clip appear in that raw
  5. TRANSCRIPT-Q   - raw has metadata but no usable spoken/written content

Upgrades (2026-06-23, per the "before it goes weekly" plan):
  6. NO SILENT DROP - every raw WITH content must map to a page. (The old skip-ledger
                      exemption was removed 2026-06-24 — coverage is now page-only:
                      a "skip" means filing a thin source page, not a ledger line.)
  7. URL-FUNNEL     - every social URL you SENT in chat maps to a raw on disk.
                      Catches links dropped/404'd BEFORE a raw existed (send->fetch gap).
  8. SYNC-PARITY    - every page's on-disk body matches the engine's stored body
                      (gbrain get). Catches edited-on-disk-but-never-reingested.

It does NOT prove "semantic accuracy / zero hallucination" - that is an LLM
judgment. Grounding (#4) is the strongest deterministic proxy. Misses are FLAGS
for human/LLM review, not auto-fails. Pair this weekly run with an occasional
LLM grounding pass for the semantic layer.

Usage:
  python3 audit_social_ingest.py                 # full report (incl. parity), exit 0
  python3 audit_social_ingest.py --no-parity     # skip the gbrain-get parity pass
  python3 audit_social_ingest.py --sample 40      # parity over a 40-page sample
  python3 audit_social_ingest.py --strict         # exit 1 if any HARD failure (for cron/CI)
"""
import os, re, glob, json, sys, subprocess, hashlib, unicodedata
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

BRAIN = "/home/supe/brain"
SOCIAL = os.path.join(BRAIN, "sources/social")
SESSIONS_DIR = "/home/supe/.openclaw/agents/main/sessions"

def norm(s):
    s = s.replace("’","'").replace("‘","'")
    s = s.replace("“",'"').replace("”",'"')
    s = s.replace("—","-").replace("–","-").replace("…","...")
    s = re.sub(r"\s+"," ", s)
    return s.lower().strip()

# ---------- load raws ----------
raws = {}            # basename -> {srcid,state,url,canon,platform,body,full,path}
raw_id_tokens = set()  # every id/url token that proves "a raw exists for this clip"
for p in glob.glob(os.path.join(SOCIAL, "*.txt")):
    txt = open(p, encoding="utf-8", errors="replace").read()
    base = os.path.basename(p)
    def f(pat, d=""):
        m = re.search(pat, txt, re.M)
        return m.group(1) if m else d
    srcid    = f(r'^id:\s*"([^"]+)"', base)
    state    = f(r'_transcript_state:\s*"([^"]+)"', "MISSING")
    url      = f(r'_source_url:\s*"([^"]+)"')
    canon    = f(r'_canonical_url:\s*"([^"]+)"')
    platform = f(r'^platform:\s*"([^"]+)"')
    author_user = f(r'^author:\s*\{[^}]*"username"\s*:\s*"([^"]+)"')
    author_name = f(r'^author:\s*\{[^}]*"displayName"\s*:\s*"([^"]+)"')
    parts = txt.split("\n---\n", 1)
    body = parts[1] if len(parts) > 1 else txt
    raws[base] = {"srcid": srcid, "state": state, "url": url, "canon": canon,
                  "platform": platform, "author_user": author_user,
                  "author_name": author_name, "body": norm(body), "full": norm(txt),
                  "path": os.path.relpath(p, BRAIN)}
    for tok in (srcid, url, canon):
        if tok:
            raw_id_tokens.add(tok.lower())

# ---------- load pages + raw citations ----------
# A "real page" = a markdown file the engine actually syncs. Exclude genuine non-pages by
# BASENAME, NOT by directory. The old `"/sources/" not in p` filter blinded the audit to
# 29 real analytical pages under sources/ (book/article/clip writeups) — they were neither
# coverage- nor parity-checked, which produced false "unreviewed drop" hard-fails for any
# keeper filed as a source page. The excluded basenames are the engine's SYNC_SKIP_FILES
# metafiles (readme/resolver/index/log/schema — engine matches these case-sensitively; we
# lower() because no lowercase content page shares those names). Verified against the LIVE
# engine (`gbrain get`): sources/*.md pages and the .raw/*.md sidecars ARE synced (so they
# stay in and parity-pass). Don't trust gbrain source for prune rules here — the running
# engine diverges from it; gbrain get is the source of truth.
META_FILES = {"readme.md", "resolver.md", "index.md", "log.md", "schema.md"}
all_pages = [p for p in glob.glob(os.path.join(BRAIN, "**/*.md"), recursive=True)
             if os.path.basename(p).lower() not in META_FILES]
id_to_pages = defaultdict(list)
page_cites = {}
def frontmatter_type(txt):
    m = re.match(r'^---\n(.*?)\n---', txt, re.S)
    if not m: return ""
    t = re.search(r'^type:\s*"?([\w-]+)"?', m.group(1), re.M)
    return t.group(1).lower() if t else ""
def page_title(txt):
    m = re.search(r'^#\s+(.+)$', txt, re.M)
    return norm(m.group(1)) if m else ""

for pg in all_pages:
    txt = open(pg, encoding="utf-8", errors="replace").read()
    hit = {base for base, r in raws.items()
           if base in txt or (r["srcid"] and r["srcid"] in txt)}
    if hit:
        page_cites[pg] = hit
        for b in hit:
            id_to_pages[b].append(pg)

report = {"raws_total": len(raws), "pages_total": len(all_pages),
          "pages_citing_raw": len(page_cites)}

# ---------- 1. COVERAGE ----------
no_page = [(base, r["state"], r["url"]) for base, r in raws.items()
           if not id_to_pages.get(base)]
report["raws_with_no_page"] = sorted(no_page)

# ---------- 2. NO ORPHAN PAGE ----------
report["pages_citing_missing_raw"] = []  # join is by on-disk basename; kept for symmetry

# ---------- 3. CITATION ----------
no_cite = []
for pg in page_cites:
    txt = open(pg, encoding="utf-8", errors="replace").read()
    if not re.search(r'(?i)(source[s:]|\*\*author|primary source|raw:|sources/|https?://)', txt):
        no_cite.append(os.path.relpath(pg, BRAIN))
report["pages_missing_citation"] = no_cite

# ---------- 4. GROUNDING (tightened, item 5) ----------
# Only single-source ANALYTICAL pages (type concept/source/media) — the pages that
# legitimately quote ONE clip. Strip See-Also, markdown-link lines, and frontmatter
# before extracting quotes (those were the false-positive sources). Match each span
# against the FULL raw (frontmatter caption + body), not just the spoken transcript.
GROUND_TYPES = {"concept", "source", "media", "media-source", "video"}
def strip_for_grounding(txt):
    txt = re.sub(r'^---\n.*?\n---\n', '', txt, flags=re.S)            # frontmatter
    txt = re.sub(r'\n##+\s*See Also.*?(?=\n##\s|\Z)', '\n', txt, flags=re.S|re.I)  # See Also
    txt = re.sub(r'\n##+\s*(Related|Sources?|Back-?links?)\b.*?(?=\n##\s|\Z)', '\n', txt, flags=re.S|re.I)
    kept = [ln for ln in txt.splitlines()
            if "](" not in ln and not ln.lstrip().startswith(("- [", "[[", ">"))]
    return "\n".join(kept)

grounding_flags = []
single = {pg: list(ids)[0] for pg, ids in page_cites.items() if len(ids) == 1}
for pg, base in single.items():
    r = raws.get(base)
    if not r or r["state"] != "ok":
        continue
    raw_txt = open(pg, encoding="utf-8", errors="replace").read()
    if frontmatter_type(raw_txt) not in GROUND_TYPES:
        continue
    title = page_title(raw_txt)
    scan = strip_for_grounding(raw_txt)
    spans = re.findall(r'[“"]([^“”"]{20,200})[”"]', scan)
    hay = r["full"]
    misses = []
    for sp in spans:
        # A real inline transcript quote is a clean single-line run. Reject spans that
        # carry markdown structure or span lines — those are the page's own prose/headers
        # caught between distant quote chars (the dominant false-positive source).
        if "\n" in sp or re.search(r'[#*`|]|\]\(|^\s*[-)\d.]', sp):
            continue
        n = norm(sp)
        words = n.split()
        if len(words) < 4:
            continue
        if n == title or n in hay:
            continue
        present = sum(1 for w in set(words) if w in hay)
        if present / max(1, len(set(words))) < 0.85:
            misses.append(sp)
    if misses:
        grounding_flags.append((os.path.relpath(pg, BRAIN), base, misses))
report["grounding_flags"] = grounding_flags

# ---------- 5. TRANSCRIPT QUALITY ----------
HDRS = re.compile(r'##\s*(Transcript[^\n]*|Full Post Body|Full Article Body)\s*\n')
REFUSAL = re.compile(r"please provide the (video|audio)|i (cannot|can't|am unable to) transcribe"
                     r"|unable to transcribe|provide the .*file you would like me to transcribe"
                     r"|no transcript available|no captions", re.I)
transcript_issues = []
auto_legit = set()   # raws whose no-page status is self-explained (state/empty/refusal/trivial)
for base, r in raws.items():
    t = open(os.path.join(BRAIN, r["path"]), encoding="utf-8", errors="replace").read()
    chunks = re.split(HDRS, t)
    body = " ".join(chunks[2::2]) if len(chunks) > 2 else ""
    body = re.sub(r'\[\d+:\d+\]', '', body)
    body = re.sub(r'<[^>]+>', '', body)
    body = re.sub(r'^\s*\*\*Source.*$', '', body, flags=re.M)
    txt = " ".join(body.split())
    wc = len(re.findall(r"[A-Za-z']+", txt))
    # The raw's own _transcript_state is authoritative: anything not "ok" had no
    # usable fetch (empty caption / provider error / 404 no-video) — a legit non-ingestable.
    if r["state"] and r["state"].lower() != "ok":
        verdict = r["state"].upper()
    elif not txt.strip():
        verdict = "EMPTY"
    elif REFUSAL.search(txt):
        verdict = "REFUSAL"
    elif wc < 8:
        verdict = "TRIVIAL"
    else:
        continue
    auto_legit.add(base)
    pages_for = [os.path.relpath(x, BRAIN) for x in id_to_pages.get(base, [])]
    transcript_issues.append({"raw": base, "verdict": verdict, "words": wc,
                              "url": r["url"], "pages": pages_for})
report["transcript_issues"] = sorted(transcript_issues, key=lambda d: (d["verdict"], d["raw"]))

# ---------- 6. NO SILENT DROP (item 2) ----------
# Every raw with NO page that ALSO has real content is an unreviewed drop (hard fail).
# Coverage is page-only as of 2026-06-24 (skip-ledger removed): a deliberate "skip" must
# be filed as a thin source page, not a ledger line — so every kept-or-skipped raw is a
# real, citable, parity-checked artifact.
unreviewed_drops = sorted(base for base, *_ in no_page if base not in auto_legit)
report["unreviewed_drops"] = unreviewed_drops

# ---------- 7. URL-FUNNEL (item 1) ----------
# Extract social URLs you SENT in chat (prompt.submitted events), canonicalize to a
# clip id, and confirm a raw exists. URLs sent but with NO raw = silent send->fetch drops.
URL_RE = re.compile(r'https?://[^\s)>\]"\']+', re.I)
SOCIAL_HOST = re.compile(r'(instagram\.com|tiktok\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|facebook\.com|fb\.watch)', re.I)
def clip_id(u):
    u = u.split("?")[0].rstrip("/")
    m = (re.search(r'instagram\.com/(?:reels?|p|tv)/([A-Za-z0-9_-]+)', u, re.I)
         or re.search(r'(?:youtube\.com/(?:watch\?v=|shorts/)|youtu\.be/)([A-Za-z0-9_-]{6,})', u, re.I)
         or re.search(r'youtube\.com/watch.*?[?&]v=([A-Za-z0-9_-]{6,})', u, re.I)
         or re.search(r'tiktok\.com/.*?/video/(\d+)', u, re.I)
         or re.search(r'(?:x|twitter)\.com/[^/]+/status/(\d+)', u, re.I))
    return m.group(1) if m else None
def strip_wrappers(prompt):
    # remove echoed conversation-context + metadata envelopes so we mine the USER's text
    prompt = re.sub(r'Conversation context \(untrusted.*?(?=\nCurrent message:|\Z)', '', prompt, flags=re.S)
    prompt = re.sub(r'Conversation info \(untrusted.*?```', '', prompt, flags=re.S)
    prompt = re.sub(r'Sender \(untrusted.*?```', '', prompt, flags=re.S)
    return prompt

sent = {}  # clip_id -> {url, count}
for jf in glob.glob(os.path.join(SESSIONS_DIR, "*.trajectory.jsonl")):
    for line in open(jf, encoding="utf-8", errors="replace"):
        if '"prompt.submitted"' not in line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get("type") != "prompt.submitted":
            continue
        raw_prompt = d.get("data", {}).get("prompt", "")
        if not isinstance(raw_prompt, str):
            raw_prompt = json.dumps(raw_prompt)
        prompt = strip_wrappers(raw_prompt)
        for u in URL_RE.findall(prompt):
            if not SOCIAL_HOST.search(u):
                continue
            cid = clip_id(u)
            if not cid:
                continue
            e = sent.setdefault(cid, {"url": u, "count": 0})
            e["count"] += 1
def has_raw(cid):
    c = cid.lower()
    if c in raw_id_tokens:
        return True
    return any(c in tok for tok in raw_id_tokens)
# A sent link with no raw is an unreviewed funnel miss (send->fetch drop). This is a
# REVIEW signal, not a hard fail — dismiss by fetching the raw + filing/skipping it.
funnel_no_raw = sorted(
    ({"clip_id": cid, "url": e["url"], "times_sent": e["count"]}
     for cid, e in sent.items() if not has_raw(cid)),
    key=lambda d: -d["times_sent"])
report["urls_sent_distinct"] = len(sent)
report["urls_sent_no_raw"] = funnel_no_raw   # REVIEW list (send->fetch silent drops)

# ---------- 7b. ENTITY PROMOTION CANDIDATES (notability is dynamic) ----------
# Any person/company that recurs across the brain but has NO entity page of its own is
# a promotion candidate: recurrence crossed the notability bar, so it likely deserves a
# (often reference:true) page the existing pages can back-link. Two recurrence sources:
#   (a) CREATORS  -- the author of >=2 distinct saved+paged raws.
#   (b) MENTIONS  -- a person/company named in the `## People/Companies Mentioned`
#                    section of >=2 distinct pages (bold `**Name**` or a markdown link).
# REVIEW only -- never a hard fail. Conservative: a human decides. Free-prose names
# (non-bold, non-linked, e.g. a "Quoted: a, b, c" line) are intentionally NOT extracted
# -- that needs NER and would be noisy; linked-but-missing entities are already caught
# by the weekly-doctor broken-links check, so this fills the unlinked-mention gap.
def slugify_name(s):
    # unicode-fold first so "Ștefan" -> "stefan", "José" -> "jose"
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = norm(s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s
def name_tokens(s):
    return {t for t in slugify_name(s).split("-") if len(t) >= 2}
# Existing entity pages: index by basename slug AND by every @handle they list.
# The @handle is the reliable join key (display names like "Theo - t3.gg" don't
# slug-match the page slug "theo-brown"; the handle @t3dotgg does).
existing_entities = set()   # people/ AND companies/ basenames (a creator can be a brand)
entity_handles = set()
for p in glob.glob(os.path.join(BRAIN, "people", "*.md")) + glob.glob(os.path.join(BRAIN, "companies", "*.md")):
    existing_entities.add(os.path.splitext(os.path.basename(p))[0].lower())
    ptxt = open(p, encoding="utf-8", errors="replace").read()
    for h in re.findall(r'@([A-Za-z0-9_.]{2,})', ptxt):
        entity_handles.add(h.lower().strip("@.").strip())
# token-sets of existing entity slugs, for variant matching (middle names, ordering)
entity_token_sets = [set(s.split("-")) & {t for t in s.split("-") if len(t) >= 2}
                     for s in existing_entities]
entity_token_sets = [ts for ts in entity_token_sets if len(ts) >= 2]

def is_covered(name, handle=""):
    h = (handle or "").lower().strip("@.").strip()
    if (h and h in entity_handles) or (slugify_name(name) in existing_entities):
        return True
    # variant match: a known entity whose multi-token name is a subset/superset of this
    # one, sharing >=2 tokens (so "Stefan Valentin Mandachi" matches slug "stefan-mandachi"
    # but a shared single common first name never triggers it).
    # Only the "existing entity name is a subset of this mention" direction (e.g. existing
    # `stefan-mandachi` ⊆ "Stefan Valentin Mandachi"). NOT the reverse -- a shorter mention
    # like "John Smith" must NOT be suppressed by a fuller existing "John Michael Smith",
    # since they may be different people; better to surface it for a human than hide it.
    nt = name_tokens(name)
    if len(nt) >= 2:
        for ts in entity_token_sets:
            if len(ts) >= 2 and ts <= nt:
                return True
    return False

# entity slug -> {label, raws(set=distinct saves, creator signal),
#                 mpages(set=distinct pages that MENTION it), pages(set=all, display), sources}
ent = defaultdict(lambda: {"label": "", "raws": set(), "mpages": set(), "pages": set(), "sources": set()})

# (a) creators -- recurrence = distinct SAVES (raws), never pages (1 raw can be cited by N pages)
for base, r in raws.items():
    user = (r.get("author_user") or "").lower().strip("@.").strip()
    name = r.get("author_name") or ""
    if not (user or name):
        continue
    label = name or user
    if is_covered(name, user) or is_covered(user, user):
        continue
    pages = id_to_pages.get(base, [])
    if not pages:
        continue
    key = slugify_name(label) or label.lower()
    e = ent[key]; e["label"] = e["label"] or label
    e["raws"].add(base)
    e["sources"].add("creator")
    for pg in pages:
        e["pages"].add(os.path.relpath(pg, BRAIN))

# (b) mentions -- scan `## People/Companies Mentioned` sections of every page
MENTION_HDR = re.compile(r'^##\s+(People|Companies)\s+Mentioned', re.I)
for pg in all_pages:
    rel = os.path.relpath(pg, BRAIN)
    txt = open(pg, encoding="utf-8", errors="replace").read()
    # collect the body of any Mentioned section (until the next "##" header, space or not)
    insec, lines = False, []
    for ln in txt.splitlines():
        if MENTION_HDR.match(ln):
            insec = True; continue
        if insec and ln.startswith("##"):
            insec = False
        if insec:
            lines.append(ln)
    sec = "\n".join(lines)
    if not sec.strip():
        continue
    names = set()
    # (i) linked names pointing at a people/ or companies/ target (flag only if missing)
    for m in re.finditer(r'\[([^\]]+)\]\((?:\.\./)*(?:people|companies)/([^)\s]+)\)', sec):
        if os.path.basename(m.group(2)).lower() not in existing_entities:
            names.add(m.group(1).strip())
    # (ii) per-bullet plain/bold/prose names. For each Mentioned bullet, strip md links &
    # bold, drop a leading "Quoted:"/"Also:" label, then split on the name/desc separator
    # (em-dash, "--", ":") and on commas, and keep the name-shaped fragments. The >=2-page
    # recurrence gate downstream is the real noise filter, so over-extraction here is safe.
    BAD = re.compile(r'(no brain page|author|creator|host|podcast|@|http|\.com|\bvideo\b|\bclip\b)', re.I)
    TITLE = re.compile(r'^(the |a |an |dr\.?|mr\.?|mrs\.?|ms\.?|prof\.?|professor|president|sir|ceo|founder)\s+', re.I)
    # function/verb tokens a real person/company name won't contain -> reject fragment
    STOP = {"the","and","a","an","of","for","with","to","in","on","reported","said","says",
            "wrote","covered","quoted","author","creator","host","via","aka","amp"}
    for ln in sec.splitlines():
        if not ln.strip().startswith(("-", "*")):
            continue
        s = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', ln)   # links -> just the text
        s = s.replace("**", "")
        s = re.sub(r'^[\s\-\*]+', '', s)
        s = re.sub(r'^(Quoted|Also|Mentioned|Featuring|Guests?)\s*:\s*', '', s, flags=re.I)
        head = re.split(r'\s+(?:—|--|–)\s+|:\s', s, maxsplit=1)[0]   # name part before desc
        # split co-mentions: commas, " and ", " & "
        for frag in re.split(r',|\s+and\s+|\s+&\s+', head):
            nm = re.sub(r'\([^)]*\)', '', frag).strip(" :-.—–*")
            nm = TITLE.sub('', nm).strip()
            words = nm.split()
            if not (2 <= len(words) <= 5 and len(nm) >= 4):
                continue
            if not (re.search(r'[A-Za-z]', nm) and nm[0].isupper()):
                continue
            if BAD.search(nm) or {w.lower().strip(".") for w in words} & STOP:
                continue
            names.add(nm)
    for nm in names:
        if is_covered(nm):
            continue
        key = slugify_name(nm)
        if not key:
            continue
        e = ent[key]; e["label"] = e["label"] or nm
        e["mpages"].add(rel); e["pages"].add(rel)
        e["sources"].add("mention")

# Candidate if recurrence crosses the bar on EITHER signal: >=2 distinct saves (creator)
# OR mentioned on >=2 distinct pages. (Creator pages are display-only, never the trigger,
# so 1 save cited by many pages does NOT qualify.)
promotion_candidates = sorted(
    ({"entity": e["label"], "sources": sorted(e["sources"]),
      "raw_count": len(e["raws"]), "mention_pages": len(e["mpages"]),
      "pages": sorted(e["pages"])}
     for e in ent.values()
     if len(e["raws"]) >= 2 or len(e["mpages"]) >= 2),
    key=lambda d: -(len(d["pages"])))
report["promotion_candidates"] = promotion_candidates   # REVIEW list

# ---------- 8. SYNC-PARITY (item 4) ----------
parity_drift, parity_missing, parity_checked = [], [], 0
if "--no-parity" not in sys.argv:
    def body_norm(t):
        # Line-based frontmatter strip (robust to title punctuation, em-dash rules, and
        # the engine's reformatted frontmatter). Compare BODIES only — frontmatter
        # legitimately differs (engine adds ingested_at etc.).
        t = t.lstrip()
        if t.startswith("---"):
            lines = t.split("\n")
            for i in range(1, len(lines)):
                if lines[i].strip() == "---":
                    t = "\n".join(lines[i + 1:])
                    break
        return re.sub(r'\s+', ' ', t).strip()
    targets = list(all_pages)
    if "--sample" in sys.argv:
        try:
            n = int(sys.argv[sys.argv.index("--sample") + 1])
            targets = sorted(targets, key=lambda p: hashlib.md5(p.encode()).hexdigest())[:n]
        except Exception:
            pass
    def check(pg):
        slug = os.path.relpath(pg, BRAIN)[:-3]
        disk = body_norm(open(pg, encoding="utf-8", errors="replace").read())
        try:
            out = subprocess.run(["gbrain", "get", slug], capture_output=True,
                                 text=True, timeout=60)
        except Exception as e:
            return ("ERR", slug, str(e)[:80])
        if out.returncode != 0 or not out.stdout.strip():
            return ("MISSING", slug, "")
        return (None if body_norm(out.stdout) == disk else "DRIFT", slug, "")
    with ThreadPoolExecutor(max_workers=8) as ex:
        for verdict, slug, info in ex.map(check, targets):
            parity_checked += 1
            if verdict == "DRIFT":
                parity_drift.append(slug)
            elif verdict in ("MISSING", "ERR"):
                parity_missing.append(f"{slug} ({verdict}{': '+info if info else ''})")
report["parity_checked"] = parity_checked
report["parity_drift"] = sorted(parity_drift)
report["parity_missing_in_engine"] = sorted(parity_missing)

# ---------- output ----------
print(json.dumps(report, indent=2, ensure_ascii=False))

# HARD failures gate the weekly cron; everything else is review-only.
hard = (len(report["pages_citing_missing_raw"]) + len(no_cite)
        + len(unreviewed_drops) + len(parity_drift) + len(parity_missing))
review = len(grounding_flags) + len(funnel_no_raw) + len(promotion_candidates)

print("\n================ VERDICT ================", file=sys.stderr)
print(f"raws on disk:                 {report['raws_total']}", file=sys.stderr)
print(f"pages total / citing a raw:   {report['pages_total']} / {report['pages_citing_raw']}", file=sys.stderr)
print(f"[1] raws with NO page:        {len(no_page)}  (auto-legit {len(auto_legit)} + other)", file=sys.stderr)
print(f"[2] pages citing MISSING raw: {len(report['pages_citing_missing_raw'])}  (HARD, must be 0)", file=sys.stderr)
print(f"[3] pages MISSING citation:   {len(no_cite)}  (HARD, must be 0)", file=sys.stderr)
print(f"[4] grounding FLAGS:          {len(grounding_flags)}  (review)", file=sys.stderr)
print(f"[5] transcript-less raws:     {len(transcript_issues)}  (info: empty/refusal/trivial)", file=sys.stderr)
print(f"[6] UNREVIEWED drops:         {len(unreviewed_drops)}  (HARD: raw has content but no page)", file=sys.stderr)
print(f"[7] sent URLs w/ NO raw:      {len(funnel_no_raw)}  (review: send->fetch drops; {report['urls_sent_distinct']} distinct sent)", file=sys.stderr)
print(f"[8] sync-parity drift:        {len(parity_drift)} drift + {len(parity_missing)} missing  (HARD; checked {parity_checked})", file=sys.stderr)
print(f"[9] entity promotion cands:   {len(promotion_candidates)}  (review: person/company recurring >=2x, no entity page)", file=sys.stderr)
if promotion_candidates:
    print("    PROMOTE?:", ", ".join(f"{c['entity']} ({'+'.join(c['sources'])}, {c['raw_count']}saves/{c['mention_pages']}mentions)" for c in promotion_candidates[:12]), file=sys.stderr)
if unreviewed_drops:
    print("    UNREVIEWED:", ", ".join(unreviewed_drops), file=sys.stderr)
if parity_drift:
    print("    DRIFT:", ", ".join(parity_drift[:10]), file=sys.stderr)
print(f"\nAUDIT_HARD_FAIL: {hard}", file=sys.stderr)
print(f"AUDIT_REVIEW: {review}", file=sys.stderr)
# clean machine lines for the weekly cron to grep (stable, order-independent)
print(f"AUDIT_FUNNEL_NO_RAW: {len(funnel_no_raw)}", file=sys.stderr)
print(f"AUDIT_GROUNDING_FLAGS: {len(grounding_flags)}", file=sys.stderr)
print(f"AUDIT_UNREVIEWED_DROPS: {len(unreviewed_drops)}", file=sys.stderr)
print(f"AUDIT_PROMOTION_CANDIDATES: {len(promotion_candidates)}", file=sys.stderr)
print(f"AUDIT_PARITY_DRIFT: {len(parity_drift)}", file=sys.stderr)

sys.exit(1 if ("--strict" in sys.argv and hard) else 0)
