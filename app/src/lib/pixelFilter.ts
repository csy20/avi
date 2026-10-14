import { loadWasmApi } from '../hooks/useWasm'

export const PIXEL_FILTERS = ['grayscale', 'sepia', 'invert', 'brightness', 'warm'] as const

export type PixelFilterName = (typeof PIXEL_FILTERS)[number]

const WARM_MATRIX = new Float32Array([
  1.08, 0, 0, 0, 0.02,
  0, 1, 0, 0, 0,
  0, 0, 0.9, 0, 0,
  0, 0, 0, 1, 0,
])

export function cssFilterFor(filter: PixelFilterName): string {
  switch (filter) {
    case 'grayscale':
      return 'grayscale(1)'
    case 'sepia':
      return 'sepia(1)'
    case 'invert':
      return 'invert(1)'
    case 'brightness':
      return 'brightness(1.5)'
    case 'warm':
      return 'sepia(0.25) saturate(1.15)'
  }
}

export function isPixelFilter(value: string): value is PixelFilterName {
  return (PIXEL_FILTERS as readonly string[]).includes(value)
}

export async function applyPixelFilter(pixels: Uint8Array, filter: PixelFilterName): Promise<Uint8Array> {
  const api = await loadWasmApi()
  switch (filter) {
    case 'grayscale':
      return api.grayscale(pixels)
    case 'sepia':
      return api.sepia(pixels)
    case 'invert':
      return api.invert(pixels)
    case 'brightness':
      return api.brightness(pixels, 1.5)
    case 'warm':
      return api.color_matrix(pixels, WARM_MATRIX)
  }
}
