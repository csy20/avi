import { create } from 'zustand'

interface WaveformState {
  peaks: Record<string, number[]>
  setPeaks: (assetId: string, peaks: number[]) => void
}

export const useWaveformStore = create<WaveformState>((set) => ({
  peaks: {},
  setPeaks: (assetId, peaks) =>
    set((state) => ({
      peaks: {
        ...state.peaks,
        [assetId]: peaks,
      },
    })),
}))

const PEAK_COUNT = 160

export async function peaksFromAudioBuffer(buffer: AudioBuffer): Promise<number[]> {
  const channel = buffer.getChannelData(0)
  const block = Math.max(1, Math.floor(channel.length / PEAK_COUNT))
  const peaks: number[] = []

  for (let index = 0; index < PEAK_COUNT; index += 1) {
    const start = index * block
    let max = 0
    const end = Math.min(channel.length, start + block)
    for (let sample = start; sample < end; sample += 16) {
      max = Math.max(max, Math.abs(channel[sample] ?? 0))
    }
    peaks.push(Number(max.toFixed(4)))
  }

  return peaks
}

export async function peaksFromArrayBuffer(bytes: ArrayBuffer): Promise<number[] | null> {
  const context = new AudioContext()
  try {
    const audio = await context.decodeAudioData(bytes.slice(0))
    return peaksFromAudioBuffer(audio)
  } catch {
    return null
  } finally {
    await context.close()
  }
}
