import {
  mountKnowledgeImageV5,
  mountPack,
  query,
  queryKnowledgeImageV5,
} from '@knolo/core';

export class KnoLoRetriever {
  constructor({ packPath, pack, imagePath, image, topK = 5 } = {}) {
    this.packPath = packPath;
    this.pack = pack;
    this.imagePath = imagePath;
    this.image = image;
    this.topK = topK;
    this._packPromise = null;
    this._imagePromise = null;
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

  async _getImage() {
    if (this.image) return this.image;
    if (!this._imagePromise) {
      if (!this.imagePath) {
        throw new Error('KnoLoRetriever requires either image or imagePath.');
      }
      this._imagePromise = import('node:fs/promises')
        .then(({ readFile }) => readFile(this.imagePath))
        .then((bytes) => mountKnowledgeImageV5(bytes));
    }
    this.image = await this._imagePromise;
    return this.image;
  }

  async retrieve(queryText) {
    if (this.image || this.imagePath) return this._getV5Results(queryText);
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

  async _getV5Results(queryText) {
    if (!queryText.trim()) return [];
    const image = await this._getImage();
    const result = queryKnowledgeImageV5(
      image,
      `FROM * SEARCH "${escapeEqlString(queryText)}" LIMIT ${Math.min(Math.max(this.topK, 1), 1000)}`,
    );
    const objects = new Map(image.objects.map((object) => [object.id, object]));
    return result.hits.map((hit) => {
      const object = objects.get(hit.objectId);
      return {
        node: {
          text: object ? new TextDecoder().decode(object.bytes) : '',
          metadata: {
            id: hit.objectId,
            kind: hit.kind,
            score: 1,
            source: null,
            namespace: null,
            compatibility: 'knowledge-image-v5',
            v5Query: {
              version: result.version,
              stateRoot: result.stateRoot,
              planRoot: result.planRoot,
              resultRoot: result.resultRoot,
            },
          },
        },
        score: 1,
      };
    });
  }
}

function escapeEqlString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
