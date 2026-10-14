import type { Clip, FrameRange, Track } from '../store/useEditorStore'

export interface LocalPromptInput {
  prompt: string
  frameRange: FrameRange | null
  tracks: Track[]
  totalFrames: number
  fps: number
}

export interface LocalPromptResult {
  tracks: Track[]
  totalFrames: number
  fps: number
  explanation: string
}

const COLOUR_MAP: Record<string, string> = {
  red: '#e94560',
  blue: '#1a6cf0',
  green: '#059669',
  purple: '#7c3aed',
  orange: '#f97316',
  yellow: '#eab308',
  pink: '#ec4899',
  cyan: '#06b6d4',
  white: '#f0f0f0',
  black: '#111111',
}

const createId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const inScope = (clip: Clip, frameRange: FrameRange | null) => {
  if (!frameRange) return true
  return clip.startFrame <= frameRange.endFrame && clip.endFrame >= frameRange.startFrame
}

const extractFrameCount = (text: string): number | null => {
  const match = text.match(/(\d+)\s*(?:frames?|f\b)/)
  return match ? Number.parseInt(match[1], 10) : null
}

export function applyLocalPrompt(input: LocalPromptInput): LocalPromptResult {
  const prompt = input.prompt.toLowerCase()
  const changes: string[] = []

  let tracks = input.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      if (!inScope(clip, input.frameRange)) return clip

      const next: Clip = { ...clip }

      for (const [word, hex] of Object.entries(COLOUR_MAP)) {
        if (prompt.includes(word)) {
          next.color = hex
          changes.push(`Changed "${next.label}" colour to ${word}`)
          break
        }
      }

      if (prompt.includes('longer') || prompt.includes('extend') || prompt.includes('stretch')) {
        const delta = extractFrameCount(prompt) ?? 15
        next.endFrame = Math.min(next.endFrame + delta, Math.max(input.totalFrames - 1, next.endFrame))
        changes.push(`Extended "${next.label}" by ${delta} frames`)
      }

      if (prompt.includes('shorter') || prompt.includes('trim') || prompt.includes('shorten')) {
        const delta = extractFrameCount(prompt) ?? 15
        next.endFrame = Math.max(next.endFrame - delta, next.startFrame + 5)
        if (next.mediaEnd != null && next.mediaStart != null) {
          next.mediaEnd = Math.min(next.mediaStart + (next.endFrame - next.startFrame), next.mediaEnd)
        }
        changes.push(`Trimmed "${next.label}" by ${delta} frames`)
      }

      if (prompt.includes('rename') || prompt.includes('label') || prompt.includes('call it')) {
        const match = input.prompt.match(/(?:rename|label|call it)\s+(?:to\s+)?["']?([^"'\n]+?)["']?$/i)
        if (match?.[1]) {
          changes.push(`Renamed "${next.label}" to "${match[1].trim()}"`)
          next.label = match[1].trim()
        }
      }

      if (prompt.includes('transparent') || prompt.includes('opacity') || prompt.includes('fade')) {
        next.opacity = 0.5
        changes.push(`Set "${next.label}" opacity to 50%`)
      }

      if (prompt.includes('grayscale') || prompt.includes('greyscale') || prompt.includes('black and white')) {
        next.pixelFilter = 'grayscale'
        changes.push(`Applied grayscale to "${next.label}"`)
      } else if (prompt.includes('sepia')) {
        next.pixelFilter = 'sepia'
        changes.push(`Applied sepia to "${next.label}"`)
      } else if (prompt.includes('invert')) {
        next.pixelFilter = 'invert'
        changes.push(`Inverted "${next.label}"`)
      } else if (prompt.includes('bright')) {
        next.pixelFilter = 'brightness'
        changes.push(`Raised brightness on "${next.label}"`)
      } else if (prompt.includes('warm')) {
        next.pixelFilter = 'warm'
        changes.push(`Applied a warm grade to "${next.label}"`)
      }

      return next
    }),
  }))

  if (prompt.includes('split')) {
    tracks = tracks.map((track) => {
      const clips: Clip[] = []
      for (const clip of track.clips) {
        if (!inScope(clip, input.frameRange) || clip.endFrame <= clip.startFrame) {
          clips.push(clip)
          continue
        }

        const splitFrame = Math.floor((clip.startFrame + clip.endFrame) / 2) + 1
        const mediaMid = clip.mediaStart != null ? clip.mediaStart + (splitFrame - clip.startFrame) : undefined
        clips.push({
          ...clip,
          endFrame: splitFrame - 1,
          mediaEnd: mediaMid != null ? mediaMid - 1 : clip.mediaEnd,
          label: `${clip.label} (L)`,
        })
        clips.push({
          ...clip,
          id: createId('clip-split'),
          startFrame: splitFrame,
          mediaStart: mediaMid ?? clip.mediaStart,
          label: `${clip.label} (R)`,
        })
        changes.push(`Split "${clip.label}" at frame ${splitFrame}`)
      }
      return { ...track, clips }
    })
  }

  if (prompt.includes('add text') || prompt.includes('text overlay') || prompt.includes('add title')) {
    const textMatch = input.prompt.match(/(?:text|title)\s+["']([^"']+)["']/i)
    const text = textMatch?.[1] || 'Sample Text'
    let overlay = tracks.find((track) => track.type === 'overlay')
    if (!overlay) {
      overlay = { id: createId('track-overlay'), name: 'Overlay 1', type: 'overlay', clips: [] }
      tracks = [...tracks, overlay]
    }

    const textClip: Clip = {
      id: createId('clip-text'),
      trackId: overlay.id,
      startFrame: input.frameRange?.startFrame ?? 0,
      endFrame: input.frameRange?.endFrame ?? Math.min(59, Math.max(input.totalFrames - 1, 0)),
      label: text,
      color: '#7c3aed',
      mediaType: 'text',
      text,
      fontSize: 48,
      fontColor: '#ffffff',
      opacity: 1,
    }
    const overlayId = overlay.id
    tracks = tracks.map((track) =>
      track.id === overlayId ? { ...track, clips: [...track.clips, textClip] } : track
    )
    changes.push(`Added text overlay: "${text}"`)
  }

  return {
    tracks,
    totalFrames: input.totalFrames,
    fps: input.fps,
    explanation:
      changes.length > 0
        ? `${changes.join('. ')}.`
        : 'No matching local edit for this prompt. The composition is unchanged.',
  }
}
