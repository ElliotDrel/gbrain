# On-Screen Text Ingest (burned-in text reels)

Directions for the media-ingest sub-case where a short video's **real content is
text rendered onto the frames** (not spoken). The spoken transcript comes back
empty or trivial (e.g. `Let's rock`), so the page would be hollow unless the
on-screen text is recovered.

**Method, proven:** deterministic frame extraction by a script, then **the agent
reads each frame as an image**. This is the do-now path in
[docs/onscreen-text-extraction-FINAL-REPORT.md](../../docs/onscreen-text-extraction-FINAL-REPORT.md)
(real benchmarks live on this box). Read that report for the evidence; this file
is the operational procedure.

---

## 1. When this fires (trigger)

Treat an item as an on-screen-text candidate when, after `social-fetch.mjs` has
written the raw:

- it is a **short video** (`media.duration` <= ~90s), AND
- its transcript is **empty OR trivial** -- `_transcript_state: ok` but the body
  transcript is blank or <= ~3 words.

If the transcript is substantive, this flow does not apply -- ingest normally.

## 2. Deterministic step (run the script -- no model)

```bash
node skills/media-ingest/scripts/onscreen-frames.mjs \
  "<reel-url-or-local-mp4>" --fps 3 \
  --raw /home/supe/brain/sources/social/<platform>-<id>.txt
# gated download? pass the CDN url from the raw's media.videoUrl:
#   ... --video-url "<media.videoUrl>"
```

It downloads (yt-dlp, with the `--video-url` CDN fallback for login-gated IG/TikTok/X),
samples **fixed-fps** frames (robust for overlay-text reels -- scene-detect
collapses to 1 frame, see report 4.2), and prints a JSON manifest:

```json
{ "ok": true, "frameDir": "/tmp/onscreen-frames-XXXX/frames",
  "frames": ["/tmp/.../f_0001.png", "..."], "count": 19,
  "rawPath": ".../instagram-<id>.txt",
  "heading": "## On-Screen Text (from video frames, YYYY-MM-DD)" }
```

On any failure (bad input, gated download with no working `--video-url`, no video
stream) it prints `{"ok":false,"error":...}`, exits non-zero, and removes its own
scratch dir. On success the scratch dir is kept (you need to read the frames) and
`frameDir` tells you where it is.

The script never reads or OCRs the frames. ffmpeg/yt-dlp are the user-space static
builds in `~/.local/bin` (no sudo); if ffmpeg is missing the script prints the
one-line install command.

## 3. Agent step (read the frames -- this is you)

For each path in `frames`, use the **Read tool** to view the PNG and transcribe the
on-screen text exactly -- headings and order preserved. Then **dedup**: fixed-fps
oversamples (~3x), so the same card recurs across adjacent frames; keep one clean
copy of each distinct card. Do not paraphrase; transcribe what is on screen.

(Reading the frames yourself costs no extra API line -- you already have vision.
A fully-scripted alternative exists -- Claude Haiku 4.5 vision OCR, ~$0.01-0.03/clip
-- but use it only when you want the raw populated before an agent is in the loop;
see report section 6, step 3B. The agent-reads-frames path is the default.)

## 4. Persist into the raw (grounding)

Append the recovered text to the **same raw** the script was pointed at
(`sources/social/<platform>-<id>.txt`), under the script's dated `heading`, with a
one-line provenance note that it is frame-OCR (not a fetched transcript). Keep the
raw `.txt` (disk-only provenance, hard guardrail 3). Only then build/refresh the
brain page from the now-grounded raw. Example tail:

```
## On-Screen Text (from video frames, 2026-06-25)
_Recovered from video frames (fixed-fps sample + vision read); not a spoken transcript._

<deduped, ordered on-screen text>
```

## 5. Cleanup

After the frames are read and the text is in the raw, remove the scratch dir:
`rm -rf "$(dirname <frameDir>)"`. Nothing under `/tmp` should be left behind.

---

## Do / Don't (each backed by a test in the report)

- **DO** fixed-fps frames (`fps=3`) -- robust default for overlay-text reels.
- **DO** read frames with a vision model (you, or Haiku 4.5 if scripted).
- **DON'T** use scene-detect as the frame primitive -- it collapsed to **1 frame**
  on the trigger clip (same-background caption swaps fall below any threshold).
- **DON'T** use **GPT-4o** for OCR -- it refuses person-in-frame stochastically
  (2-3 of 3). If OpenAI is required, use gpt-4.1 or gpt-4o-mini.
- **DON'T** use tesseract / classic OCR -- fails on stylized text over photos, and
  isn't installed (needs sudo) anyway.
