# Persona packs

A persona pack is a V5 Knowledge Image of one creator's voice. `knolo persona`
builds it with the current image, retrieval, and KITE surfaces. Knolo core does
not call a model. The host owns the model. There is no new MCP tool.

```bash
knolo persona init ada-voice
knolo persona build ada-voice --out ada-voice/dist/ada-voice.knolo
knolo persona verify ada-voice/dist/ada-voice.knolo
knolo persona eval ada-voice/dist/ada-voice.knolo --fixtures ada-voice/fixtures.json
```

`init` refuses to replace an existing directory. It writes a profile, a
disclosure line, boundary lines, two style exemplars, a consent manifest, a
fixture file, and `creator-private.pem`. The private key is not an image
object. The default disclosure line is `This chatbot is AI and is not the creator.`

`build` signs the consent manifest with that key. The signature covers the
SHA-256 of the canonical manifest with the signature field left out. The same
directory produces the same state root. The pin is that state root. `build`
does not write the signature back into `consent.json`. A missing private key
fails with `missing creator signature`. A public key that does not match the
private key fails with `invalid creator signature`. A source marked as
third-party correspondence, such as a message from a fan, client, or student,
fails unless that source has a consent record naming the person and the allowed
use. The pack cannot train or fine-tune a model.

Style exemplars are ordinary chunk objects tagged by situation, such as
`greeting` or `faq`. Retrieval uses an EQL `SEARCH` plan. That plan matches
terms as substrings. Each excerpt is addressed by object id and SHA-256.
Profile text, the disclosure line, and the boundary lines are chunks too.

The KITE contract, the KITE rules, and the signed consent manifest are metadata
objects. KITE searches chunk text, so those records cannot satisfy their own
obligations. The contract asks the pack to state its disclosure and hard
boundaries. The search terms are `chatbot`, `human creator`, `invent prices`,
and `banned topics`. An EQL `SEARCH` plan matches each word as a substring, so
those words have to stay in the disclosure line and the boundary lines.
`verify` remounts the image, checks the pin, checks the creator signature, and
replays the KITE certificate. A KITE verdict describes the contract. It does
not mean the claim is true. Unmet obligations fail `verify`.

A receipt is an integrity check. It does not mean a claim is proven.
`SATISFIED` means the evidence requirements were met.

Opt out by deleting the withdrawn file, adding its source id to
`consent.withdrawn`, and building again. The new image has a new pin. `verify`
fails when a withdrawn source id is still present. `verify --withdrawn <id>`
adds another id for that check. There is no hosted takedown service.

`eval` scores fixture replies for length, emoji rate, greeting and sign-off,
catchphrase use, and banned-topic leaks. It prints a score and a receipt of the
excerpt ids and the state root. It does not train and it does not call a model.

The host adapter is [examples/persona-chat](../../examples/persona-chat/README.md).
It sends only verified excerpts and the profile to the caller's
OpenAI-compatible endpoint. If evidence is missing or an obligation is unmet,
the model is not called. A reply that omits the disclosure line is refused.
