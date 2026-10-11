export const BOUNDS = {
  maxAnchorNodes: 8,
  maxClosureNodes: 32,
  maxClosureEdges: 64,
  maxFrontierEvidence: 16,
  maxRequirementsPerFrontier: 8,
  maxEvidenceBindings: 32,
  maxCoverVisits: 10000,
};

const EMPTY_REQUIREMENTS = { F_S: [], F_O: [], F_Q: [], F_T: [], F_A: [] };
const ZERO_FLOORS = { F_S: '0', F_O: '0', F_Q: '0', F_T: '0', F_A: '0' };

function requirements(patch) {
  return { ...EMPTY_REQUIREMENTS, ...patch };
}

function floors(patch) {
  return { ...ZERO_FLOORS, ...patch };
}

function supplied(nodeId, queryTerm) {
  return { mode: 'supplied', witness: [{ nodeId, queryTerm }] };
}

export const SCENARIOS = [
  {
    id: 'support-opposition',
    query: 'Can the customer cancel the room?',
    documents: [
      {
        label: 'general-policy',
        source: 'front-desk/cancellation-policy',
        text: 'A guest may cancel a lodging reservation before the day of arrival and receive the deposit back.',
      },
      {
        label: 'enterprise-clause',
        source: 'contracts/enterprise-lodging',
        text: 'An enterprise lodging commitment cannot be cancelled after the agreement is signed.',
      },
    ],
    nodes: ['lodging', 'general-policy', 'enterprise-clause'],
    relations: [
      { id: 'r-permit', from: 'lodging', relation: 'permits', to: 'general-policy' },
      { id: 'r-prohibit', from: 'lodging', relation: 'prohibits', to: 'enterprise-clause' },
    ],
    bindings: [
      { id: 'b-policy', nodeId: 'general-policy', evidence: 'general-policy', requirements: ['cancel-allowed'], provenance: 'hand:general-policy' },
      { id: 'b-enterprise', nodeId: 'enterprise-clause', evidence: 'enterprise-clause', requirements: ['commitment-bars-cancel'], provenance: 'hand:enterprise-clause' },
    ],
    frontierMap: { permits: 'F_S', prohibits: 'F_O' },
    requirements: requirements({ F_S: ['cancel-allowed'], F_O: ['commitment-bars-cancel'] }),
    floors: floors({ F_S: '1', F_O: '1' }),
    cases: [
      {
        name: 'support-opposition',
        patch: {},
        status: 'SATISFIED',
        selection: { kind: 'labels', labels: ['general-policy', 'enterprise-clause'] },
        frontiers: { F_S: ['general-policy'], F_O: ['enterprise-clause'], F_Q: [], F_T: [], F_A: [] },
      },
      {
        name: 'supplied-suite',
        patch: { anchor: supplied('lodging', 'suite') },
        status: 'SATISFIED',
        selection: { kind: 'labels', labels: ['general-policy', 'enterprise-clause'] },
        frontiers: { F_S: ['general-policy'], F_O: ['enterprise-clause'], F_Q: [], F_T: [], F_A: [] },
      },
      {
        name: 'recompute-misses-room',
        patch: { anchor: { mode: 'recompute', procedure: 'member-id-v1' } },
        status: 'UNSATISFIED_EVIDENCE_REQUIREMENTS',
        selection: { kind: 'labels', labels: [] },
        frontiers: { F_S: [], F_O: [], F_Q: [], F_T: [], F_A: [] },
      },
    ],
  },
  {
    id: 'support-opposition-qualifier',
    query: 'Can the customer cancel the room?',
    documents: [
      {
        label: 'general-policy',
        source: 'front-desk/standard-policy',
        text: 'The standard lodging policy permits the customer to cancel before the arrival date.',
      },
      {
        label: 'contradicting-agreement',
        source: 'contracts/group-agreement',
        text: 'The signed group agreement prohibits cancellation once the room block is confirmed.',
      },
      {
        label: 'grandfathered-amendment',
        source: 'contracts/grandfathered-amendment',
        text: 'Bookings made before the amendment keep the former cancellation window.',
      },
    ],
    nodes: ['lodging', 'general-policy', 'contradicting-agreement', 'grandfathered-amendment'],
    relations: [
      { id: 'r-permit', from: 'lodging', relation: 'permits', to: 'general-policy' },
      { id: 'r-prohibit', from: 'lodging', relation: 'prohibits', to: 'contradicting-agreement' },
      { id: 'r-qualify', from: 'lodging', relation: 'qualifies', to: 'grandfathered-amendment' },
    ],
    bindings: [
      { id: 'b-general', nodeId: 'general-policy', evidence: 'general-policy', requirements: ['standard-cancel'], provenance: 'hand:general-policy' },
      { id: 'b-agreement', nodeId: 'contradicting-agreement', evidence: 'contradicting-agreement', requirements: ['agreement-bars'], provenance: 'hand:agreement' },
      { id: 'b-amendment', nodeId: 'grandfathered-amendment', evidence: 'grandfathered-amendment', requirements: ['grandfather-window'], provenance: 'hand:amendment' },
    ],
    frontierMap: { permits: 'F_S', prohibits: 'F_O', qualifies: 'F_Q' },
    requirements: requirements({ F_S: ['standard-cancel'], F_O: ['agreement-bars'], F_Q: ['grandfather-window'] }),
    floors: floors({ F_S: '1', F_O: '1', F_Q: '1' }),
    cases: [
      {
        name: 'support-opposition-qualifier',
        patch: {},
        status: 'SATISFIED',
        selection: { kind: 'labels', labels: ['general-policy', 'contradicting-agreement', 'grandfathered-amendment'] },
        frontiers: {
          F_S: ['general-policy'],
          F_O: ['contradicting-agreement'],
          F_Q: ['grandfathered-amendment'],
          F_T: [],
          F_A: [],
        },
      },
    ],
  },
  {
    id: 'temporal-applicability',
    query: 'Which cancellation rule applies to the lodging?',
    documents: [
      {
        label: 'old-rule',
        source: 'policy/cancellation-2020',
        text: 'Until 2024 a customer could cancel a lodging reservation on the day of arrival.',
      },
      {
        label: 'current-rule',
        source: 'policy/cancellation-2024',
        text: 'From 2024 through 2026 a customer may cancel a lodging reservation until the day before arrival.',
      },
      {
        label: 'future-rule',
        source: 'policy/cancellation-2027',
        text: 'Beginning in 2027 a lodging cancellation requires fourteen days of notice.',
      },
    ],
    nodes: ['lodging', 'old-rule', 'current-rule', 'future-rule'],
    relations: [
      { id: 'r-old', from: 'lodging', relation: 'permits', to: 'old-rule' },
      { id: 'r-current', from: 'lodging', relation: 'permits', to: 'current-rule' },
      { id: 'r-future', from: 'lodging', relation: 'permits', to: 'future-rule' },
    ],
    bindings: [
      { id: 'b-old', nodeId: 'old-rule', evidence: 'old-rule', requirements: ['rule'], validFrom: '2020-01-01', validUntil: '2024-01-01', provenance: 'hand:old-rule' },
      { id: 'b-current', nodeId: 'current-rule', evidence: 'current-rule', requirements: ['rule'], validFrom: '2024-01-01', validUntil: '2027-01-01', provenance: 'hand:current-rule' },
      { id: 'b-future', nodeId: 'future-rule', evidence: 'future-rule', requirements: ['rule'], validFrom: '2027-01-01', provenance: 'hand:future-rule' },
    ],
    frontierMap: { permits: 'F_S' },
    requirements: requirements({ F_S: ['rule'] }),
    floors: floors({ F_S: '1' }),
    cases: [
      {
        name: 'temporal-2023-06-15',
        patch: { asOf: '2023-06-15' },
        status: 'SATISFIED',
        selection: { kind: 'labels', labels: ['old-rule'] },
        frontiers: { F_S: ['old-rule', 'current-rule', 'future-rule'], F_O: [], F_Q: [], F_T: [], F_A: [] },
      },
      {
        name: 'temporal-2024-01-01',
        patch: { asOf: '2024-01-01' },
        status: 'SATISFIED',
        selection: { kind: 'labels', labels: ['current-rule'] },
        frontiers: { F_S: ['old-rule', 'current-rule', 'future-rule'], F_O: [], F_Q: [], F_T: [], F_A: [] },
      },
      {
        name: 'temporal-2026-10-10',
        patch: { asOf: '2026-10-10' },
        status: 'SATISFIED',
        selection: { kind: 'labels', labels: ['current-rule'] },
        frontiers: { F_S: ['old-rule', 'current-rule', 'future-rule'], F_O: [], F_Q: [], F_T: [], F_A: [] },
      },
      {
        name: 'temporal-2027-03-01',
        patch: { asOf: '2027-03-01' },
        status: 'SATISFIED',
        selection: { kind: 'labels', labels: ['future-rule'] },
        frontiers: { F_S: ['old-rule', 'current-rule', 'future-rule'], F_O: [], F_Q: [], F_T: [], F_A: [] },
      },
    ],
  },
  {
    id: 'authority',
    query: 'May the desk cancel a confirmed lodging?',
    documents: [
      {
        label: 'statute',
        source: 'authority/enterprise-statute',
        text: 'A recorded enterprise statute prohibits unilateral cancellation of a confirmed lodging.',
      },
      {
        label: 'memo',
        source: 'authority/staff-memo',
        text: 'An internal staff memo says the desk should refuse same-day cancellation requests.',
      },
      {
        label: 'general-policy',
        source: 'front-desk/manual',
        text: 'The front desk manual describes how a customer asks to cancel a room.',
      },
    ],
    nodes: ['lodging', 'statute', 'memo', 'general-policy'],
    relations: [
      { id: 'r-statute', from: 'lodging', relation: 'prohibits', to: 'statute' },
      { id: 'r-memo', from: 'lodging', relation: 'prohibits', to: 'memo' },
      { id: 'r-policy', from: 'lodging', relation: 'permits', to: 'general-policy' },
    ],
    bindings: [
      { id: 'b-statute', nodeId: 'statute', evidence: 'statute', requirements: ['bars-cancel'], authority: 80, provenance: 'hand:statute' },
      { id: 'b-memo', nodeId: 'memo', evidence: 'memo', requirements: ['bars-cancel'], authority: 20, provenance: 'hand:memo' },
      { id: 'b-policy', nodeId: 'general-policy', evidence: 'general-policy', requirements: ['how-to-ask'], provenance: 'hand:manual' },
    ],
    frontierMap: { prohibits: 'F_O', permits: 'F_S' },
    requirements: requirements({ F_O: ['bars-cancel'] }),
    floors: floors({ F_O: '1' }),
    cases: [
      {
        name: 'authority-any',
        patch: { minAuthority: null },
        status: 'SATISFIED',
        selection: { kind: 'lex-min', labels: ['statute', 'memo'] },
        frontiers: { F_S: ['general-policy'], F_O: ['statute', 'memo'], F_Q: [], F_T: [], F_A: [] },
      },
      {
        name: 'authority-50',
        patch: { minAuthority: 50 },
        status: 'SATISFIED',
        selection: { kind: 'labels', labels: ['statute'] },
        frontiers: { F_S: ['general-policy'], F_O: ['statute', 'memo'], F_Q: [], F_T: [], F_A: [] },
      },
      {
        name: 'authority-100',
        patch: { minAuthority: 100 },
        status: 'UNSATISFIED_EVIDENCE_REQUIREMENTS',
        selection: { kind: 'labels', labels: [] },
        frontiers: { F_S: ['general-policy'], F_O: ['statute', 'memo'], F_Q: [], F_T: [], F_A: [] },
      },
    ],
  },
  {
    id: 'genuine-gap',
    query: 'Can the customer cancel the room?',
    documents: [
      {
        label: 'general-policy',
        source: 'front-desk/cancellation-policy',
        text: 'A guest may cancel a lodging reservation before the day of arrival and receive the deposit back.',
      },
      {
        label: 'brochure',
        source: 'marketing/welcome-brochure',
        text: 'The welcome brochure describes the room, the view, and the breakfast hour.',
      },
    ],
    nodes: ['lodging', 'general-policy', 'brochure'],
    relations: [
      { id: 'r-permit', from: 'lodging', relation: 'permits', to: 'general-policy' },
      { id: 'r-mention', from: 'lodging', relation: 'mentions', to: 'brochure' },
    ],
    bindings: [
      { id: 'b-policy', nodeId: 'general-policy', evidence: 'general-policy', requirements: ['cancel-allowed'], provenance: 'hand:general-policy' },
      { id: 'b-brochure', nodeId: 'brochure', evidence: 'brochure', requirements: ['amenities'], provenance: 'hand:brochure' },
    ],
    frontierMap: { permits: 'F_S', prohibits: 'F_O' },
    requirements: requirements({ F_S: ['cancel-allowed'], F_O: ['commitment-bars-cancel'] }),
    floors: floors({ F_S: '1', F_O: '1' }),
    cases: [
      {
        name: 'genuine-gap',
        patch: {},
        status: 'UNSATISFIED_EVIDENCE_REQUIREMENTS',
        selection: { kind: 'labels', labels: [] },
        frontiers: { F_S: ['general-policy'], F_O: [], F_Q: [], F_T: [], F_A: [] },
      },
    ],
  },
];

export function buildPlan(spec, patch = {}) {
  return {
    version: 1,
    anchor: supplied('lodging', 'room'),
    frontierMap: spec.frontierMap,
    depth: 1,
    cardinalityBound: 5,
    coverageMode: 'requirements',
    requirements: spec.requirements,
    floors: spec.floors,
    profile: 'minimum-cover',
    asOf: '2026-10-10',
    minAuthority: null,
    bounds: BOUNDS,
    lexical: null,
    ...patch,
  };
}
