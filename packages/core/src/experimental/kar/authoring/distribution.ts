import { sha256Hex } from '../../../utils/sha256.js';
import { canonicalize, digest } from '../canonicalize.js';
import { semanticRootOf } from '../graph.js';
import { createKarSession } from '../session.js';
import { KarError, type KarSidecarV1 } from '../types.js';
import { validateKarSidecar } from '../validate.js';
import type { KarImageInput } from '../v5.js';
import { openEvidenceCatalog } from './catalog.js';
import { KAR_DISTRIBUTION_FORMAT } from './constants.js';
import { diagnostic, type CegDiagnostic } from './diagnostics.js';
import type { CegBuildRecord } from './compile.js';

export type KarDistributionManifest = {
  format: typeof KAR_DISTRIBUTION_FORMAT;
  image: {
    file: string;
    stateRoot: string;
    objectRoot: string;
    commitDigest: string;
    knowledgeRoot: string;
    sha256: string;
  };
  kar: {
    file: string;
    semanticRoot: string;
    sha256: string;
  };
};

export function hashBytes(bytes: Uint8Array): string {
  return `sha256-${sha256Hex(bytes)}`;
}

export function buildDistributionFiles(input: {
  image: Uint8Array;
  graphBytes: Uint8Array;
  graph: unknown;
}): { ok: true; manifest: KarDistributionManifest; files: Record<string, Uint8Array> } | { ok: false; diagnostics: CegDiagnostic[] } {
  const opened = openEvidenceCatalog(input.image);
  if (!opened.ok) return opened;
  const sidecar = validateKarSidecar(input.graph);
  if (!sidecar.ok) {
    return { ok: false, diagnostics: sidecar.errors.map((error) => diagnostic('error', error.code, error.path, error.message)) };
  }
  const mismatch = bindingMismatch(sidecar.value, opened.catalog);
  if (mismatch) return { ok: false, diagnostics: [mismatch] };
  const semanticRoot = semanticRootOf(sidecar.value.graph);
  const manifest: KarDistributionManifest = {
    format: KAR_DISTRIBUTION_FORMAT,
    image: {
      file: 'knowledge.knolo',
      stateRoot: opened.catalog.stateRoot,
      objectRoot: opened.catalog.objectRoot,
      commitDigest: opened.catalog.commitDigest,
      knowledgeRoot: opened.catalog.knowledgeRoot,
      sha256: hashBytes(input.image),
    },
    kar: {
      file: 'knowledge.kar.json',
      semanticRoot,
      sha256: hashBytes(input.graphBytes),
    },
  };
  const encoder = new TextEncoder();
  return {
    ok: true,
    manifest,
    files: {
      'knowledge.knolo': input.image,
      'knowledge.kar.json': input.graphBytes,
      'kar-manifest.json': encoder.encode(`${canonicalize(manifest)}\n`),
    },
  };
}

export function loadKarBundle(input: {
  image: Uint8Array;
  graph: unknown;
  manifest: unknown;
  graphBytes?: Uint8Array;
}): { ok: true; semanticRoot: string; manifest: KarDistributionManifest } | { ok: false; diagnostics: CegDiagnostic[] } {
  const manifest = interpretManifest(input.manifest);
  if (!manifest.ok) return manifest;
  if (hashBytes(input.image) !== manifest.value.image.sha256) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_MANIFEST_MISMATCH', 'image.sha256', 'Image bytes do not match the distribution manifest.')] };
  }
  if (input.graphBytes && hashBytes(input.graphBytes) !== manifest.value.kar.sha256) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_MANIFEST_MISMATCH', 'kar.sha256', 'CEG bytes do not match the distribution manifest.')] };
  }
  try {
    const session = createKarSession({ image: input.image, graph: input.graph });
    if (session.image.stateRoot !== manifest.value.image.stateRoot
      || session.image.objectRoot !== manifest.value.image.objectRoot
      || session.image.commitDigest !== manifest.value.image.commitDigest
      || session.image.knowledgeRoot !== manifest.value.image.knowledgeRoot
      || session.roots.semanticRoot !== manifest.value.kar.semanticRoot) {
      return { ok: false, diagnostics: [diagnostic('error', 'CEG_MANIFEST_MISMATCH', 'manifest', 'Manifest roots do not match the mounted image and CEG.')] };
    }
    return { ok: true, semanticRoot: session.roots.semanticRoot, manifest: manifest.value };
  } catch (error) {
    if (error instanceof KarError) {
      const stale = error.code === 'KAR_GRAPH_NOT_BOUND';
      return {
        ok: false,
        diagnostics: [diagnostic(
          'error',
          stale ? 'CEG_STALE_IMAGE' : error.code,
          'graph',
          stale ? 'CEG was compiled against a different image state. Recompile from the CEG Source.' : error.message,
        )],
      };
    }
    throw error;
  }
}

export function checkCegFreshness(input: { image: KarImageInput; graph: unknown }): { ok: true; semanticRoot: string } | { ok: false; diagnostics: CegDiagnostic[] } {
  const opened = openEvidenceCatalog(input.image);
  if (!opened.ok) return opened;
  const sidecar = validateKarSidecar(input.graph);
  if (!sidecar.ok) {
    return { ok: false, diagnostics: sidecar.errors.map((error) => diagnostic('error', error.code, error.path, error.message)) };
  }
  const mismatch = bindingMismatch(sidecar.value, opened.catalog);
  if (mismatch) {
    return {
      ok: false,
      diagnostics: [diagnostic('error', 'CEG_STALE_IMAGE', mismatch.path, 'CEG was compiled against a different image state. Recompile from the CEG Source.')],
    };
  }
  const unresolved = sidecar.value.graph.bindings.some((binding) => !opened.catalog.objects.some((object) => object.id === binding.evidenceId));
  if (unresolved) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_EVIDENCE_NOT_FOUND', 'bindings', 'A binding names evidence that is not in this image.')] };
  }
  return { ok: true, semanticRoot: semanticRootOf(sidecar.value.graph) };
}

export function validateCegBuild(input: {
  image: KarImageInput;
  graph: unknown;
  build: unknown;
  graphBytes?: Uint8Array;
}): { ok: true; semanticRoot: string } | { ok: false; diagnostics: CegDiagnostic[] } {
  const fresh = checkCegFreshness(input);
  if (!fresh.ok) return fresh;
  const build = interpretBuild(input.build);
  if (!build.ok) return build;
  const sidecar = validateKarSidecar(input.graph);
  if (!sidecar.ok) return { ok: false, diagnostics: sidecar.errors.map((error) => diagnostic('error', error.code, error.path, error.message)) };
  const diagnostics: CegDiagnostic[] = [];
  if (build.value.identity.semanticRoot !== fresh.semanticRoot) {
    diagnostics.push(diagnostic('error', 'CEG_IMAGE_MISMATCH', 'identity.semanticRoot', 'Build record semanticRoot does not match the graph.'));
  }
  if (build.value.identity.sidecarDigest !== digest(sidecar.value)) {
    diagnostics.push(diagnostic('error', 'CEG_IMAGE_MISMATCH', 'identity.sidecarDigest', 'Build record sidecar digest does not match the graph.'));
  }
  if (build.value.identity.image.knowledgeRoot !== sidecar.value.knowledgeRoot
    || build.value.identity.image.stateRoot !== sidecar.value.stateRoot) {
    diagnostics.push(diagnostic('error', 'CEG_IMAGE_MISMATCH', 'identity.image', 'Build record image identity does not match the sidecar.'));
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, semanticRoot: fresh.semanticRoot };
}

function bindingMismatch(
  sidecar: KarSidecarV1,
  catalog: { stateRoot: string; objectRoot: string; commitDigest: string; knowledgeRoot: string },
): CegDiagnostic | null {
  if (sidecar.stateRoot !== catalog.stateRoot || sidecar.objectRoot !== catalog.objectRoot || sidecar.commitDigest !== catalog.commitDigest) {
    return diagnostic('error', 'CEG_IMAGE_MISMATCH', 'stateRoot', 'Sidecar image roots do not match the mounted Knowledge Image.');
  }
  if (sidecar.knowledgeRoot !== catalog.knowledgeRoot || sidecar.graph.knowledgeRoot !== catalog.knowledgeRoot) {
    return diagnostic('error', 'CEG_IMAGE_MISMATCH', 'knowledgeRoot', 'Sidecar knowledgeRoot does not match the frozen KAR projection.');
  }
  return null;
}

function interpretManifest(value: unknown): { ok: true; value: KarDistributionManifest } | { ok: false; diagnostics: CegDiagnostic[] } {
  if (!value || typeof value !== 'object') {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_MANIFEST_MISMATCH', '', 'Distribution manifest must be an object.')] };
  }
  const record = value as Partial<KarDistributionManifest>;
  if (record.format !== KAR_DISTRIBUTION_FORMAT || !record.image || !record.kar) {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_MANIFEST_MISMATCH', 'format', 'Manifest format must be kar-distribution-1.')] };
  }
  return { ok: true, value: record as KarDistributionManifest };
}

function interpretBuild(value: unknown): { ok: true; value: CegBuildRecord } | { ok: false; diagnostics: CegDiagnostic[] } {
  if (!value || typeof value !== 'object' || (value as { format?: string }).format !== 'ceg-build-1') {
    return { ok: false, diagnostics: [diagnostic('error', 'CEG_SOURCE_INVALID', 'build', 'Build record format must be ceg-build-1.')] };
  }
  return { ok: true, value: value as CegBuildRecord };
}
