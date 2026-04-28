/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DFX_NETWORK?: string;
  readonly VITE_IC_HOST?: string;
  readonly VITE_KNOLO_CANISTER_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __KNOLO_CANISTER_ID__: string | undefined;
declare const __KNOLO_DFX_NETWORK__: string;
