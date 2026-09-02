# V5 coordination and authorized operations

V5 durable storage remains a single committed image with detached snapshot
readers. The Node durable store now has an opt-in lease mode for hosts that
need bounded writer ownership:

```ts
import { DurableKnowledgeImageStoreV5 } from '@knolo/core/node';

const store = DurableKnowledgeImageStoreV5.open('./knowledge.v5', image, {
  lease: {
    ownerId: 'knowledge-host-1',
    ttlMs: 30_000,
    now: () => Date.now(),
  },
});
```

The lease is recorded beside the image in the existing `.lock` path. A second
writer is rejected while the lease is live. Store operations check the lease
before reading or mutating state, and `renew()` must be called before expiry.
Renewal is fenced to the private record created by the owning process, so a
stale owner cannot overwrite a successor after explicit recovery replaces the
published lease record.
The image itself is still replaced with a temp-file, fsync, and rename sequence;
the committed bytes are never updated in place.

Expiry is not permission to delete a lock automatically. A host must opt into
recovery by opening with `recoverStale: true`, or call
`recoverStaleWriterLeaseV5(path + '.lock', now)` after its stale-writer policy
has confirmed that the recorded lease has expired. Malformed records and live
leases remain errors. The lease is a local coordination primitive, not a
distributed consensus protocol or an authority credential.

## Authorized mutation boundary

`executeKnowledgeAuthorizedOperationV5` provides one host-owned authorization
and audit gate for `commit`, `merge`, `policy`, `authority`, and `sync`
operations. It validates the operation envelope, records the allow/deny event,
and invokes the supplied mutation only after approval. Policy and authority
administration handlers remain host-owned; the core does not invent a service,
credential store, or implicit Studio write route. The existing Studio service
therefore remains read-only.

Commit and merge callers should pass the pre-operation state root and, for a
planned merge or sync, the verified plan root. Diverged images must continue
through the explicit merge planner and resolution authorization. No V5 path
performs silent last-write-wins replacement.

## Production sync apply path

`executeKnowledgeSyncHostDeploymentV5` performs discovery, bounded resumable
transfer, response/image verification, expiry handling, replay protection, and
monitoring. The Node-only
`executeKnowledgeSyncHostFastForwardV5` then computes the local plan and applies
the verified image only when the host authorizes the `sync` operation. It
rejects anything that is not a direct `remote-ahead` fast-forward, leaving
divergent merge resolution to an explicit authorized operation.

Sockets, credentials, endpoint routing, checkpoint persistence, monitoring
sinks, and deployment scheduling remain outside `@knolo/core`. The reference
in-memory adapter exists for deterministic tests and local integration only.

## Recovery evidence

Phase 3 tests cover live writer exclusion, lease renewal and expiry, explicit
stale recovery, atomic temp-file crash leftovers, detached readers, denied
operation auditing, and authorized production sync application. The full V5
release gate remains the required check before the next runtime-profile phase.
