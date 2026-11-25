// A failed ESM graph stays cached for the exact URLs that failed. Retrying
// only the entry file links it against those failed dependencies and reports
// a missing export that the built file has. Copy the entry's knolo-epoch
// query onto every other file in that dist tree so the retry is a new graph.

export async function resolve(specifier, context, nextResolve) {
  const next = await nextResolve(specifier, context);
  const parent = context.parentURL;
  if (!parent) return next;
  let epoch;
  try {
    epoch = new URL(parent).searchParams.get('knolo-epoch');
  } catch {
    return next;
  }
  if (!epoch) return next;
  let nextUrl;
  let parentUrl;
  try {
    nextUrl = new URL(next.url);
    parentUrl = new URL(parent);
  } catch {
    return next;
  }
  if (nextUrl.protocol !== 'file:') return next;
  const distAt = parentUrl.pathname.lastIndexOf('/dist/');
  if (distAt < 0) return next;
  const distRoot = parentUrl.pathname.slice(0, distAt + '/dist/'.length);
  if (!nextUrl.pathname.startsWith(distRoot)) return next;
  if (nextUrl.searchParams.get('knolo-epoch') === epoch) return next;
  nextUrl.searchParams.set('knolo-epoch', epoch);
  return { format: next.format, shortCircuit: true, url: nextUrl.href };
}
