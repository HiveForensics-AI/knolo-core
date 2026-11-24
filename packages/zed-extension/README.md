# Knolo Zed extension

This crate is a Zed context-server extension. It starts the published stdio server:

```sh
npx -y @knolo/mcp@0.2.4 --config /absolute/knolo-mcp.json
```

`config_path` is required. A missing or empty path fails closed. The extension does not install a newer npm release. The server does not listen on a port. There is no remote URL.

The settings snippet users can paste without installing the extension is [`examples/zed/settings.json`](../../examples/zed/settings.json). The integration note is [`docs/integrations/zed.md`](../../docs/integrations/zed.md).

Build the WebAssembly component with:

```sh
cargo build --target wasm32-wasip2 --release --manifest-path packages/zed-extension/Cargo.toml
```
