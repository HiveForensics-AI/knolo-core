/**
 * Optional shared phrase factoring for VQF lexical indexes. Selected phrases
 * reconstruct exact original positions; factoring is disabled when equivalence
 * or positive total encoded savings cannot be shown.
 */

import { varintSize } from './table_utils.js';

export type VqfCompressionProfile = 'fast' | 'balanced' | 'max';

export type VqfPhraseDocument = {
  blockId: number;
  positions: number[];
};

export type VqfPhraseTermStream = {
  termId: number;
  term: string;
  documents: VqfPhraseDocument[];
};

export type VqfPhraseFactoringOptions = {
  minPhraseLength?: number;
  maxPhraseLength?: number;
  minPhraseFrequency?: number;
  maxPhraseFanoutPerTerm?: number;
  minPhraseGainBytes?: number;
  exactGain?: boolean;
};

export type VqfResolvedPhraseParameters = {
  minPhraseLength: number;
  maxPhraseLength: number;
  minPhraseFrequency: number;
  maxPhraseFanoutPerTerm: number;
  minPhraseGainBytes: number;
  exactGain: boolean;
};

export type VqfPhraseReference = {
  phraseIndex: number;
  offsets: number[];
};

export type VqfSelectedPhrase = {
  termIds: number[];
  termOrdinals: number[];
  documents: VqfPhraseDocument[];
};

export type VqfFactoredPhrases = {
  used: boolean;
  parameters: VqfResolvedPhraseParameters;
  literals: VqfPhraseTermStream[];
  phrases: VqfSelectedPhrase[];
  references: Map<number, VqfPhraseReference[]>;
};

export const VQF_LEXICAL_PHRASE_FLAG = 0x01;

export const VQF_PHRASE_PROFILE_DEFAULTS: Record<
  VqfCompressionProfile,
  { phraseFactoring: boolean } & VqfResolvedPhraseParameters
> = {
  fast: {
    phraseFactoring: false,
    minPhraseLength: 2,
    maxPhraseLength: 8,
    minPhraseFrequency: 4,
    maxPhraseFanoutPerTerm: 6,
    minPhraseGainBytes: 16,
    exactGain: false,
  },
  balanced: {
    phraseFactoring: true,
    minPhraseLength: 2,
    maxPhraseLength: 8,
    minPhraseFrequency: 4,
    maxPhraseFanoutPerTerm: 6,
    minPhraseGainBytes: 16,
    exactGain: false,
  },
  max: {
    phraseFactoring: true,
    minPhraseLength: 2,
    maxPhraseLength: 12,
    minPhraseFrequency: 2,
    maxPhraseFanoutPerTerm: 8,
    minPhraseGainBytes: 1,
    exactGain: true,
  },
};

export type VqfPhraseProfileOptions = {
  profile?: VqfCompressionProfile;
  phraseFactoring?: boolean | VqfPhraseFactoringOptions;
};

function requirePositiveInt(
  name: string,
  value: number,
  maximum: number
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`Invalid VQF phrase ${name}.`);
  }
  return value;
}

export function resolveVqfPhraseOptions(
  options: VqfPhraseProfileOptions = {}
): {
  enabled: boolean;
  profile: VqfCompressionProfile;
  parameters: VqfResolvedPhraseParameters;
} {
  const profile = options.profile ?? 'fast';
  const defaults = VQF_PHRASE_PROFILE_DEFAULTS[profile];
  if (!defaults) throw new RangeError('Unsupported VQF compression profile.');
  const override =
    typeof options.phraseFactoring === 'object' && options.phraseFactoring
      ? options.phraseFactoring
      : {};
  const parameters: VqfResolvedPhraseParameters = {
    minPhraseLength: requirePositiveInt(
      'minPhraseLength',
      override.minPhraseLength ?? defaults.minPhraseLength,
      64
    ),
    maxPhraseLength: requirePositiveInt(
      'maxPhraseLength',
      override.maxPhraseLength ?? defaults.maxPhraseLength,
      64
    ),
    minPhraseFrequency: requirePositiveInt(
      'minPhraseFrequency',
      override.minPhraseFrequency ?? defaults.minPhraseFrequency,
      16_000_000
    ),
    maxPhraseFanoutPerTerm: requirePositiveInt(
      'maxPhraseFanoutPerTerm',
      override.maxPhraseFanoutPerTerm ?? defaults.maxPhraseFanoutPerTerm,
      64
    ),
    minPhraseGainBytes: requirePositiveInt(
      'minPhraseGainBytes',
      override.minPhraseGainBytes ?? defaults.minPhraseGainBytes,
      16_000_000
    ),
    exactGain: (override.exactGain ?? defaults.exactGain) ? true : false,
  };
  if (parameters.minPhraseLength > parameters.maxPhraseLength) {
    throw new RangeError('VQF phrase min length exceeds max length.');
  }
  const enabled =
    options.phraseFactoring === false
      ? false
      : options.phraseFactoring === true ||
          typeof options.phraseFactoring === 'object'
        ? true
        : defaults.phraseFactoring;
  return { enabled, profile, parameters };
}

export function postingListSize(documents: VqfPhraseDocument[]): number {
  let size = varintSize(documents.length);
  let previousBlock = -1;
  for (const document of documents) {
    size +=
      previousBlock < 0
        ? varintSize(document.blockId + 1)
        : varintSize(document.blockId - previousBlock);
    size += varintSize(document.positions.length);
    let previousPosition = -1;
    for (const position of document.positions) {
      size +=
        previousPosition < 0
          ? varintSize(position + 1)
          : varintSize(position - previousPosition);
      previousPosition = position;
    }
    previousBlock = document.blockId;
  }
  return size;
}

function phraseDefinitionSize(termOrdinals: number[]): number {
  let size = varintSize(termOrdinals.length);
  for (const ordinal of termOrdinals) size += varintSize(ordinal);
  return size;
}

function phraseDirectorySize(
  termOrdinals: number[],
  offset: number,
  length: number,
  documentFrequency: number
): number {
  return (
    phraseDefinitionSize(termOrdinals) +
    varintSize(offset) +
    varintSize(length) +
    varintSize(documentFrequency)
  );
}

function referenceListSize(references: VqfPhraseReference[]): number {
  let size = varintSize(references.length);
  for (const reference of references) {
    size += varintSize(reference.phraseIndex);
    size += varintSize(reference.offsets.length);
    for (const offset of reference.offsets) size += varintSize(offset);
  }
  return size;
}

function cloneDocuments(documents: VqfPhraseDocument[]): VqfPhraseDocument[] {
  return documents.map((document) => ({
    blockId: document.blockId,
    positions: document.positions.slice(),
  }));
}

function removePositions(
  documents: VqfPhraseDocument[],
  removals: Map<number, Set<number>>
): VqfPhraseDocument[] {
  const next: VqfPhraseDocument[] = [];
  for (const document of documents) {
    const covered = removals.get(document.blockId);
    const positions = covered
      ? document.positions.filter((position) => !covered.has(position))
      : document.positions.slice();
    if (positions.length > 0)
      next.push({ blockId: document.blockId, positions });
  }
  return next;
}

function termOffsets(termIds: number[], termId: number): number[] {
  const offsets: number[] = [];
  for (let i = 0; i < termIds.length; i++) {
    if (termIds[i] === termId) offsets.push(i);
  }
  return offsets;
}

function uniqueTermIds(termIds: number[]): number[] {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const termId of termIds) {
    if (seen.has(termId)) continue;
    seen.add(termId);
    unique.push(termId);
  }
  return unique;
}

function compareOrdinals(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

function phraseKey(termIds: number[]): string {
  return termIds.join(',');
}

type Candidate = {
  termIds: number[];
  termOrdinals: number[];
  occurrences: Array<{ blockId: number; start: number }>;
};

function enumerateCandidates(
  streams: VqfPhraseTermStream[],
  parameters: VqfResolvedPhraseParameters,
  termOrdinals: Map<number, number>
): Candidate[] {
  const tokens = new Map<number, Map<number, number>>();
  for (const stream of streams) {
    for (const document of stream.documents) {
      let positions = tokens.get(document.blockId);
      if (!positions) {
        positions = new Map();
        tokens.set(document.blockId, positions);
      }
      for (const position of document.positions) {
        if (positions.has(position)) {
          throw new Error(
            'VQF phrase factoring found overlapping term positions.'
          );
        }
        positions.set(position, stream.termId);
      }
    }
  }
  const grouped = new Map<string, Candidate>();
  for (const [blockId, positionMap] of [...tokens.entries()].sort(
    (left, right) => left[0] - right[0]
  )) {
    const ordered = [...positionMap.keys()].sort((a, b) => a - b);
    let run: Array<{ pos: number; termId: number }> = [];
    const flush = () => {
      if (run.length < parameters.minPhraseLength) {
        run = [];
        return;
      }
      for (
        let length = parameters.minPhraseLength;
        length <= parameters.maxPhraseLength && length <= run.length;
        length++
      ) {
        for (let start = 0; start + length <= run.length; start++) {
          if (run[start + length - 1].pos !== run[start].pos + length - 1) {
            continue;
          }
          const termIds = run
            .slice(start, start + length)
            .map((token) => token.termId);
          const key = phraseKey(termIds);
          let candidate = grouped.get(key);
          if (!candidate) {
            candidate = {
              termIds,
              termOrdinals: termIds.map((termId) => {
                const ordinal = termOrdinals.get(termId);
                if (ordinal === undefined) {
                  throw new Error(
                    'VQF phrase term is missing a lexicon ordinal.'
                  );
                }
                return ordinal;
              }),
              occurrences: [],
            };
            grouped.set(key, candidate);
          }
          candidate.occurrences.push({ blockId, start: run[start].pos });
        }
      }
      run = [];
    };
    for (const position of ordered) {
      const termId = positionMap.get(position);
      if (termId === undefined) continue;
      if (run.length === 0 || position === run[run.length - 1].pos + 1) {
        run.push({ pos: position, termId });
      } else {
        flush();
        run.push({ pos: position, termId });
      }
    }
    flush();
  }
  return [...grouped.values()].map((candidate) => {
    candidate.occurrences.sort((left, right) =>
      left.blockId === right.blockId
        ? left.start - right.start
        : left.blockId - right.blockId
    );
    return candidate;
  });
}

function nonOverlappingOccurrences(
  occurrences: Array<{ blockId: number; start: number }>,
  length: number,
  covered: Map<number, Set<number>>
): Array<{ blockId: number; start: number }> {
  const selected: Array<{ blockId: number; start: number }> = [];
  const local = new Map<number, Set<number>>();
  for (const occurrence of occurrences) {
    let overlaps = false;
    for (let offset = 0; offset < length; offset++) {
      const position = occurrence.start + offset;
      if (covered.get(occurrence.blockId)?.has(position)) {
        overlaps = true;
        break;
      }
      if (local.get(occurrence.blockId)?.has(position)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;
    selected.push(occurrence);
    let positions = local.get(occurrence.blockId);
    if (!positions) {
      positions = new Set();
      local.set(occurrence.blockId, positions);
    }
    for (let offset = 0; offset < length; offset++) {
      positions.add(occurrence.start + offset);
    }
  }
  return selected;
}

function occurrencesAsDocuments(
  occurrences: Array<{ blockId: number; start: number }>
): VqfPhraseDocument[] {
  const grouped = new Map<number, number[]>();
  for (const occurrence of occurrences) {
    const starts = grouped.get(occurrence.blockId);
    if (starts) starts.push(occurrence.start);
    else grouped.set(occurrence.blockId, [occurrence.start]);
  }
  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([blockId, positions]) => ({
      blockId,
      positions: [...positions].sort((a, b) => a - b),
    }));
}

function coverageMap(
  occurrences: Array<{ blockId: number; start: number }>,
  termId: number,
  termIds: number[]
): Map<number, Set<number>> {
  const offsets = termOffsets(termIds, termId);
  const coverage = new Map<number, Set<number>>();
  for (const occurrence of occurrences) {
    let positions = coverage.get(occurrence.blockId);
    if (!positions) {
      positions = new Set();
      coverage.set(occurrence.blockId, positions);
    }
    for (const offset of offsets) positions.add(occurrence.start + offset);
  }
  return coverage;
}

function candidateGain(
  literals: Map<number, VqfPhraseDocument[]>,
  references: Map<number, VqfPhraseReference[]>,
  candidate: Candidate,
  occurrences: Array<{ blockId: number; start: number }>,
  phraseIndex: number,
  exactGain: boolean
): number {
  const documents = occurrencesAsDocuments(occurrences);
  const phraseBytes =
    phraseDirectorySize(
      candidate.termOrdinals,
      0,
      postingListSize(documents),
      documents.length
    ) + postingListSize(documents);
  let saved = 0;
  for (const termId of uniqueTermIds(candidate.termIds)) {
    const current = literals.get(termId) ?? [];
    const next = removePositions(
      current,
      coverageMap(occurrences, termId, candidate.termIds)
    );
    saved += postingListSize(current) - postingListSize(next);
    const currentRefs = references.get(termId) ?? [];
    const nextRefs = [
      ...currentRefs,
      { phraseIndex, offsets: termOffsets(candidate.termIds, termId) },
    ];
    saved += referenceListSize(currentRefs) - referenceListSize(nextRefs);
  }
  const gain = saved - phraseBytes;
  if (!exactGain) return gain;
  return gain;
}

function markCovered(
  covered: Map<number, Set<number>>,
  occurrences: Array<{ blockId: number; start: number }>,
  length: number
): void {
  for (const occurrence of occurrences) {
    let positions = covered.get(occurrence.blockId);
    if (!positions) {
      positions = new Set();
      covered.set(occurrence.blockId, positions);
    }
    for (let offset = 0; offset < length; offset++) {
      positions.add(occurrence.start + offset);
    }
  }
}

export function factorLexicalPhrases(
  streams: VqfPhraseTermStream[],
  parameters: VqfResolvedPhraseParameters,
  termOrdinals: Map<number, number>
): VqfFactoredPhrases {
  const empty = (): VqfFactoredPhrases => ({
    used: false,
    parameters,
    literals: streams.map((stream) => ({
      termId: stream.termId,
      term: stream.term,
      documents: cloneDocuments(stream.documents),
    })),
    phrases: [],
    references: new Map(),
  });
  if (streams.length === 0) return empty();
  const candidates = enumerateCandidates(
    streams,
    parameters,
    termOrdinals
  ).filter(
    (candidate) => candidate.occurrences.length >= parameters.minPhraseFrequency
  );
  if (candidates.length === 0) return empty();

  const literals = new Map(
    streams.map((stream) => [stream.termId, cloneDocuments(stream.documents)])
  );
  const references = new Map<number, VqfPhraseReference[]>();
  const covered = new Map<number, Set<number>>();
  const selected: VqfSelectedPhrase[] = [];
  const fanout = new Map<number, number>();

  const ranked = candidates.map((candidate) => ({
    candidate,
    occurrences: candidate.occurrences,
    gain: 0,
  }));

  while (ranked.length > 0) {
    for (const entry of ranked) {
      entry.occurrences = nonOverlappingOccurrences(
        entry.candidate.occurrences,
        entry.candidate.termIds.length,
        covered
      );
      entry.gain = candidateGain(
        literals,
        references,
        entry.candidate,
        entry.occurrences,
        selected.length,
        parameters.exactGain
      );
    }
    ranked.sort((left, right) => {
      if (left.gain !== right.gain) return right.gain - left.gain;
      if (left.candidate.termIds.length !== right.candidate.termIds.length) {
        return right.candidate.termIds.length - left.candidate.termIds.length;
      }
      const ordinals = compareOrdinals(
        left.candidate.termOrdinals,
        right.candidate.termOrdinals
      );
      if (ordinals !== 0) return ordinals;
      return phraseKey(left.candidate.termIds).localeCompare(
        phraseKey(right.candidate.termIds)
      );
    });
    const next = ranked.shift();
    if (!next) break;
    if (next.occurrences.length < parameters.minPhraseFrequency) continue;
    if (next.gain < parameters.minPhraseGainBytes) continue;
    const terms = uniqueTermIds(next.candidate.termIds);
    if (
      terms.some(
        (termId) =>
          (fanout.get(termId) ?? 0) + 1 > parameters.maxPhraseFanoutPerTerm
      )
    ) {
      continue;
    }
    const phraseIndex = selected.length;
    selected.push({
      termIds: next.candidate.termIds,
      termOrdinals: next.candidate.termOrdinals,
      documents: occurrencesAsDocuments(next.occurrences),
    });
    for (const termId of terms) {
      fanout.set(termId, (fanout.get(termId) ?? 0) + 1);
      const refs = references.get(termId) ?? [];
      refs.push({
        phraseIndex,
        offsets: termOffsets(next.candidate.termIds, termId),
      });
      references.set(termId, refs);
      literals.set(
        termId,
        removePositions(
          literals.get(termId) ?? [],
          coverageMap(next.occurrences, termId, next.candidate.termIds)
        )
      );
    }
    markCovered(covered, next.occurrences, next.candidate.termIds.length);
  }

  if (selected.length === 0) return empty();
  return {
    used: true,
    parameters,
    literals: streams.map((stream) => ({
      termId: stream.termId,
      term: stream.term,
      documents: literals.get(stream.termId) ?? [],
    })),
    phrases: selected,
    references,
  };
}

export function mergePhrasePositions(
  literal: VqfPhraseDocument[],
  phrases: VqfSelectedPhrase[],
  references: VqfPhraseReference[]
): VqfPhraseDocument[] {
  const merged = new Map<number, Set<number>>();
  const add = (blockId: number, position: number) => {
    let positions = merged.get(blockId);
    if (!positions) {
      positions = new Set();
      merged.set(blockId, positions);
    }
    positions.add(position);
  };
  for (const document of literal) {
    for (const position of document.positions) add(document.blockId, position);
  }
  for (const reference of references) {
    const phrase = phrases[reference.phraseIndex];
    if (!phrase) throw new Error('VQF phrase reference is out of range.');
    for (const offset of reference.offsets) {
      if (offset < 0 || offset >= phrase.termIds.length) {
        throw new Error('VQF phrase term offset is out of range.');
      }
    }
    for (const document of phrase.documents) {
      for (const start of document.positions) {
        for (const offset of reference.offsets)
          add(document.blockId, start + offset);
      }
    }
  }
  return [...merged.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([blockId, positions]) => ({
      blockId,
      positions: [...positions].sort((a, b) => a - b),
    }));
}

export function reconstructLexicalStreams(
  literals: VqfPhraseTermStream[],
  phrases: VqfSelectedPhrase[],
  references: Map<number, VqfPhraseReference[]>
): VqfPhraseTermStream[] {
  return literals.map((stream) => ({
    termId: stream.termId,
    term: stream.term,
    documents: mergePhrasePositions(
      stream.documents,
      phrases,
      references.get(stream.termId) ?? []
    ),
  }));
}

export function phraseSectionOverheadBytes(
  parameters: VqfResolvedPhraseParameters,
  factored: VqfFactoredPhrases
): number {
  if (!factored.used) return 0;
  let size =
    varintSize(parameters.minPhraseLength) +
    varintSize(parameters.maxPhraseLength) +
    varintSize(parameters.minPhraseFrequency) +
    varintSize(parameters.maxPhraseFanoutPerTerm) +
    varintSize(parameters.minPhraseGainBytes) +
    1 +
    varintSize(factored.phrases.length);
  let streamBytes = 0;
  for (const phrase of factored.phrases) {
    const list = postingListSize(phrase.documents);
    size += phraseDirectorySize(
      phrase.termOrdinals,
      streamBytes,
      list,
      phrase.documents.length
    );
    streamBytes += list;
  }
  size += varintSize(streamBytes) + streamBytes;
  for (const stream of factored.literals) {
    size += referenceListSize(factored.references.get(stream.termId) ?? []);
  }
  return size;
}
