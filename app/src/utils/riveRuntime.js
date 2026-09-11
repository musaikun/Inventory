import { Rive, Layout, Fit, Alignment, RuntimeLoader } from '@rive-app/webgl2'
import wasmUrl from '@rive-app/webgl2/rive.wasm?url'
import fallbackWasmUrl from '@rive-app/webgl2/rive_fallback.wasm?url'

// JSとWASMを同じnpm版から配信する。旧端末用fallbackも外部CDNへ出さない。
RuntimeLoader.setWasmUrl(wasmUrl)
RuntimeLoader.setWasmFallbackUrl(fallbackWasmUrl)

export { Rive, Layout, Fit, Alignment }
