---
name: knolo-code
description: Retrieve workspace code from the local Knolo code image before reading whole files. Use when navigating, explaining, or editing functions, classes, exports, or route handlers.
user-invocable: true
---

# Knolo code image

The host owns the model. These tools are a local lexical index. They do not call an embedding service and they do not send the workspace off the machine.

Before reading whole source files for a navigation, explanation, or edit task:

1. Call `code_image_status`.
2. If `built` is false, call `code_image_build` on the workspace root.
3. Call `code_image_structure` for the file path or symbol.
4. Call `code_image_query` with `topK` 5. Leave query expansion off. The tool already does.
5. Call `code_image_expand` only for one chunk id that the task must see in full.

Pass `root` only when the workspace is not the working directory of the MCP server. The image and pin are written to `<root>/.knolo/`.

A result with `ok: false` stops the lookup. Report the `error` code. Do not replace a failed receipt by reading that same range from disk. `CODE_PIN_MISMATCH` and `CODE_RECEIPT` mean the image is not safe to use until it is rebuilt.

`code-image-tokens-v1` estimates tokens as `ceil(utf8ByteLength / 4)` of the returned chunk text. It is the comparison unit for savings. It is not a model tokenizer.

Structure text is signatures only. Prefer it over a full file. Expand one chunk instead of asking for every hit at once. A truncated result lists ids and asks for `code_image_expand`.
