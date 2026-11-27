import {
  mountKnowledgeImageV5,
  queryKnowledgeImageV5,
  verifyKnowledgeImageV5,
} from '@knolo/core';

export type MountedImage = ReturnType<typeof mountKnowledgeImageV5>;
export type Verification = ReturnType<typeof verifyKnowledgeImageV5>;

export type DemoHit = {
  objectId: string;
  sourceTitle: string;
  sourcePath: string;
  snippet: string;
};

export async function fetchFixtureBytes(): Promise<Uint8Array> {
  const response = await fetch('/demo-image.v5');

  if (!response.ok) {
    throw new Error(`Unable to load the demo fixture (${response.status}).`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

export function verifyAndMount(bytes: Uint8Array): {
  verification: Verification;
  image: MountedImage;
} {
  const verification = verifyKnowledgeImageV5(bytes);
  const image = mountKnowledgeImageV5(bytes);

  return { verification, image };
}

function escapeEqlString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export function queryAndResolve(image: MountedImage, input: string): DemoHit[] {
  const query = input.trim();

  if (!query) {
    throw new Error('Enter a search query.');
  }

  const result = queryKnowledgeImageV5(
    image,
    `FROM chunk SEARCH "${escapeEqlString(query)}" LIMIT 5`
  );

  const objectsById = new Map(
    image.objects.map((object) => [object.id, object])
  );
  const sourcesById = new Map<string, (typeof image.objects)[number]>();

  for (const object of image.objects) {
    const sourceId = object.meta.sourceId;

    if (object.kind === 'source' && typeof sourceId === 'string') {
      sourcesById.set(sourceId, object);
    }
  }

  const decoder = new TextDecoder();

  return result.hits.map((hit) => {
    const chunk = objectsById.get(hit.objectId);

    if (!chunk || chunk.kind !== 'chunk') {
      throw new Error(`Query result ${hit.objectId} is not a chunk.`);
    }

    const sourceId = chunk.meta.sourceId;

    if (typeof sourceId !== 'string') {
      throw new Error(`Chunk ${chunk.id} has no sourceId metadata.`);
    }

    const source = sourcesById.get(sourceId);

    if (!source) {
      throw new Error(`No source object is linked to chunk ${chunk.id}.`);
    }

    const title = source.meta.title;

    if (typeof title !== 'string') {
      throw new Error(`Source ${sourceId} has no title metadata.`);
    }

    const path =
      typeof source.meta.path === 'string' ? source.meta.path : sourceId;
    const text = decoder.decode(chunk.bytes);

    return {
      objectId: hit.objectId,
      sourceTitle: title,
      sourcePath: path,
      snippet: text.length > 320 ? `${text.slice(0, 317)}...` : text,
    };
  });
}
