#!/usr/bin/env node
// promotion-candidates.mjs — find recurring proper nouns in the brain that are
// mentioned across multiple pages but have NO page of their own (so gbrain's graph
// can't see them). Surfaces "earn-by-recurrence" promotion candidates.
//
// Pure read-only: scans committed .md pages, counts UNLINKED capitalized names per
// distinct page, excludes anything that already has a page (by title + significant
// title tokens, so surname mentions of existing people are excluded too).
//
// Usage: node promotion-candidates.mjs [--brain DIR] [--min-pages N] [--json]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const args = process.argv.slice(2);
const getFlag = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const BRAIN = getFlag('--brain', process.env.GBRAIN_BRAIN || '/home/supe/brain');
const MIN_PAGES = parseInt(getFlag('--min-pages', '2'), 10);
const JSON_OUT = args.includes('--json');

// Capitalized common words / sentence-starters / units we never want as entities.
const STOP = new Set([
  'The','This','That','These','Those','There','Their','They','Then','Than','Them',
  'A','An','And','But','Or','So','If','As','At','In','On','Of','To','For','From','With','By',
  'I','We','You','He','She','It','His','Her','Our','My','Your',
  'Most','Some','Many','Much','More','Less','Few','All','Both','Each','Every','Any','No','Not',
  'When','Where','While','What','Which','Who','Whom','Whose','Why','How',
  'Here','Now','Today','Tomorrow','Yesterday','Later','Before','After','During','Once',
  'Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday',
  'January','February','March','April','May','June','July','August','September','October','November','December',
  'Jan','Feb','Mar','Apr','Jun','Jul','Aug','Sep','Sept','Oct','Nov','Dec',
  'Source','Author','Format','Posted','Created','Summary','Note','Key','Why','Default',
  'Step','Phase','Implication','Implications','Reality','Pain','Brain','Page','Timeline',
  'AI','CEO','CFO','COO','CLO','SVP','RVP','GM','GMs','ROI','PS','URL','OK','Q1','Q2','Q3','Q4',
  'Yes','Maybe','Even','Also','Just','Only','Still','Like','Because','Therefore','Thus','Plus',
  'New','Good','Bad','Great','Best','First','Second','Third','Next','Last','One','Two','Three',
  'Do','Don','Make','Get','Use','Run','Add','See','Read','Build','Pick','Keep','Stop','Go',
  'Elliot','Drel','Henry',
  // provenance platforms / formats (sources, not entities to promote)
  'Instagram','YouTube','Youtube','TikTok','Tiktok','Twitter','Facebook','LinkedIn','Linkedin',
  'Fathom','Zoom','Reel','Reels','Virtual','Phone','Telegram','Signal','WhatsApp','Whatsapp','Video',
  // residual heading / metadata-label words (belt-and-suspenders behind line-stripping)
  'Subject','Profile','Research','Goal','Verbatim','Quotes','Surprises','Assumptions','Mentioned',
  'Companies','People','Process','Findings','Learnings','Takeaways','Attendees','Recorded','Scheduled',
  'Language','Duration','Transcript','Recording','Share','Metadata','Executive','Useful','Saved',
  'Points','Primary','Open','Threads','Items','Breakdown','Historical','Profiles','Quote',
  // participle/verb sentence-starters that recur in notes/timeline phrasing
  'Referenced','Surfaced','Discussed','Offered','Created','Attended','Finalize','Finalized',
  'Posted','Relationship','User','Reality','Implication','Representative','Compare','Going',
  'American','Implementation','Confirmed','Treat','Understand','Explore','Schedule','Email',
  'Series','Thank','Thanks','Pick','Map','Research','Step','Phase','Owner','Note','Notes',
  'Appears','Global','Reference','Shows','Known','Surfaced','Builds','Building','Runs',
]);

// ---- collect pages ----
function walk(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name.endsWith('.raw')) continue;          // skip raw sidecars
      out = out.concat(walk(p));
    } else if (name.endsWith('.md')) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(BRAIN);

// ---- build the "already has a page" exclusion set ----
const existing = new Set();
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const pages = [];
for (const f of files) {
  const raw = readFileSync(f, 'utf8');
  const slug = relative(BRAIN, f).replace(/\.md$/, '');
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const fm = fmMatch ? fmMatch[1] : '';
  const titleM = fm.match(/^title:\s*['"]?(.+?)['"]?\s*$/m);
  const title = titleM ? titleM[1] : basename(slug).replace(/-/g, ' ');
  const body = raw.slice(fmMatch ? fmMatch[0].length : 0);
  pages.push({ slug, title, body });
  // exclude full title + slug-basename + any frontmatter aliases, and every
  // significant token (surnames, "Lodging", etc.). Strip possessive 's so titles
  // align with the prose scan (which also strips it): "Men's Health" ⇒ "Men Health".
  const stripPoss = (s) => s.replace(/['’]s\b/g, '');
  const aliasNames = [];
  const aliasBlock = fm.match(/^aliases:\s*\n((?:[ \t]*-[ \t]*.+\n?)+)/m);
  if (aliasBlock) for (const a of aliasBlock[1].matchAll(/-[ \t]*(.+)/g)) aliasNames.push(a[1].trim());
  const idStrings = [title, basename(slug).replace(/-/g, ' '), ...aliasNames];
  for (const s of idStrings) {
    existing.add(norm(stripPoss(s)));
    for (const tok of stripPoss(s).split(/[\s-]+/)) {
      if (tok.length >= 4) existing.add(norm(tok));
    }
  }
}

const clean = (body) => body
  .replace(/```[\s\S]*?```/g, ' ')
  .replace(/`[^`]*`/g, ' ')
  .replace(/^#{1,6}\s+.*$/gm, ' ')           // strip markdown heading lines wholesale
  .replace(/^\s*\[[^\]]+\]:\s*\S.*$/gm, ' ') // strip reference-link definition lines
  .replace(/\*\*[^*]+?:\*\*/g, ' ')          // strip bold labels (**Date:**, **Source:**, ...)
  .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')      // remove [text](target) wholesale (already-linked nodes)
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/['’]s\b/g, '')   // drop possessive 's (Elliot's, Purdue's)
  .replace(/^\s*>\s*\*\*Default source.*$/gim, ' ');

// Pre-pass: how often is each token written LOWERCASE across the corpus? A real
// proper noun (Claude, Colombia) is almost never lowercased; a common word
// (work, company, long, content) is. This is the main precision lever.
const lowerFreq = new Map();
for (const { body } of pages) {
  for (const w of clean(body).match(/\b[a-z]{3,}\b/g) || []) {
    lowerFreq.set(w, (lowerFreq.get(w) || 0) + 1);
  }
}
const COMMON = 4;                              // lowercased >=4x ⇒ treat as common word, not a name
const PREFIX_OK = new Set(['new','san','los','las','fort','saint','st','north','south','east','west','lake','mount','port','cape','el','del','van','de','la','rio']);
const isCommon = (tok) => (lowerFreq.get(tok.toLowerCase()) || 0) >= COMMON;

// ---- scan prose for UNLINKED capitalized names ----
const hits = new Map();                        // candidate -> Set(slugs)
const NAME_RE = /\b([A-Z][a-zA-Z'’.]+(?:\s+[A-Z][a-zA-Z'’.]+){0,3})\b/g;

for (const { slug, body } of pages) {
  const text = clean(body);
  const seenOnPage = new Set();
  let m;
  while ((m = NAME_RE.exec(text)) !== null) {
    const cand = m[1].replace(/['’]s$/i, '').replace(/[.'’]+$/, '').trim();
    if (cand.length < 4) continue;
    const words = cand.split(/\s+/);
    if (words.every((w) => STOP.has(w))) continue;
    if (words.some((w) => STOP.has(w))) continue; // any stopword token ⇒ likely sentence-edge noise
    if (existing.has(norm(cand))) continue;       // already has a page (or is a token of one)
    // Common-word filter: a leading token that's frequently lowercased (and not a
    // place prefix like "New"/"San") means this is sentence-start noise, not a name.
    if (isCommon(words[0]) && !PREFIX_OK.has(words[0].toLowerCase())) continue;
    if (words.length === 1 && isCommon(words[0])) continue;
    if (seenOnPage.has(norm(cand))) continue;     // count each candidate once per page
    seenOnPage.add(norm(cand));
    if (!hits.has(cand)) hits.set(cand, new Set());
    hits.get(cand).add(slug);
  }
}

// ---- collapse case/variant duplicates by normalized form, keep the longest surface ----
const byNorm = new Map();
for (const [cand, slugs] of hits) {
  const n = norm(cand);
  if (!byNorm.has(n)) byNorm.set(n, { surface: cand, slugs: new Set() });
  const e = byNorm.get(n);
  if (cand.length > e.surface.length) e.surface = cand;
  for (const s of slugs) e.slugs.add(s);
}

const results = [...byNorm.values()]
  .map((e) => ({ name: e.surface, pages: [...e.slugs], count: e.slugs.size }))
  .filter((r) => r.count >= MIN_PAGES)
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ brain: BRAIN, min_pages: MIN_PAGES, candidates: results }, null, 2));
  process.exit(0);
}

if (results.length === 0) {
  console.log('NO_REPLY');
  process.exit(0);
}

console.log(`Promotion candidates (recurring, page-less names; >=${MIN_PAGES} pages):\n`);
for (const r of results) {
  const multi = r.name.includes(' ') ? '' : '  (single-word — review)';
  console.log(`- ${r.name} — ${r.count} pages${multi}`);
  console.log(`    ${r.pages.slice(0, 4).join(', ')}${r.pages.length > 4 ? ' …' : ''}`);
}
