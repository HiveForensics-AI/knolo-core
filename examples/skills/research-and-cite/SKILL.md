---
name: research-and-cite
description: Search a pinned Knowledge Image, cite the receipt, and package the findings.
---

# research-and-cite

The host owns the model. This skill does not call one.

1. Search the pinned image before answering.
2. Include the receipt id in the reply.
3. A receipt is an integrity check. It does not mean a claim is proven. SATISFIED means the evidence requirements were met.
4. Do not skip the pin. Do not invent a passage.
5. Package the files you used with `knolo research package`. Pass `--cite` and `--trace` together when a Cortex trace exists. Pass `--graph` when that trace records KAR evaluations.
6. Leave publishing to `knolo publish` after `knolo verify`.
