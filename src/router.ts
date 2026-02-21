import type { AgentDefinitionV1 } from './agent.js';

export interface RouteCandidateV1 {
  agentId: string;
  score: number;
  why?: string;
}

export interface RouteDecisionV1 {
  type: 'route_decision';
  intent?: string;
  entities?: Record<string, unknown>;
  candidates: RouteCandidateV1[];
  selected: string;
  needsTools?: string[];
  risk?: 'low' | 'med' | 'high';
}

export function isRouteDecisionV1(x: unknown): x is RouteDecisionV1 {
  if (!x || typeof x !== 'object') return false;

  const v = x as Partial<RouteDecisionV1>;
  if (v.type !== 'route_decision') return false;
  if (typeof v.selected !== 'string' || !v.selected.trim()) return false;
  if (!Array.isArray(v.candidates) || v.candidates.length < 1) return false;
  if (
    v.needsTools !== undefined &&
    (!Array.isArray(v.needsTools) ||
      v.needsTools.some((toolId) => typeof toolId !== 'string'))
  ) {
    return false;
  }

  for (const candidate of v.candidates) {
    if (!candidate || typeof candidate !== 'object') return false;

    const c = candidate as Partial<RouteCandidateV1>;
    if (typeof c.agentId !== 'string' || !c.agentId.trim()) return false;
    if (typeof c.score !== 'number' || !Number.isFinite(c.score)) return false;
    if (c.score < 0 || c.score > 1) return false;
    if (c.why !== undefined && typeof c.why !== 'string') return false;
  }

  return true;
}

export function validateRouteDecisionV1(
  decision: RouteDecisionV1,
  agentRegistry: Record<string, AgentDefinitionV1>
): { ok: true } | { ok: false; error: string } {
  if (!agentRegistry[decision.selected]) {
    return {
      ok: false,
      error: `selected agent is not registered: ${decision.selected}`,
    };
  }

  const seen = new Set<string>();
  for (const candidate of decision.candidates) {
    if (seen.has(candidate.agentId)) {
      return {
        ok: false,
        error: `duplicate candidate agentId: ${candidate.agentId}`,
      };
    }
    seen.add(candidate.agentId);

    if (!agentRegistry[candidate.agentId]) {
      return {
        ok: false,
        error: `candidate agent is not registered: ${candidate.agentId}`,
      };
    }
  }

  return { ok: true };
}

export function selectAgentIdFromRouteDecisionV1(
  decision: RouteDecisionV1,
  agentRegistry: Record<string, AgentDefinitionV1>,
  opts: { fallbackAgentId?: string } = {}
): { agentId: string; reason: 'selected' | 'top_candidate' | 'fallback' } {
  if (agentRegistry[decision.selected]) {
    return { agentId: decision.selected, reason: 'selected' };
  }

  const sortedCandidates = [...decision.candidates].sort(
    (a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId)
  );
  for (const candidate of sortedCandidates) {
    if (agentRegistry[candidate.agentId]) {
      return { agentId: candidate.agentId, reason: 'top_candidate' };
    }
  }

  if (opts.fallbackAgentId && agentRegistry[opts.fallbackAgentId]) {
    return { agentId: opts.fallbackAgentId, reason: 'fallback' };
  }

  const defaultAgentId = Object.keys(agentRegistry).sort()[0];
  if (defaultAgentId) {
    return { agentId: defaultAgentId, reason: 'fallback' };
  }

  return { agentId: '', reason: 'fallback' };
}
