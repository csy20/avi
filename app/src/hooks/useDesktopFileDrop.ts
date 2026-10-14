import { useEffect } from 'react'
import { importMediaPaths } from '../lib/assetService'
import { isDesktopApp } from '../lib/desktop'
import { hasUsableVideoClips } from '../lib/editorUtils'
import { toast } from '../lib/toastStore'
import { useEditorStore } from '../store/useEditorStore'

export function useDesktopFileDrop(projectId: string | null) {
  const addAssetToTrackType = useEditorStore((state) => state.addAssetToTrackType)
  const fps = useEditorStore((state) => state.fps)

  useEffect(() => {
    if (!projectId || !isDesktopApp()) return

    let unlisten: (() => void) | undefined
    let cancelled = false

    void import('@tauri-apps/api/webview').then(async ({ getCurrentWebview }) => {
      const stop = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type !== 'drop') return

        void importMediaPaths(event.payload.paths, projectId)
          .then((assets) => {
            if (assets.length === 0) {
              toast.warning('Drop a video, audio, or image file')
              return
            }

            const state = useEditorStore.getState()
            const needsVideo = !hasUsableVideoClips(state.compositionTree)
            const firstVideo = assets.find((asset) => asset.file_type === 'video' && asset.playback_url)
            if (needsVideo && firstVideo) {
              const durationFrames = firstVideo.duration_seconds
                ? Math.max(1, Math.round(firstVideo.duration_seconds * fps))
                : fps * 5
              addAssetToTrackType('video', {
                assetUrl: firstVideo.playback_url,
                assetId: firstVideo.id,
                mediaType: 'video',
                label: firstVideo.name,
                durationFrames,
                previewUrl: firstVideo.preview_url ?? undefined,
              })
            }

            toast.success(assets.length === 1 ? `Imported "${assets[0].name}"` : `Imported ${assets.length} files`)
          })
          .catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : 'Failed to import dropped files')
          })
      })

      if (cancelled) {
        stop()
        return
      }
      unlisten = stop
    }).catch((error: unknown) => {
      console.error('Desktop file drop is unavailable', error)
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [addAssetToTrackType, fps, projectId])
}
