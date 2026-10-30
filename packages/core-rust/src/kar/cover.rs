//! Exact minimum cover. Combinations are visited smallest size first.
//! A visit above `maxCoverVisits` is `SEARCH_BOUND_EXCEEDED`.

use std::collections::BTreeSet;

use crate::kar::closure::Admission;
use crate::kar::json::{digest_json, utf16_cmp, Json};
use crate::kar::model::{floor_micros, lookup_floor, lookup_requirement, Plan, FRONTIERS};

#[derive(Debug, Clone)]
pub struct Choice {
    pub evidence_id: String,
    pub frontiers: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct CoveragePair {
    pub covered: i64,
    pub required: i64,
}

#[derive(Debug, Clone)]
pub struct Rational {
    pub numerator: i64,
    pub denominator: i64,
}

#[derive(Debug, Clone)]
pub struct Decision {
    pub status: String,
    pub profile: String,
    pub cardinality: i64,
    pub coverage: Vec<(String, CoveragePair)>,
    pub redundancy: Option<Rational>,
}

#[derive(Debug, Clone)]
pub struct CoverOutcome {
    pub status: String,
    pub evidence_ids: Vec<String>,
    pub choices: Vec<Choice>,
    pub decision: Decision,
}

#[derive(Clone)]
struct Candidate {
    id: String,
    mask: String,
    requirements: Vec<(String, BTreeSet<String>)>,
    nonempty: BTreeSet<String>,
    tokens: Vec<String>,
    bits: Vec<(String, BTreeSet<usize>)>,
}

struct Rat {
    n: i128,
    d: i128,
}

pub fn select_cover(
    plan: &Plan,
    admissions: &[Admission],
    texts: &[(String, String)],
) -> CoverOutcome {
    let micros = frontier_micros(plan);
    let base = build_candidates(plan, admissions, texts);
    let pool = minimum_cover_pool(plan, &base);
    let limit = plan.bounds.max_cover_visits;
    let mut visits: i64 = 0;
    let max_size = plan.cardinality_bound.min(pool.len() as i64).max(0) as usize;

    if plan.profile == "minimum-cover" {
        for size in 0..=max_size {
            let mut matched = None;
            let exceeded = visit_combinations(&pool, size, &mut visits, limit, |combo| {
                let scored = coverage_of(plan, combo, &micros);
                if scored.ok {
                    matched = Some((combo.to_vec(), scored.pairs));
                    true
                } else {
                    false
                }
            });
            if exceeded {
                return finish(plan, "SEARCH_BOUND_EXCEEDED", &[], &zero_pairs(plan), None);
            }
            if let Some((combo, pairs)) = matched {
                return finish(plan, "SATISFIED", &combo, &pairs, None);
            }
        }
        return finish(
            plan,
            "UNSATISFIED_EVIDENCE_REQUIREMENTS",
            &[],
            &zero_pairs(plan),
            None,
        );
    }

    let mut best: Option<ScoredCombo> = None;
    for size in 0..=max_size {
        let mut feasible = Vec::new();
        let exceeded = visit_combinations(&pool, size, &mut visits, limit, |combo| {
            let scored = coverage_of(plan, combo, &micros);
            if scored.ok {
                feasible.push(ScoredCombo {
                    combo: combo.to_vec(),
                    pairs: scored.pairs,
                    counts: scored.counts,
                });
            }
            false
        });
        if exceeded {
            return finish(plan, "SEARCH_BOUND_EXCEEDED", &[], &zero_pairs(plan), None);
        }
        if plan.profile == "minimum-cover-redundancy-v1" && !feasible.is_empty() {
            feasible.sort_by(|left, right| {
                let order = compare_rat(&redundancy(&left.combo), &redundancy(&right.combo));
                if order != std::cmp::Ordering::Equal {
                    return order;
                }
                utf16_cmp(&join_ids(&left.combo), &join_ids(&right.combo))
            });
            let winner = &feasible[0];
            let redundant = redundancy(&winner.combo);
            return finish(
                plan,
                "SATISFIED",
                &winner.combo,
                &winner.pairs,
                Some(redundant),
            );
        }
        if plan.profile == "exp1-lexicographic" {
            for item in feasible {
                let replace = match &best {
                    None => true,
                    Some(current) => better_exp1(&item, current),
                };
                if replace {
                    best = Some(item);
                }
            }
        }
    }
    if let Some(best) = best {
        return finish(plan, "SATISFIED", &best.combo, &best.pairs, None);
    }
    finish(
        plan,
        "UNSATISFIED_EVIDENCE_REQUIREMENTS",
        &[],
        &zero_pairs(plan),
        None,
    )
}

struct ScoredCombo {
    combo: Vec<Candidate>,
    pairs: Vec<(String, CoveragePair)>,
    counts: Vec<(String, i64)>,
}

pub fn covers_plan(
    plan: &Plan,
    admissions: &[Admission],
    texts: &[(String, String)],
    evidence_ids: &[String],
) -> bool {
    let micros = frontier_micros(plan);
    let base = build_candidates(plan, admissions, texts);
    let chosen: Vec<Candidate> = base
        .into_iter()
        .filter(|candidate| evidence_ids.iter().any(|id| id == &candidate.id))
        .collect();
    coverage_of(plan, &chosen, &micros).ok
}

fn frontier_micros(plan: &Plan) -> Vec<(String, i64)> {
    FRONTIERS
        .iter()
        .map(|frontier| {
            (
                (*frontier).to_string(),
                floor_micros(lookup_floor(plan, frontier)).unwrap_or(0),
            )
        })
        .collect()
}

fn visit_combinations(
    pool: &[Candidate],
    size: usize,
    visits: &mut i64,
    limit: i64,
    mut on_combo: impl FnMut(&[Candidate]) -> bool,
) -> bool {
    if size == 0 {
        *visits += 1;
        if *visits > limit {
            return true;
        }
        on_combo(&[]);
        return false;
    }
    if size > pool.len() {
        return false;
    }
    let mut index: Vec<usize> = (0..size).collect();
    loop {
        *visits += 1;
        if *visits > limit {
            return true;
        }
        let combo: Vec<Candidate> = index.iter().map(|offset| pool[*offset].clone()).collect();
        if on_combo(&combo) {
            return false;
        }
        if !next_combination(&mut index, pool.len()) {
            return false;
        }
    }
}

fn next_combination(index: &mut [usize], n: usize) -> bool {
    let size = index.len();
    let mut cursor = size as isize - 1;
    while cursor >= 0 && index[cursor as usize] == n - size + cursor as usize {
        cursor -= 1;
    }
    if cursor < 0 {
        return false;
    }
    index[cursor as usize] += 1;
    let mut next = cursor as usize + 1;
    while next < size {
        index[next] = index[next - 1] + 1;
        next += 1;
    }
    true
}

fn build_candidates(
    plan: &Plan,
    admissions: &[Admission],
    texts: &[(String, String)],
) -> Vec<Candidate> {
    let mut grouped: Vec<Candidate> = Vec::new();
    for admission in admissions {
        if !admission.applicable {
            continue;
        }
        if !grouped
            .iter()
            .any(|candidate| candidate.id == admission.evidence_id)
        {
            grouped.push(Candidate {
                id: admission.evidence_id.clone(),
                mask: String::new(),
                requirements: Vec::new(),
                nonempty: BTreeSet::new(),
                tokens: ascii_tokens(
                    texts
                        .iter()
                        .find(|(id, _)| id == &admission.evidence_id)
                        .map(|(_, text)| text.as_str())
                        .unwrap_or(""),
                ),
                bits: Vec::new(),
            });
        }
        let candidate = grouped
            .iter_mut()
            .find(|candidate| candidate.id == admission.evidence_id)
            .unwrap();
        candidate.nonempty.insert(admission.frontier.clone());
        if let Some((_, bucket)) = candidate
            .requirements
            .iter_mut()
            .find(|(frontier, _)| frontier == &admission.frontier)
        {
            for requirement in &admission.requirements {
                bucket.insert(requirement.clone());
            }
        } else {
            candidate.requirements.push((
                admission.frontier.clone(),
                admission.requirements.iter().cloned().collect(),
            ));
        }
    }
    let mut candidates: Vec<Candidate> = grouped
        .into_iter()
        .filter(|candidate| {
            if plan.coverage_mode == "nonempty" {
                !candidate.nonempty.is_empty()
            } else {
                !mask_key(&candidate.requirements, &candidate.nonempty, plan).is_empty()
            }
        })
        .collect();
    for candidate in &mut candidates {
        candidate.mask = mask_key(&candidate.requirements, &candidate.nonempty, plan);
        candidate.bits = requirement_bits(plan, &candidate.requirements);
    }
    candidates.sort_by(|left, right| utf16_cmp(&left.id, &right.id));
    candidates
}

fn minimum_cover_pool(plan: &Plan, base: &[Candidate]) -> Vec<Candidate> {
    if plan.profile != "minimum-cover" {
        return base.to_vec();
    }
    let mut best: Vec<Candidate> = Vec::new();
    for candidate in base {
        if let Some(current) = best.iter_mut().find(|item| item.mask == candidate.mask) {
            if utf16_cmp(&candidate.id, &current.id) == std::cmp::Ordering::Less {
                *current = candidate.clone();
            }
        } else {
            best.push(candidate.clone());
        }
    }
    best.sort_by(|left, right| utf16_cmp(&left.id, &right.id));
    best
}

fn mask_key(
    requirements: &[(String, BTreeSet<String>)],
    nonempty: &BTreeSet<String>,
    plan: &Plan,
) -> String {
    if plan.coverage_mode == "nonempty" {
        let mut ids: Vec<&str> = nonempty.iter().map(String::as_str).collect();
        ids.sort_by(|left, right| utf16_cmp(left, right));
        return ids.join(",");
    }
    let mut parts = Vec::new();
    for frontier in FRONTIERS {
        let mut ids: Vec<&str> = requirements
            .iter()
            .find(|(name, _)| name == frontier)
            .map(|(_, set)| {
                set.iter()
                    .filter(|id| {
                        lookup_requirement(plan, frontier)
                            .iter()
                            .any(|required| required == *id)
                    })
                    .map(String::as_str)
                    .collect()
            })
            .unwrap_or_default();
        ids.sort_by(|left, right| utf16_cmp(left, right));
        if !ids.is_empty() {
            parts.push(format!("{frontier}={}", ids.join("+")));
        }
    }
    parts.join("|")
}

fn requirement_bits(
    plan: &Plan,
    requirements: &[(String, BTreeSet<String>)],
) -> Vec<(String, BTreeSet<usize>)> {
    let mut bits = Vec::new();
    for frontier in FRONTIERS {
        let mut mask = BTreeSet::new();
        if plan.coverage_mode == "requirements" {
            if let Some((_, have)) = requirements.iter().find(|(name, _)| name == frontier) {
                for (index, requirement) in lookup_requirement(plan, frontier).iter().enumerate() {
                    if have.contains(requirement) {
                        mask.insert(index);
                    }
                }
            }
        }
        bits.push(((*frontier).to_string(), mask));
    }
    bits
}

struct Scored {
    pairs: Vec<(String, CoveragePair)>,
    ok: bool,
    counts: Vec<(String, i64)>,
}

fn coverage_of(plan: &Plan, chosen: &[Candidate], micros: &[(String, i64)]) -> Scored {
    let mut pairs = Vec::new();
    let mut counts = Vec::new();
    let mut ok = true;
    for frontier in FRONTIERS {
        let required_list = lookup_requirement(plan, frontier);
        let (covered, required) = if plan.coverage_mode == "requirements" {
            let required = required_list.len() as i64;
            let covered = if required == 0 {
                0
            } else {
                let mut mask = BTreeSet::new();
                for candidate in chosen {
                    if let Some((_, bits)) =
                        candidate.bits.iter().find(|(name, _)| name == frontier)
                    {
                        mask.extend(bits.iter().copied());
                    }
                }
                mask.len() as i64
            };
            (covered, required)
        } else {
            let covered = if chosen
                .iter()
                .any(|candidate| candidate.nonempty.contains(frontier))
            {
                1
            } else {
                0
            };
            (covered, 1)
        };
        let micro = micros
            .iter()
            .find(|(name, _)| name == frontier)
            .map(|(_, value)| *value)
            .unwrap_or(0);
        if !passes(covered, required, micro) {
            ok = false;
        }
        pairs.push(((*frontier).to_string(), CoveragePair { covered, required }));
        counts.push(((*frontier).to_string(), covered));
    }
    Scored { pairs, ok, counts }
}

fn passes(covered: i64, required: i64, micros: i64) -> bool {
    if required == 0 {
        return true;
    }
    (covered as i128) * 1_000_000 >= (micros as i128) * (required as i128)
}

fn zero_pairs(plan: &Plan) -> Vec<(String, CoveragePair)> {
    FRONTIERS
        .iter()
        .map(|frontier| {
            let required = if plan.coverage_mode == "requirements" {
                lookup_requirement(plan, frontier).len() as i64
            } else {
                1
            };
            (
                (*frontier).to_string(),
                CoveragePair {
                    covered: 0,
                    required,
                },
            )
        })
        .collect()
}

fn finish(
    plan: &Plan,
    status: &str,
    combo: &[Candidate],
    pairs: &[(String, CoveragePair)],
    redundant: Option<Rat>,
) -> CoverOutcome {
    let mut evidence_ids: Vec<String> =
        combo.iter().map(|candidate| candidate.id.clone()).collect();
    evidence_ids.sort_by(|left, right| utf16_cmp(left, right));
    let choices = evidence_ids
        .iter()
        .map(|evidence_id| {
            let candidate = combo.iter().find(|item| &item.id == evidence_id).unwrap();
            let mut frontiers: Vec<String> = candidate.nonempty.iter().cloned().collect();
            frontiers.sort_by(|left, right| utf16_cmp(left, right));
            Choice {
                evidence_id: evidence_id.clone(),
                frontiers,
            }
        })
        .collect();
    let recorded = if status == "SATISFIED" {
        coverage_of(plan, combo, &frontier_micros(plan)).pairs
    } else {
        zero_pairs(plan)
    };
    let _ = pairs;
    let decision = Decision {
        status: status.to_string(),
        profile: plan.profile.clone(),
        cardinality: if status == "SATISFIED" {
            evidence_ids.len() as i64
        } else {
            0
        },
        coverage: recorded,
        redundancy: if status == "SATISFIED" && plan.profile == "minimum-cover-redundancy-v1" {
            redundant.map(|value| Rational {
                numerator: value.n as i64,
                denominator: value.d as i64,
            })
        } else {
            None
        },
    };
    CoverOutcome {
        status: status.to_string(),
        evidence_ids,
        choices,
        decision,
    }
}

pub fn decision_json(decision: &Decision) -> Json {
    let mut pairs = vec![
        ("cardinality".to_string(), Json::Int(decision.cardinality)),
        (
            "coverage".to_string(),
            Json::Object(
                decision
                    .coverage
                    .iter()
                    .map(|(frontier, pair)| {
                        (
                            frontier.clone(),
                            Json::object(vec![
                                ("covered", Json::Int(pair.covered)),
                                ("required", Json::Int(pair.required)),
                            ]),
                        )
                    })
                    .collect(),
            ),
        ),
        (
            "profile".to_string(),
            Json::String(decision.profile.clone()),
        ),
        ("status".to_string(), Json::String(decision.status.clone())),
    ];
    if let Some(redundancy) = &decision.redundancy {
        pairs.push((
            "redundancy".to_string(),
            Json::object(vec![
                ("denominator", Json::Int(redundancy.denominator)),
                ("numerator", Json::Int(redundancy.numerator)),
            ]),
        ));
    }
    Json::Object(pairs)
}

pub fn choices_json(choices: &[Choice]) -> Json {
    Json::Array(
        choices
            .iter()
            .map(|choice| {
                Json::object(vec![
                    ("evidenceId", Json::String(choice.evidence_id.clone())),
                    (
                        "frontiers",
                        Json::Array(choice.frontiers.iter().cloned().map(Json::String).collect()),
                    ),
                ])
            })
            .collect(),
    )
}

pub fn evidence_set_root(choices: &[Choice]) -> String {
    digest_json(&choices_json(choices))
}

pub fn decision_root(decision: &Decision) -> String {
    digest_json(&decision_json(decision))
}

fn ascii_tokens(text: &str) -> Vec<String> {
    let folded: String = text
        .chars()
        .map(|ch| {
            if ch.is_ascii_uppercase() {
                char::from(ch as u8 + 32)
            } else {
                ch
            }
        })
        .collect();
    folded
        .split(|ch: char| !(ch.is_ascii_digit() || ('a'..='z').contains(&ch)))
        .filter(|token| !token.is_empty())
        .map(|token| token.to_string())
        .collect()
}

fn redundancy(items: &[Candidate]) -> Rat {
    if items.len() < 2 {
        return Rat { n: 0, d: 1 };
    }
    let mut sum_n = 0i128;
    let mut sum_d = 1i128;
    let mut pairs = 0i128;
    for i in 0..items.len() {
        for j in (i + 1)..items.len() {
            let part = jaccard(&items[i].tokens, &items[j].tokens);
            sum_n = sum_n * part.d + part.n * sum_d;
            sum_d *= part.d;
            let g = gcd(sum_n, sum_d);
            sum_n /= g;
            sum_d /= g;
            pairs += 1;
        }
    }
    reduce(sum_n, pairs * sum_d)
}

fn jaccard(left_tokens: &[String], right_tokens: &[String]) -> Rat {
    let left: BTreeSet<&str> = left_tokens.iter().map(String::as_str).collect();
    let right: BTreeSet<&str> = right_tokens.iter().map(String::as_str).collect();
    if left.is_empty() && right.is_empty() {
        return Rat { n: 1, d: 1 };
    }
    let inter = left.iter().filter(|token| right.contains(*token)).count() as i128;
    let union = left.len() as i128 + right.len() as i128 - inter;
    if union == 0 {
        Rat { n: 0, d: 1 }
    } else {
        Rat { n: inter, d: union }
    }
}

fn gcd(a: i128, b: i128) -> i128 {
    let mut x = a.abs();
    let mut y = b.abs();
    while y != 0 {
        let next = x % y;
        x = y;
        y = next;
    }
    if x == 0 {
        1
    } else {
        x
    }
}

fn reduce(mut n: i128, mut d: i128) -> Rat {
    if d < 0 {
        n = -n;
        d = -d;
    }
    let g = gcd(n, d);
    Rat { n: n / g, d: d / g }
}

fn compare_rat(left: &Rat, right: &Rat) -> std::cmp::Ordering {
    (left.n * right.d).cmp(&(right.n * left.d))
}

fn join_ids(combo: &[Candidate]) -> String {
    combo
        .iter()
        .map(|item| item.id.as_str())
        .collect::<Vec<_>>()
        .join("\0")
}

fn better_exp1(left: &ScoredCombo, right: &ScoredCombo) -> bool {
    for frontier in ["F_O", "F_S", "F_Q", "F_T", "F_A"] {
        let left_count = count_of(&left.counts, frontier);
        let right_count = count_of(&right.counts, frontier);
        if left_count != right_count {
            return left_count > right_count;
        }
    }
    if left.combo.len() != right.combo.len() {
        return left.combo.len() < right.combo.len();
    }
    utf16_cmp(&join_ids(&left.combo), &join_ids(&right.combo)) == std::cmp::Ordering::Less
}

fn count_of(counts: &[(String, i64)], frontier: &str) -> i64 {
    counts
        .iter()
        .find(|(name, _)| name == frontier)
        .map(|(_, value)| *value)
        .unwrap_or(0)
}
