import { readFile } from 'node:fs/promises';
import { mountPack, queryWithReceipt, verifyReceipt } from '../packages/core/dist/index.js';

export async function evaluatePack(packBytes, queries) {
  const pack = await mountPack({ src: packBytes });
  const rows = [];
  for (const spec of queries) {
    const result = queryWithReceipt(pack, spec.query, spec.options ?? {});
    verifyReceipt(result.receipt, pack);
    const hits = result.hits.map((hit) => ({ id: hit.source ?? `block:${hit.blockId}`, blockId: hit.blockId, score: Number(hit.score.toFixed(6)) }));
    rows.push({ id: spec.id, query: spec.query, hits, decision: result.receipt.decision, planHash: result.receipt.plan.planHash, receiptVerified: true, metrics: retrievalMetrics(hits, spec.relevant ?? []) });
  }
  return { contract: 'retrieval-v4.0', packVersion: pack.meta.version, packFormat: pack.meta.format ?? `v${pack.meta.version}`, aggregate: aggregateMetrics(rows), rows };
}

export async function loadQueries(path) {
  const raw = await readFile(path, 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function retrievalMetrics(hits, relevant) {
  const wanted = new Set(relevant); const ranked = hits.map((hit) => hit.id);
  const relevantHits = ranked.filter((id) => wanted.has(id));
  const recallAtK = wanted.size ? relevantHits.length / wanted.size : (ranked.length ? 0 : 1);
  const first = ranked.findIndex((id) => wanted.has(id));
  const dcg = ranked.reduce((sum, id, index) => sum + (wanted.has(id) ? 1 / Math.log2(index + 2) : 0), 0);
  const ideal = [...wanted].slice(0, ranked.length).reduce((sum, _id, index) => sum + 1 / Math.log2(index + 2), 0);
  return { recallAtK: Number(recallAtK.toFixed(6)), reciprocalRank: first < 0 ? 0 : Number((1 / (first + 1)).toFixed(6)), ndcgAtK: Number((ideal ? dcg / ideal : ranked.length ? 0 : 1).toFixed(6)), hitCount: ranked.length, relevantCount: relevantHits.length };
}

function aggregateMetrics(rows) {
  const total = rows.length || 1;
  const mean = (field) => Number((rows.reduce((sum, row) => sum + row.metrics[field], 0) / total).toFixed(6));
  const abstentionRows = rows.filter((row) => row.decision !== 'answer');
  const correctAbstentions = abstentionRows.filter((row) => row.metrics.relevantCount === 0).length;
  return { recallAtK: mean('recallAtK'), mrrAtK: mean('reciprocalRank'), ndcgAtK: mean('ndcgAtK'), meanHitCount: mean('hitCount'), answerCount: rows.filter((row) => row.decision === 'answer').length, abstentionCount: abstentionRows.length, abstentionPrecision: Number((abstentionRows.length ? correctAbstentions / abstentionRows.length : 1).toFixed(6)), receiptsVerified: rows.every((row) => row.receiptVerified) };
}
