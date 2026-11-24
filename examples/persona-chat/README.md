# Persona chat

This adapter mounts a local persona pack, checks style excerpts, and runs the
pack's KITE boundary contract. Knolo core does not call a model. The host owns
the model.

```bash
knolo persona init ada-voice
knolo persona build ada-voice
node examples/persona-chat/chat.mjs ada-voice/dist/ada-voice.knolo \
  --situation greeting \
  --prompt "Hello" \
  --evidence
```

`--evidence` prints the disclosure line and the excerpt digests. It does not
call a model. A missing exemplar, a banned topic in the prompt, or an unmet
obligation does not call a model. A reply that omits the disclosure line is
refused.

The default endpoint is the same one `knolo ask` uses:
`http://127.0.0.1:11434/v1`. `--model` or `KNOLO_MODEL` selects the model.
`KNOLO_MODEL_API_KEY` is sent only to that endpoint.

A receipt is an integrity check. It does not mean a claim is proven.
`SATISFIED` means the evidence requirements were met. A KITE verdict describes
the contract. It does not mean the claim is true.

See [Persona packs](../../docs/guides/persona-packs.md).
