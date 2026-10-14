import type { Track } from '../store/useEditorStore'

export const LOCAL_PROJECT_ID = 'local'
const STORAGE_KEY = 'avi.localProject.v1'

export interface LocalProjectSnapshot {
  tracks: Track[]
  totalFrames: number
  fps: number
}

export function readLocalProject(): LocalProjectSnapshot | null {
  if (typeof localStorage === 'undefined') return null

  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<LocalProjectSnapshot>
    if (!Array.isArray(parsed.tracks) || typeof parsed.fps !== 'number' || typeof parsed.totalFrames !== 'number') {
      return null
    }

    return {
      tracks: parsed.tracks,
      totalFrames: parsed.totalFrames,
      fps: parsed.fps,
    }
  } catch {
    return null
  }
}

export function writeLocalProject(snapshot: LocalProjectSnapshot): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
}
