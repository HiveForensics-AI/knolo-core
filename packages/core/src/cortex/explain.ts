import type { CortexExplanation, CortexTraceV1 } from './types.js';
import { validateCortexTrace } from './validate.js';

/** Project a trace. This does not retrieve and it does not judge the answer. */
export function explainCortexAnswer(trace: CortexTraceV1): CortexExplanation {
  const valid = validateCortexTrace(trace);
  const citationMap: CortexExplanation['citationMap'] = {};
  for (const citation of valid.answer.citations) {
    const list = citationMap[citation.evidenceId] ?? [];
    list.push(citation);
    citationMap[citation.evidenceId] = list;
  }
  return {
    question: valid.question,
    rounds: valid.rounds,
    selectedEvidence: valid.selectedEvidence,
    rejectedEvidence: valid.rounds.flatMap((round) => round.rejected),
    gaps: valid.answer.gaps,
    karEvaluations: valid.karEvaluations ?? [],
    citationMap,
    finalAnswer: valid.answer,
  };
}

export const explainCortexTrace = explainCortexAnswer;
