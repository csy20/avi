import type { Clip } from '../store/useEditorStore'

export function movedClipRange(startFrame: number, endFrame: number, newStart: number) {
  const duration = Math.max(0, endFrame - startFrame)
  const nextStart = Math.max(0, Math.round(newStart))
  return {
    startFrame: nextStart,
    endFrame: nextStart + duration,
  }
}

export function snapStart(
  start: number,
  duration: number,
  targets: number[],
  threshold = 8
): number {
  const end = start + duration
  let bestStart = start
  let bestDistance = threshold + 1

  for (const target of targets) {
    const startDistance = Math.abs(target - start)
    if (startDistance <= threshold && startDistance < bestDistance) {
      bestStart = target
      bestDistance = startDistance
    }

    const endDistance = Math.abs(target - end)
    if (endDistance <= threshold && endDistance < bestDistance) {
      bestStart = target - duration
      bestDistance = endDistance
    }
  }

  return Math.max(0, bestStart)
}

export function rippleDelete(clips: Clip[], clipId: string): Clip[] {
  const clip = clips.find((item) => item.id === clipId)
  if (!clip) return clips

  const duration = clip.endFrame - clip.startFrame + 1
  return clips
    .filter((item) => item.id !== clipId)
    .map((item) => {
      if (item.startFrame <= clip.endFrame) return item
      return {
        ...item,
        startFrame: item.startFrame - duration,
        endFrame: item.endFrame - duration,
      }
    })
}
