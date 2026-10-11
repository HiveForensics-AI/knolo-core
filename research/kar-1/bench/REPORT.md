# KAR-1 hand-authored evidence graphs

This run uses committed graphs only. No compiler, model, or lexical ranker produced the edges. The reference implementation is `research/kar-1`.

Cases: 10. Satisfied: 6. Unsatisfied requirements: 4. Replay mismatches on the grounding case, 100 repeats: 0.

| Case | Status | \|S*\| | Evidence | Non-empty frontiers |
| --- | --- | ---: | --- | --- |
| Supplied grounding room to lodging | SATISFIED | 2 | opp, support | F_S:support F_O:opp |
| Same mask keeps the smaller evidence id | SATISFIED | 1 | a-pass | F_S:a-pass+b-pass |
| Missing opposition abstains | UNSATISFIED_EVIDENCE_REQUIREMENTS | 0 | — | F_S:support |
| Expired opposition abstains | UNSATISFIED_EVIDENCE_REQUIREMENTS | 0 | — | F_S:support F_O:old-opp |
| Authority below the plan minimum abstains | UNSATISFIED_EVIDENCE_REQUIREMENTS | 0 | — | F_S:support F_O:weak-opp |
| Support, opposition, and qualification | SATISFIED | 3 | opp, qual, support | F_S:support F_O:opp F_Q:qual |
| Depth 1 does not take the second hop | UNSATISFIED_EVIDENCE_REQUIREMENTS | 0 | — | F_T:who |
| Depth 2 takes the contradicting hop | SATISFIED | 1 | clause | F_O:clause F_T:who |
| Unmapped decoy stays outside the frontiers | SATISFIED | 2 | opp, support | F_S:support F_O:opp |
| Zero floors are satisfied by the empty set | SATISFIED | 0 | — | F_S:support F_O:opp |

The query `guest cancel room whenever asked` does not contain the node id `lodging`. The plan supplies that grounding. KAR then closes `prohibits` and `permits` from the committed lodging node.

Grounding certificate: `sha256-0336db9e5b84d5b3b4f20e26c4b0588ae50774b438309e6343e6467308d875be`.

