# KIP-0017: Sync Wire Codec V1

Status: foundation implementation

KIP-0017 defines the transport-neutral byte boundary for the authenticated
KIP-0014 messages. Signed requests and responses are encoded as canonical CBOR
maps containing the complete message, including the signature and embedded
sync summary. Decoding requires the exact V1 field set, canonical encoding,
valid digest and summary structure, and a maximum wire size of 1 MiB.

The codec does not frame streams, open sockets, transfer object bytes, or
select a network protocol. Hosts may carry the resulting bytes over any
transport, then invoke the existing signature and exchange verification before
admitting or applying data.
