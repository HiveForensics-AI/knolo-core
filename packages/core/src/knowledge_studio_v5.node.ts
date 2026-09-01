import {
  inspectKnowledgeStudioManagementV5,
  type KnowledgeStudioManagementInputV1,
  type KnowledgeStudioManagementV1,
} from './knowledge_studio_v5.js';

export type KnowledgeStudioServiceRequestV1 = {
  method: string;
  url: string;
};

export type KnowledgeStudioServiceOptionsV1 = {
  load: () =>
    | KnowledgeStudioManagementInputV1
    | Promise<KnowledgeStudioManagementInputV1>;
  authorizeRead?: (
    request: KnowledgeStudioServiceRequestV1
  ) => boolean | Promise<boolean>;
  path?: string;
};

export type KnowledgeStudioServiceV1 = {
  snapshot(): Promise<KnowledgeStudioManagementV1>;
  handle(request: Request): Promise<Response>;
};

const DEFAULT_STUDIO_PATH = '/studio/v5';
const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
};

/**
 * Create the host-facing, read-only V5 Studio service.
 *
 * The service deliberately exposes no mutation route. A host may still put
 * its own authorization and audit policy in front of reads through
 * `authorizeRead`; any future write surface must be added by a separate,
 * explicitly authorized host adapter rather than inferred from this service.
 */
export function createKnowledgeStudioServiceV5(
  options: KnowledgeStudioServiceOptionsV1
): KnowledgeStudioServiceV1 {
  const path = options.path ?? DEFAULT_STUDIO_PATH;
  if (!path.startsWith('/') || path.endsWith('/')) {
    throw new Error(
      'V5 Studio service path must be an absolute, normalized path.'
    );
  }

  const snapshot = async (): Promise<KnowledgeStudioManagementV1> =>
    inspectKnowledgeStudioManagementV5(await options.load());

  const json = (
    body: unknown,
    status: number,
    extraHeaders: Record<string, string> = {}
  ) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...JSON_HEADERS, ...extraHeaders },
    });

  const handle = async (request: Request): Promise<Response> => {
    let pathname: string;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return json({ error: 'invalid_request_url' }, 400);
    }

    const method = request.method.toUpperCase();
    if (pathname !== path) return json({ error: 'not_found' }, 404);
    if (method !== 'GET' && method !== 'HEAD') {
      return json({ error: 'studio_management_is_read_only' }, 405, {
        allow: 'GET, HEAD',
      });
    }

    if (
      options.authorizeRead &&
      !(await options.authorizeRead({ method, url: request.url }))
    ) {
      return json({ error: 'studio_read_not_authorized' }, 403);
    }

    try {
      const body = JSON.stringify(await snapshot());
      return new Response(method === 'HEAD' ? null : body, {
        status: 200,
        headers: { ...JSON_HEADERS, allow: 'GET, HEAD' },
      });
    } catch {
      return json({ error: 'studio_snapshot_unavailable' }, 503);
    }
  };

  return { snapshot, handle };
}
