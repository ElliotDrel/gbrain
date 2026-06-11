/**
 * Shadow Comparison (local A/B harness, NOT a runtime path).
 *
 * Purpose: while Anthropic stays the real runtime provider, fire the SAME
 * gateway.chat() prompt at one or more alternative models IN PARALLEL and
 * append both the Anthropic answer and each shadow answer to a dated JSON
 * log. A companion Python script (scripts/shadow_report.py) renders that log
 * into an HTML viewer so you can eyeball which output you prefer.
 *
 * Tier-aware pairing — the alternatives are chosen by which Anthropic tier
 * the real call used, so a Sonnet-tier call and a Haiku-tier call can shadow
 * to different models:
 *
 *   GBRAIN_SHADOW_SONNET   comma-separated models to run instead of Sonnet/Opus
 *   GBRAIN_SHADOW_HAIKU    comma-separated models to run instead of Haiku
 *
 * Examples:
 *   GBRAIN_SHADOW_SONNET=openai:gpt-4o,openai:gpt-4.1
 *   GBRAIN_SHADOW_HAIKU=openai:gpt-4o-mini,google:gemini-2.0-flash
 *
 * Either var may be omitted independently. If neither matches the real call's
 * tier, shadow mode is a no-op (zero added latency, zero added cost).
 *
 * Output: ~/.gbrain/shadow-compare-YYYY-MM-DD.jsonl (override dir with
 * GBRAIN_SHADOW_DIR) — one JSON object per line (append-safe). Writes are
 * best-effort and fire-and-forget: a shadow failure NEVER affects the real
 * runtime result.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ChatOpts, ChatResult, ChatMessage, ChatBlock } from './gateway.ts';

export type ShadowTier = 'sonnet' | 'haiku';

export interface ShadowOutcome {
  model: string;
  /** Present on success. */
  result?: ChatResult;
  /** Present on failure (stringified error). */
  error?: string;
}

/** One serialized answer (real or shadow) in the JSON log. */
interface ShadowAnswerRecord {
  role: 'anthropic' | 'shadow';
  model: string;
  text: string | null;
  error: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  } | null;
  stop_reason: string | null;
}

/** One full comparison record — exactly one JSON object per chat() call. */
interface ShadowRecord {
  timestamp: string;
  requested_model: string;
  tier: ShadowTier;
  prompt: {
    system: string | null;
    messages: Array<{ role: string; content: string }>;
  };
  anthropic: ShadowAnswerRecord;
  shadows: ShadowAnswerRecord[];
}

/**
 * Classify the real model string into a shadow tier. gbrain's defaults are
 * `anthropic:claude-sonnet-4-6` and `anthropic:claude-haiku-4-5-20251001`,
 * so a simple substring match on the resolved id is robust. Opus maps to the
 * Sonnet (high-capability) bucket since that's the closest swap intent.
 */
export function classifyShadowTier(realModelStr: string): ShadowTier | null {
  const m = realModelStr.toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet') || m.includes('opus')) return 'sonnet';
  return null;
}

/** Parse a comma-separated env var into a clean model-id list. */
function parseModelList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Return the configured shadow models for whatever tier the real call used.
 * Empty array => no shadowing for this call.
 */
export function getShadowModels(realModelStr: string): string[] {
  const tier = classifyShadowTier(realModelStr);
  if (tier === 'sonnet') return parseModelList(process.env.GBRAIN_SHADOW_SONNET);
  if (tier === 'haiku') return parseModelList(process.env.GBRAIN_SHADOW_HAIKU);
  return [];
}

/** Whether any shadow var is set at all (cheap gate before tier work). */
export function shadowEnabled(): boolean {
  return !!(process.env.GBRAIN_SHADOW_SONNET || process.env.GBRAIN_SHADOW_HAIKU);
}

function shadowDir(): string {
  return process.env.GBRAIN_SHADOW_DIR || join(homedir(), '.gbrain');
}

/** UTC date stamp (YYYY-MM-DD). `now` is injected so this stays pure. */
function todayStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Flatten a ChatMessage's content into a single readable string. */
function flattenContent(content: string | ChatBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((b: ChatBlock) => {
      if (b.type === 'text') return b.text;
      if (b.type === 'tool-call') return `[tool-call ${b.toolName}: ${JSON.stringify(b.input)}]`;
      if (b.type === 'tool-result') return `[tool-result ${b.toolName}: ${JSON.stringify(b.output)}]`;
      return JSON.stringify(b);
    })
    .join('\n');
}

function answerFromResult(role: ShadowAnswerRecord['role'], model: string, r: ChatResult): ShadowAnswerRecord {
  return {
    role,
    model: r.model || model,
    text: r.text ?? '',
    error: null,
    usage: { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens },
    stop_reason: r.stopReason,
  };
}

/**
 * Append one comparison record (single JSON line) for a chat() call.
 * Best-effort: any throw here is swallowed by the caller's .catch so runtime
 * is never affected.
 */
export function writeShadowComparison(args: {
  opts: ChatOpts;
  requestedModel: string;
  tier: ShadowTier;
  real: ChatResult;
  shadows: ShadowOutcome[];
  now: Date;
}): void {
  const { opts, requestedModel, tier, real, shadows, now } = args;

  const record: ShadowRecord = {
    timestamp: now.toISOString(),
    requested_model: requestedModel,
    tier,
    prompt: {
      system: opts.system ?? null,
      messages: opts.messages.map((m) => ({ role: m.role, content: flattenContent(m.content) })),
    },
    anthropic: answerFromResult('anthropic', real.model, real),
    shadows: shadows.map((s) =>
      s.error || !s.result
        ? {
            role: 'shadow' as const,
            model: s.model,
            text: null,
            error: s.error ?? 'unknown error',
            usage: null,
            stop_reason: null,
          }
        : answerFromResult('shadow', s.model, s.result),
    ),
  };

  const dir = shadowDir();
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `shadow-compare-${todayStamp(now)}.jsonl`);
  appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
}
