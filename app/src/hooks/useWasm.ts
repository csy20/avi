import { useState, useEffect } from 'react'
import type {
  grayscale       as GrayscaleFn,
  invert          as InvertFn,
  brightness      as BrightnessFn,
  sepia           as SepiaFn,
  frame_luma_stats as FrameLumaStatsFn,
  color_matrix as ColorMatrixFn,
} from '../wasm-pkg/avi_wasm'

// ── Public API surface exposed by the WASM module ────────────────────────────
export interface WasmApi {
  grayscale:        typeof GrayscaleFn
  invert:           typeof InvertFn
  brightness:       typeof BrightnessFn
  sepia:            typeof SepiaFn
  color_matrix:     typeof ColorMatrixFn
  frame_luma_stats: typeof FrameLumaStatsFn
}

export type WasmStatus = 'loading' | 'ready' | 'error'

interface UseWasmReturn {
  status: WasmStatus
  error:  string | null
  api:    WasmApi | null
}

const normalizeWasmError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }

  if (typeof error === 'string') {
    return new Error(error)
  }

  return new Error('WASM operation failed')
}

const wrapWasmCall = <TArgs extends readonly unknown[], TResult>(
  fn: (...args: TArgs) => TResult
) =>
  ((...args: TArgs): TResult => {
    try {
      return fn(...args)
    } catch (error) {
      throw normalizeWasmError(error)
    }
  })

let cachedWasmApi: WasmApi | null = null
let wasmInitPromise: Promise<WasmApi> | null = null

export const loadWasmApi = async (): Promise<WasmApi> => {
  if (cachedWasmApi) {
    return cachedWasmApi
  }

  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      const mod = await import('../wasm-pkg/avi_wasm.js')
      await mod.default()

      if (typeof mod.init_panic_hook === 'function') {
        mod.init_panic_hook()
      }

      cachedWasmApi = {
        grayscale: wrapWasmCall(mod.grayscale),
        invert: wrapWasmCall(mod.invert),
        brightness: wrapWasmCall(mod.brightness),
        sepia: wrapWasmCall(mod.sepia),
        color_matrix: wrapWasmCall(mod.color_matrix),
        frame_luma_stats: wrapWasmCall(mod.frame_luma_stats),
      }

      return cachedWasmApi
    })().catch((error) => {
      wasmInitPromise = null
      throw error
    })
  }

  return wasmInitPromise
}

/**
 * Asynchronously loads and initialises the avi-wasm WebAssembly module.
 * The module is loaded once and cached via ref — safe to call from any component.
 */
export const useWasm = (): UseWasmReturn => {
  const [status, setStatus] = useState<WasmStatus>(cachedWasmApi ? 'ready' : 'loading')
  const [error,  setError]  = useState<string | null>(null)
  const [api, setApi] = useState<WasmApi | null>(cachedWasmApi)

  useEffect(() => {
    if (cachedWasmApi) {
      setApi(cachedWasmApi)
      setStatus('ready')
      setError(null)
      return
    }

    let cancelled = false
    setStatus('loading')
    setError(null)

    ;(async () => {
      try {
        const loadedApi = await loadWasmApi()
        if (!cancelled) {
          setApi(loadedApi)
          setStatus('ready')
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(normalizeWasmError(e).message)
          setStatus('error')
        }
      }
    })()

    return () => { cancelled = true }
  }, [])

  return { status, error, api }
}
