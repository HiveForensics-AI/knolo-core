import { buildPack, mountPack, query } from '../dist/index.js';

const docs = [{ id: 'smoke', text: 'smoke test content' }];
const bytes = await buildPack(docs);
const pack = await mountPack({ src: bytes });
const hits = query(pack, 'smoke');
if (!hits.length) {
  throw new Error('smoke query returned no hits');
}
console.log('smoke ok');
