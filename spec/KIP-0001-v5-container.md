# KIP-0001: V5 Knowledge Image container

Status: implemented foundation contract

## File layout

All integer fields are little-endian. The file starts with a 16-byte header:

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 8 | `KNLOV5\0\0` magic |
| 8 | 2 | format version `5` |
| 10 | 2 | flags, initially `0` |
| 12 | 2 | superblock size `128` |
| 14 | 2 | reserved, must be `0` |

Two 128-byte superblocks follow at offsets 16 and 144. Segments begin at
offset 272 and are concatenated without padding.

## Superblocks

Each superblock contains:

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 8 | `KNLOSB1\0` magic |
| 8 | 8 | monotonically increasing generation |
| 16 | 8 | commit segment offset |
| 24 | 8 | commit segment length |
| 32 | 32 | commit digest |
| 64 | 32 | state root |
| 96 | 32 | digest of bytes 0–95 under `knolo:superblock:v1` |

The highest-generation superblock whose bounds, digest, commit pointer, and
state root verify is active. An invalid newer superblock is ignored in favor
of the last valid one.

## Segments

Every segment has a 48-byte header followed by its payload:

| Offset | Size | Field |
| ---: | ---: | --- |
| 0 | 4 | `KSEG` magic |
| 4 | 1 | kind: `1` objects, `2` events, `3` commit, `128+` optional |
| 5 | 1 | schema version, initially `1` |
| 6 | 2 | flags, initially `0` |
| 8 | 8 | payload length |
| 16 | 32 | digest of payload under `knolo:segment:v1` |

Required kinds 1, 2, and 3 occur exactly once. Unknown optional kinds are
accepted and skipped. All offsets and lengths must remain within the file,
payloads must be canonical CBOR, and segment digests must verify.

The commit segment is the superblock target. Its payload is a canonical CBOR
map containing the fields in KIP-0002, including the object and event segment
digests.
