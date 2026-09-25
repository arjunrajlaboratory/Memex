// AskUserQuestion support. The SDK routes the tool through canUseTool and expects
// the HOST to collect the answers: allowing it with the input unchanged makes the
// CLI resolve the question with no answer at all (issue #55). These helpers
// validate the tool input into what the renderer shows, turn the user's picks
// into the updatedInput the SDK expects, and track questions awaiting an answer.

export const ASK_USER_TOOL = 'AskUserQuestion';

/** Sanitize the model-supplied input into renderable questions; null if unusable. */
export function parseQuestions(input: Record<string, unknown>): AgentQuestion[] | null {
  const raw = input && Array.isArray(input.questions) ? input.questions : null;
  if (!raw || !raw.length) return null;
  const questions: AgentQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q !== 'object') return null;
    const { question, header, options, multiSelect } = q as Record<string, unknown>;
    if (typeof question !== 'string' || !question.trim() || !Array.isArray(options)) return null;
    const opts = options
      .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && typeof (o as Record<string, unknown>).label === 'string')
      .map((o) => ({
        label: String(o.label),
        description: typeof o.description === 'string' ? o.description : '',
        ...(typeof o.preview === 'string' ? { preview: o.preview } : {}),
      }));
    questions.push({
      question,
      header: typeof header === 'string' ? header : '',
      options: opts,
      multiSelect: multiSelect === true,
    });
  }
  return questions;
}

/**
 * The updatedInput that answers the tool: the original input plus `answers`
 * keyed by question text. Multi-select picks are comma-joined, per the tool's
 * output contract. Questions the user left blank are omitted.
 */
export function answeredInput(
  input: Record<string, unknown>,
  questions: AgentQuestion[],
  picks: AgentQuestionAnswers,
): Record<string, unknown> {
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const pick = picks[q.question];
    const values = (Array.isArray(pick) ? pick : [pick])
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length) answers[q.question] = q.multiSelect ? values.join(', ') : values[0];
  }
  return { ...input, answers };
}

/** True when at least one question got a non-empty answer. */
export function hasAnyAnswer(questions: AgentQuestion[], picks: AgentQuestionAnswers | null): boolean {
  if (!picks) return false;
  const { answers } = answeredInput({}, questions, picks) as { answers: Record<string, string> };
  return Object.keys(answers).length > 0;
}

/** Questions shown to the user, each waiting on one answer or a cancellation. */
export class PendingQuestions {
  private waiting = new Map<string, (picks: AgentQuestionAnswers | null) => void>();

  wait(id: string): Promise<AgentQuestionAnswers | null> {
    return new Promise((resolve) => {
      this.waiting.get(id)?.(null);
      this.waiting.set(id, resolve);
    });
  }

  /** Settle one question; false if it was unknown or already settled. */
  answer(id: string, picks: AgentQuestionAnswers | null): boolean {
    const resolve = this.waiting.get(id);
    if (!resolve) return false;
    this.waiting.delete(id);
    resolve(picks);
    return true;
  }

  /** Cancel every open question (session stop, vault switch, interrupt). Returns their ids. */
  cancelAll(): string[] {
    const ids = [...this.waiting.keys()];
    for (const id of ids) this.answer(id, null);
    return ids;
  }

  get size(): number { return this.waiting.size; }
}
