import type { z } from 'zod';
import type { AIChain, AITask } from '../provider.js';

/**
 * Central prompt library.
 *
 * Every prompt the app sends lives in this folder:
 *   resume.ts  – resume parsing, JD analysis, tailoring, chat edits, semantic score, add-entry
 *   career.ts  – career profile, application answers, cover letters, emails,
 *                interview questions + evaluation, learning plans, career chat
 *
 * Career prompts are declared with definePrompt(): a stable id, a version
 * (bump it whenever wording changes, so stored outputs can be traced back),
 * the JSON schema the model must follow and a zod validator that every
 * response must pass before it is used. runPrompt() goes through the
 * provider fallback chain (Gemini → Groq → Mistral → Claude).
 */

export interface PromptSpec<V, S extends z.ZodTypeAny> {
  id: string;
  version: number;
  task: AITask;
  effort?: 'low' | 'medium' | 'high';
  /** Strict JSON schema sent to the model. */
  schema: Record<string, unknown>;
  /** Validates (and normalises) the model's JSON. */
  output: S;
  build(vars: V): { system: string; prompt: string };
}

export function definePrompt<V, S extends z.ZodTypeAny>(spec: PromptSpec<V, S>): PromptSpec<V, S> {
  return spec;
}

export interface PromptRun<O> {
  data: O;
  provider: string;
  /** "<id>@v<version>", stored with generated content. */
  prompt: string;
}

/**
 * Runs a prompt through the provider chain. The response must match the
 * schema and pass `check` (e.g. "no invented facts"); otherwise the next
 * provider is tried and, if all fail, AIUnavailableError is thrown so callers
 * can fall back to deterministic logic.
 */
export async function runPrompt<V, S extends z.ZodTypeAny>(ai: AIChain, spec: PromptSpec<V, S>, vars: V, check?: (data: z.infer<S>) => void): Promise<PromptRun<z.infer<S>>> {
  const { system, prompt } = spec.build(vars);
  const { data, provider } = await ai.generate({ task: spec.task, system, prompt, schema: spec.schema, effort: spec.effort }, (raw) => {
    const parsed = spec.output.safeParse(raw) as z.SafeParseReturnType<unknown, z.infer<S>>;
    if (!parsed.success) throw new Error(`AI response failed schema validation (${spec.id}): ${parsed.error.issues[0]?.message || 'invalid'}`);
    check?.(parsed.data);
    return parsed.data;
  });
  return { data, provider, prompt: `${spec.id}@v${spec.version}` };
}

/** Catalogue for documentation and tests: every prompt id and version in the app. */
export const PROMPT_CATALOG: Array<{ id: string; version: number; purpose: string }> = [
  { id: 'resume.parse', version: 1, purpose: 'Structure an uploaded or pasted resume' },
  { id: 'resume.jd', version: 1, purpose: 'Analyse a job description (skills, requirements)' },
  { id: 'resume.generate', version: 1, purpose: 'Tailor a resume to a job (fact-guarded)' },
  { id: 'resume.edit', version: 1, purpose: 'Chat-based resume edits (fact-guarded)' },
  { id: 'resume.semantic', version: 1, purpose: 'Semantic relevance part of the ATS score' },
  { id: 'resume.entry', version: 1, purpose: 'Add a project/internship from a brief or file' },
];
