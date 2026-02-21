import { existsSync } from 'node:fs';
import path from 'node:path';
import { mountPack, query } from '@knolo/core';

const PACK_PATH = path.resolve(process.cwd(), 'dist/knowledge.knolo');

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (!message) {
    return Response.json({ error: 'message is required' }, { status: 400 });
  }

  if (!existsSync(PACK_PATH)) {
    return Response.json(
      {
        error:
          'Knowledge pack not found at dist/knowledge.knolo. Run "npm run knolo:build" and retry.',
      },
      { status: 400 }
    );
  }

  const kb = await mountPack({ src: PACK_PATH });
  const hits = query(kb, message, { topK: 4 }).map((hit) => ({
    title: kb.headings?.[hit.blockId] || hit.source || `Block ${hit.blockId}`,
    path: kb.docIds?.[hit.blockId] || hit.source,
    score: hit.score,
    snippet: hit.text.replace(/\s+/g, ' ').slice(0, 220),
  }));

  const answer =
    hits.length > 0
      ? `Based on your docs, here are the most relevant passages:\n\n${hits
          .map((hit, index) => `${index + 1}. ${hit.snippet}`)
          .join('\n')}`
      : 'I could not find relevant passages in /docs yet. Add docs and rebuild the pack.';

  return Response.json({ answer, hits });
}
