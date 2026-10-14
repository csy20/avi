import { create } from 'zustand'
import { validateClip } from '../lib/clipValidation'
import type { PixelFilterName } from '../lib/pixelFilter'
import { movedClipRange, rippleDelete } from '../lib/timelineEdit'

export interface Clip {
  id: string
  trackId: string
  startFrame: number
  endFrame: number
  label: string
  color: string
  // Media reference fields
  assetUrl?: string
  assetId?: string
  mediaType?: 'video' | 'audio' | 'image' | 'text'
  mediaStart?: number
  mediaEnd?: number
  mediaDurationFrames?: number
  opacity?: number
  pixelFilter?: PixelFilterName
  previewUrl?: string
  text?: string
  fontSize?: number
  fontColor?: string
  isMissingAsset?: boolean
  status?: 'ready' | 'missing' | 'loading'
}

export interface Track {
  id: string
  name: string
  type: 'video' | 'audio' | 'overlay'
  clips: Clip[]
}

export interface FrameRange {
  startFrame: number
  endFrame: number
}

export interface SelectedClip {
  trackId: string
  clipId: string
}

interface AssetClipInput {
  assetUrl: string
  assetId: string
  mediaType: 'video' | 'audio' | 'image'
  label: string
  durationFrames: number
  previewUrl?: string
}

interface HydratedProjectState {
  tracks: Track[]
  totalFrames: number
  fps: number
}

interface EditorStore {
  // Playback
  playheadPosition: number
  currentSelection: FrameRange | null
  selectedClip: SelectedClip | null
  totalFrames: number
  fps: number
  isPlaying: boolean

  // Compositions
  compositionTree: Track[]
  proposedComposition: Track[] | null

  // History
  history: Track[][]
  historyIndex: number

  // UI flags
  isPromptOpen: boolean
  timelineResetVersion: number
  assetPickerClip: SelectedClip | null

  // Actions
  setPlayheadPosition: (frame: number) => void
  setSelection: (selection: FrameRange | null) => void
  setSelectedClip: (selection: SelectedClip | null) => void
  setIsPlaying: (playing: boolean) => void

  openPrompt: () => void
  closePrompt: () => void

  setProposedComposition: (tracks: Track[]) => void
  acceptProposal: () => void
  rejectProposal: () => void

  hydrateProject: (project: HydratedProjectState) => void
  commitHistoryCheckpoint: () => void

  undo: () => void
  redo: () => void

  addTrack: (name: string, type: Track['type']) => string
  addClip: (trackId: string, clip: Omit<Clip, 'id' | 'trackId'>) => void
  removeClip: (trackId: string, clipId: string) => void
  addClipFromAsset: (trackId: string, asset: AssetClipInput) => void
  addAssetToTrackType: (trackType: Track['type'], asset: AssetClipInput) => void
  replaceClipAsset: (trackId: string, clipId: string, asset: AssetClipInput) => void
  splitClip: (trackId: string, clipId: string, splitFrame: number) => boolean
  trimClip: (trackId: string, clipId: string, newStart: number, newEnd: number) => void
  moveClip: (trackId: string, clipId: string, newStart: number, commit?: boolean) => void
  rippleDeleteClip: (trackId: string, clipId: string) => void
  setClipPixelFilter: (trackId: string, clipId: string, filter: PixelFilterName | null) => void
  setAssetPreviewUrl: (assetId: string, previewUrl: string) => void
  duplicateClip: (trackId: string, clipId: string) => void
  removeAssetClips: (assetId: string) => void
  cleanMissingClips: () => void
  openAssetPicker: (selection: SelectedClip) => void
  closeAssetPicker: () => void
  markAssetMissing: (assetId: string) => void
}

const MIN_TOTAL_FRAMES = 150
const MAX_HISTORY = 50

const createId = (prefix: string) => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const cloneTracks = (tracks: Track[]): Track[] =>
  tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => ({ ...clip })),
  }))

const clipColorByMediaType = (mediaType: Clip['mediaType']) =>
  mediaType === 'video' ? '#e94560' : mediaType === 'audio' ? '#059669' : '#7c3aed'

const isMissingClip = (clip: Clip) => clip.isMissingAsset || clip.status === 'missing'

const computeTotalFrames = (tracks: Track[]): number => {
  const maxFrame = tracks.reduce((trackMax, track) => {
    // FIX: BUG-B - ignore missing clips so ghost placeholders cannot inflate timeline duration.
    return track.clips.reduce((clipMax, clip) => (
      isMissingClip(clip) ? clipMax : Math.max(clipMax, clip.endFrame + 1)
    ), trackMax)
  }, 0)

  return Math.max(MIN_TOTAL_FRAMES, maxFrame)
}

const trackSignature = (tracks: Track[]) => JSON.stringify(tracks)

const findClip = (tracks: Track[], selection: SelectedClip | null): Clip | null => {
  if (!selection) return null

  const track = tracks.find((item) => item.id === selection.trackId)
  if (!track) return null

  return track.clips.find((clip) => clip.id === selection.clipId) ?? null
}

const ensureSelectionExists = (tracks: Track[], selection: SelectedClip | null): SelectedClip | null =>
  findClip(tracks, selection) ? selection : null

const applyCommittedTree = (
  state: EditorStore,
  nextTree: Track[],
  overrides: Partial<Pick<EditorStore, 'selectedClip' | 'totalFrames' | 'assetPickerClip'>> = {}
) => {
  const snapshot = cloneTracks(nextTree)
  const history = [...state.history.slice(0, state.historyIndex + 1), snapshot].slice(-MAX_HISTORY)

  return {
    compositionTree: snapshot,
    proposedComposition: null,
    history,
    historyIndex: history.length - 1,
    totalFrames: overrides.totalFrames ?? computeTotalFrames(snapshot),
    selectedClip: ensureSelectionExists(snapshot, overrides.selectedClip ?? state.selectedClip),
    assetPickerClip: ensureSelectionExists(snapshot, overrides.assetPickerClip ?? state.assetPickerClip),
  }
}

const applyLiveTree = (
  state: EditorStore,
  nextTree: Track[],
  overrides: Partial<Pick<EditorStore, 'selectedClip' | 'totalFrames' | 'assetPickerClip'>> = {}
) => {
  const snapshot = cloneTracks(nextTree)

  return {
    compositionTree: snapshot,
    proposedComposition: null,
    totalFrames: overrides.totalFrames ?? computeTotalFrames(snapshot),
    selectedClip: ensureSelectionExists(snapshot, overrides.selectedClip ?? state.selectedClip),
    assetPickerClip: ensureSelectionExists(snapshot, overrides.assetPickerClip ?? state.assetPickerClip),
  }
}

const resolveTrimmedClip = (clip: Clip, newStart: number, newEnd: number): Clip => {
  let startFrame = Math.max(0, Math.min(newStart, newEnd))
  let endFrame = Math.max(startFrame, newEnd)

  if (
    clip.mediaType &&
    clip.mediaType !== 'text' &&
    clip.mediaStart != null &&
    clip.mediaEnd != null
  ) {
    const minStart = Math.max(0, clip.startFrame - clip.mediaStart)
    startFrame = Math.max(minStart, Math.min(startFrame, endFrame))

    let mediaStart = clip.mediaStart + (startFrame - clip.startFrame)

    const maxEnd = clip.mediaDurationFrames != null
      ? clip.endFrame + Math.max(clip.mediaDurationFrames - 1 - clip.mediaEnd, 0)
      : Number.MAX_SAFE_INTEGER

    endFrame = Math.max(startFrame, Math.min(endFrame, maxEnd))
    let mediaEnd = clip.mediaEnd + (endFrame - clip.endFrame)

    if (clip.mediaDurationFrames != null) {
      mediaEnd = Math.min(mediaEnd, clip.mediaDurationFrames - 1)
    }

    mediaStart = Math.max(0, mediaStart)
    mediaEnd = Math.max(mediaStart, mediaEnd)

    return {
      ...clip,
      startFrame,
      endFrame,
      mediaStart,
      mediaEnd,
    }
  }

  return {
    ...clip,
    startFrame,
    endFrame,
  }
}

const INITIAL_TRACKS: Track[] = []

const INITIAL_SNAPSHOT = cloneTracks(INITIAL_TRACKS)

export const useEditorStore = create<EditorStore>((set, get) => ({
  playheadPosition: 0,
  currentSelection: null,
  selectedClip: null,
  isPlaying: false,
  isPromptOpen: false,
  timelineResetVersion: 0,
  assetPickerClip: null,
  totalFrames: computeTotalFrames(INITIAL_SNAPSHOT),
  fps: 30,

  compositionTree: INITIAL_SNAPSHOT,
  proposedComposition: null,

  history: [INITIAL_SNAPSHOT],
  historyIndex: 0,

  setPlayheadPosition: (frame) =>
    set((state) => ({ playheadPosition: Math.max(0, Math.min(frame, state.totalFrames - 1)) })),

  setSelection: (currentSelection) => set({ currentSelection }),
  setSelectedClip: (selectedClip) =>
    set((state) => ({
      selectedClip,
      assetPickerClip: selectedClip ? state.assetPickerClip : null,
    })),
  setIsPlaying: (isPlaying) => set({ isPlaying }),

  openAssetPicker: (assetPickerClip) => set({ assetPickerClip }),
  closeAssetPicker: () => set({ assetPickerClip: null }),

  openPrompt: () => set({ isPromptOpen: true }),
  closePrompt: () => set({ isPromptOpen: false }),

  setProposedComposition: (tracks) => set({ proposedComposition: cloneTracks(tracks) }),

  acceptProposal: () =>
    set((state) => {
      if (!state.proposedComposition) return state
      return applyCommittedTree(state, state.proposedComposition)
    }),

  rejectProposal: () => set({ proposedComposition: null }),

  hydrateProject: ({ tracks, totalFrames, fps }) =>
    set((state) => {
      const snapshot = cloneTracks(tracks)

      return {
        compositionTree: snapshot,
        proposedComposition: null,
        history: [snapshot],
        historyIndex: 0,
        totalFrames: Math.max(totalFrames, computeTotalFrames(snapshot)),
        fps,
        playheadPosition: 0,
        currentSelection: null,
        selectedClip: null,
        isPlaying: false,
        timelineResetVersion: state.timelineResetVersion + 1,
        assetPickerClip: null,
      }
    }),

  commitHistoryCheckpoint: () =>
    set((state) => {
      const current = trackSignature(state.compositionTree)
      const historical = trackSignature(state.history[state.historyIndex] ?? [])

      if (current === historical) {
        return state
      }

      return applyCommittedTree(state, state.compositionTree)
    }),

  undo: () =>
    set((state) => {
      if (state.historyIndex <= 0) return state
      const historyIndex = state.historyIndex - 1
      const snapshot = cloneTracks(state.history[historyIndex])

      return {
        compositionTree: snapshot,
        historyIndex,
        proposedComposition: null,
        totalFrames: computeTotalFrames(snapshot),
        selectedClip: ensureSelectionExists(snapshot, state.selectedClip),
        assetPickerClip: ensureSelectionExists(snapshot, state.assetPickerClip),
      }
    }),

  redo: () =>
    set((state) => {
      if (state.historyIndex >= state.history.length - 1) return state
      const historyIndex = state.historyIndex + 1
      const snapshot = cloneTracks(state.history[historyIndex])

      return {
        compositionTree: snapshot,
        historyIndex,
        proposedComposition: null,
        totalFrames: computeTotalFrames(snapshot),
        selectedClip: ensureSelectionExists(snapshot, state.selectedClip),
        assetPickerClip: ensureSelectionExists(snapshot, state.assetPickerClip),
      }
    }),

  addTrack: (name, type) => {
    const id = createId('track')

    set((state) =>
      applyCommittedTree(state, [...state.compositionTree, { id, name, type, clips: [] }], {
        selectedClip: null,
      })
    )

    return id
  },

  addClip: (trackId, clip) =>
    set((state) =>
      applyCommittedTree(
        state,
        state.compositionTree.map((track) =>
          track.id === trackId
            ? { ...track, clips: [...track.clips, { ...clip, id: createId('clip'), trackId }] }
            : track
        )
      )
    ),

  removeClip: (trackId, clipId) =>
    set((state) =>
      applyCommittedTree(
        state,
        state.compositionTree.map((track) =>
          track.id === trackId
            ? { ...track, clips: track.clips.filter((clip) => clip.id !== clipId) }
            : track
        ),
        {
          selectedClip:
            state.selectedClip?.trackId === trackId && state.selectedClip.clipId === clipId
              ? null
              : state.selectedClip,
          assetPickerClip:
            state.assetPickerClip?.trackId === trackId && state.assetPickerClip.clipId === clipId
              ? null
              : state.assetPickerClip,
        }
      )
    ),

  addClipFromAsset: (trackId, asset) =>
    set((state) => {
      const playhead = state.playheadPosition
      const newClip: Clip = {
        id: createId('clip'),
        trackId,
        startFrame: playhead,
        endFrame: playhead + asset.durationFrames - 1,
        label: asset.label,
        color: clipColorByMediaType(asset.mediaType),
        assetUrl: asset.assetUrl,
        assetId: asset.assetId,
        mediaType: asset.mediaType,
        mediaStart: 0,
        mediaEnd: asset.durationFrames - 1,
        mediaDurationFrames: asset.durationFrames,
        opacity: 1,
        previewUrl: asset.previewUrl,
        isMissingAsset: false,
        status: 'ready',
      }

      const nextTree = state.compositionTree.map((track) =>
        track.id === trackId ? { ...track, clips: [...track.clips, newClip] } : track
      )

      return applyCommittedTree(state, nextTree, {
        totalFrames: Math.max(state.totalFrames, newClip.endFrame + 1),
        selectedClip: { trackId, clipId: newClip.id },
      })
    }),

  addAssetToTrackType: (trackType, asset) =>
    set((state) => {
      const existingTrack = state.compositionTree.find((track) => track.type === trackType)
      const trackId = existingTrack?.id ?? createId('track')
      const trackName = trackType === 'video' ? 'Video 1' : trackType === 'audio' ? 'Audio 1' : 'Overlay 1'

      const playhead = state.playheadPosition
      const newClip: Clip = {
        id: createId('clip'),
        trackId,
        startFrame: playhead,
        endFrame: playhead + asset.durationFrames - 1,
        label: asset.label,
        color: clipColorByMediaType(asset.mediaType),
        assetUrl: asset.assetUrl,
        assetId: asset.assetId,
        mediaType: asset.mediaType,
        mediaStart: 0,
        mediaEnd: asset.durationFrames - 1,
        mediaDurationFrames: asset.durationFrames,
        opacity: 1,
        previewUrl: asset.previewUrl,
        isMissingAsset: false,
        status: 'ready',
      }

      const nextTree = existingTrack
        ? state.compositionTree.map((track) =>
            track.id === trackId ? { ...track, clips: [...track.clips, newClip] } : track
          )
        : [
            ...state.compositionTree,
            {
              id: trackId,
              name: trackName,
              type: trackType,
              clips: [newClip],
            },
          ]

      return applyCommittedTree(state, nextTree, {
        totalFrames: Math.max(state.totalFrames, newClip.endFrame + 1),
        selectedClip: { trackId, clipId: newClip.id },
      })
    }),

  replaceClipAsset: (trackId, clipId, asset) =>
    set((state) => {
      const safeAssetDurationFrames = Math.max(1, Math.floor(asset.durationFrames))
      const nextTree = state.compositionTree.map((track) => {
        if (track.id !== trackId) return track

        return {
          ...track,
          clips: track.clips.map((clip) => {
            if (clip.id !== clipId) return clip
            const timelineDurationFrames = clip.endFrame - clip.startFrame + 1

            return {
              ...clip,
              label: asset.label,
              color: clipColorByMediaType(asset.mediaType),
              assetUrl: asset.assetUrl,
              assetId: asset.assetId,
              mediaType: asset.mediaType,
              mediaStart: 0,
              mediaEnd: Math.max(0, Math.min(timelineDurationFrames, safeAssetDurationFrames) - 1),
              mediaDurationFrames: safeAssetDurationFrames,
              isMissingAsset: false,
              status: 'ready' as const,
            }
          }),
        }
      })

      return applyCommittedTree(state, nextTree, {
        selectedClip: { trackId, clipId },
        assetPickerClip: null,
      })
    }),

  splitClip: (trackId, clipId, splitFrame) => {
    const state = get()
    const track = state.compositionTree.find((item) => item.id === trackId)
    const clip = track?.clips.find((item) => item.id === clipId)

    if (!clip || splitFrame <= clip.startFrame || splitFrame > clip.endFrame) {
      return false
    }

    // FIX: 1 - refuse split operations that would create invalid preview trim ranges.
    const mediaMid = clip.mediaStart != null
      ? clip.mediaStart + (splitFrame - clip.startFrame)
      : undefined

    const leftCandidate: Clip = {
      ...clip,
      endFrame: splitFrame - 1,
      mediaEnd: mediaMid != null ? mediaMid - 1 : clip.mediaEnd,
    }

    const rightCandidate: Clip = {
      ...clip,
      id: createId('clip'),
      startFrame: splitFrame,
      mediaStart: mediaMid ?? clip.mediaStart,
    }

    if (!validateClip(leftCandidate) || !validateClip(rightCandidate)) {
      return false
    }

    set((currentState) => {
      let nextSelectedClipId: string | null = null
      const nextTree = currentState.compositionTree.map((item) => {
        if (item.id !== trackId) return item

        const clipIndex = item.clips.findIndex((currentClip) => currentClip.id === clipId)
        if (clipIndex === -1) return item

        const originalClip = item.clips[clipIndex]
        const splitMediaMid = originalClip.mediaStart != null
          ? originalClip.mediaStart + (splitFrame - originalClip.startFrame)
          : undefined

        const leftClip: Clip = {
          ...originalClip,
          endFrame: splitFrame - 1,
          mediaEnd: splitMediaMid != null ? splitMediaMid - 1 : originalClip.mediaEnd,
        }

        const rightClip: Clip = {
          ...originalClip,
          id: createId('clip'),
          startFrame: splitFrame,
          mediaStart: splitMediaMid ?? originalClip.mediaStart,
        }
        nextSelectedClipId = rightClip.id

        const clips = [...item.clips]
        clips.splice(clipIndex, 1, leftClip, rightClip)

        return { ...item, clips }
      })

      return applyCommittedTree(currentState, nextTree, {
        selectedClip: nextSelectedClipId ? { trackId, clipId: nextSelectedClipId } : currentState.selectedClip,
      })
    })

    return true
  },

  moveClip: (trackId, clipId, newStart, commit = false) =>
    set((state) => {
      const nextTree = state.compositionTree.map((track) => {
        if (track.id !== trackId) return track
        return {
          ...track,
          clips: track.clips.map((clip) => {
            if (clip.id !== clipId) return clip
            const range = movedClipRange(clip.startFrame, clip.endFrame, newStart)
            return { ...clip, ...range }
          }),
        }
      })

      return commit
        ? applyCommittedTree(state, nextTree, { selectedClip: { trackId, clipId } })
        : applyLiveTree(state, nextTree, { selectedClip: { trackId, clipId } })
    }),

  rippleDeleteClip: (trackId, clipId) =>
    set((state) =>
      applyCommittedTree(
        state,
        state.compositionTree.map((track) =>
          track.id === trackId ? { ...track, clips: rippleDelete(track.clips, clipId) } : track
        ),
        {
          selectedClip:
            state.selectedClip?.trackId === trackId && state.selectedClip.clipId === clipId
              ? null
              : state.selectedClip,
        }
      )
    ),

  setClipPixelFilter: (trackId, clipId, filter) =>
    set((state) =>
      applyCommittedTree(
        state,
        state.compositionTree.map((track) =>
          track.id === trackId
            ? {
                ...track,
                clips: track.clips.map((clip) =>
                  clip.id === clipId
                    ? { ...clip, pixelFilter: filter ?? undefined }
                    : clip
                ),
              }
            : track
        ),
        { selectedClip: { trackId, clipId } }
      )
    ),

  setAssetPreviewUrl: (assetId, previewUrl) =>
    set((state) => ({
      compositionTree: state.compositionTree.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.assetId === assetId ? { ...clip, previewUrl } : clip
        ),
      })),
    })),

  trimClip: (trackId, clipId, newStart, newEnd) =>
    set((state) =>
      applyLiveTree(
        state,
        state.compositionTree.map((track) => {
          if (track.id !== trackId) return track

          return {
            ...track,
            clips: track.clips.map((clip) =>
              clip.id === clipId
                ? (() => {
                    // FIX: 1 - keep invalid trims from reaching the preview renderer.
                    const trimmedClip = resolveTrimmedClip(clip, newStart, newEnd)
                    return validateClip(trimmedClip) ? trimmedClip : clip
                  })()
                : clip
            ),
          }
        }),
        {
          selectedClip: { trackId, clipId },
        }
      )
    ),

  duplicateClip: (trackId, clipId) =>
    set((state) => {
      let duplicatedClipId: string | null = null

      const nextTree = state.compositionTree.map((track) => {
        if (track.id !== trackId) return track

        const clipIndex = track.clips.findIndex((clip) => clip.id === clipId)
        if (clipIndex === -1) return track

        const sourceClip = track.clips[clipIndex]
        const duration = sourceClip.endFrame - sourceClip.startFrame
        const duplicatedClip: Clip = {
          ...sourceClip,
          id: createId('clip'),
          startFrame: sourceClip.endFrame + 1,
          endFrame: sourceClip.endFrame + 1 + duration,
        }
        duplicatedClipId = duplicatedClip.id

        const clips = [...track.clips]
        clips.splice(clipIndex + 1, 0, duplicatedClip)

        return { ...track, clips }
      })

      return applyCommittedTree(state, nextTree, {
        selectedClip: duplicatedClipId ? { trackId, clipId: duplicatedClipId } : state.selectedClip,
      })
    }),

  removeAssetClips: (assetId) =>
    set((state) => {
      const hasReferencedClips = state.compositionTree.some((track) =>
        track.clips.some((clip) => clip.assetId === assetId)
      )
      if (!hasReferencedClips) return state

      // FIX: BUG-B - deleting an asset should immediately remove all linked timeline clips.
      const nextTree = state.compositionTree.map((track) => ({
        ...track,
        clips: track.clips.filter((clip) => clip.assetId !== assetId),
      }))

      return applyCommittedTree(state, nextTree)
    }),

  cleanMissingClips: () =>
    set((state) => {
      const hasMissingClips = state.compositionTree.some((track) =>
        track.clips.some((clip) => isMissingClip(clip))
      )
      if (!hasMissingClips) return state

      // FIX: BUG-B - strip missing clips from every track so ghost clips cannot affect layout or duration.
      const nextTree = state.compositionTree.map((track) => ({
        ...track,
        clips: track.clips.filter((clip) => !isMissingClip(clip)),
      }))

      return applyCommittedTree(state, nextTree)
    }),

  markAssetMissing: (assetId) =>
    set((state) =>
      applyLiveTree(
        state,
        state.compositionTree.map((track) => ({
          ...track,
          clips: track.clips.map((clip) =>
            clip.assetId === assetId
              ? {
                  ...clip,
                  assetUrl: undefined,
                  isMissingAsset: true,
                  status: 'missing',
                }
              : clip
          ),
        }))
      )
    ),
}))
