import { useEffect } from 'react'
import { useEditorStore } from '../store/useEditorStore'
import { toast } from '../lib/toastStore'

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false

  const tagName = target.tagName.toLowerCase()
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

export const useTimelineShortcuts = () => {
  const isPromptOpen = useEditorStore((state) => state.isPromptOpen)
  const setSelection = useEditorStore((state) => state.setSelection)
  const removeClip = useEditorStore((state) => state.removeClip)
  const rippleDeleteClip = useEditorStore((state) => state.rippleDeleteClip)
  const moveClip = useEditorStore((state) => state.moveClip)
  const duplicateClip = useEditorStore((state) => state.duplicateClip)
  const splitClip = useEditorStore((state) => state.splitClip)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isPromptOpen || isTypingTarget(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const state = useEditorStore.getState()
      const selectedClip = state.selectedClip
      if (!selectedClip) return

      const track = state.compositionTree.find((item) => item.id === selectedClip.trackId)
      const clip = track?.clips.find((item) => item.id === selectedClip.clipId)
      if (!clip) return

      if (event.key.toLowerCase() === 's') {
        if (state.playheadPosition <= clip.startFrame || state.playheadPosition > clip.endFrame) {
          toast.warning('Move the playhead inside the selected clip to split it')
          return
        }

        event.preventDefault()
        const didSplit = splitClip(selectedClip.trackId, selectedClip.clipId, state.playheadPosition)
        if (!didSplit) {
          toast.warning('Unable to split this clip at the current playhead position')
        }
        return
      }

      if (event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateClip(selectedClip.trackId, selectedClip.clipId)
        return
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const step = event.shiftKey ? 5 : 1
        const delta = event.key === 'ArrowLeft' ? -step : step
        moveClip(selectedClip.trackId, selectedClip.clipId, clip.startFrame + delta, true)
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        if (event.shiftKey) {
          rippleDeleteClip(selectedClip.trackId, selectedClip.clipId)
        } else {
          removeClip(selectedClip.trackId, selectedClip.clipId)
        }
        setSelection(null)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [duplicateClip, isPromptOpen, moveClip, removeClip, rippleDeleteClip, setSelection, splitClip])
}
