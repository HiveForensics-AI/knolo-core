import { mountPack, query } from '@knolo/core';

export class KnoLoRetriever {
  constructor({ packPath, pack, topK = 5 } = {}) {
    this.packPath = packPath;
    this.pack = pack;
    this.topK = topK;
    this._packPromise = null;
  }

  async _getPack() {
    if (this.pack) return this.pack;
    if (!this._packPromise) {
      if (!this.packPath) {
        throw new Error('KnoLoRetriever requires either pack or packPath.');
      }
      this._packPromise = mountPack({ src: this.packPath });
    }
    this.pack = await this._packPromise;
    return this.pack;
  }

  async retrieve(queryText) {
    const pack = await this._getPack();
    const hits = query(pack, queryText, { topK: this.topK });
    return hits.map((hit) => ({
      node: {
        text: hit.text,
        metadata: {
          score: hit.score,
          source: hit.source ?? null,
          namespace: hit.namespace ?? null,
          id: hit.blockId,
        },
      },
      score: hit.score,
    }));
  }
}
