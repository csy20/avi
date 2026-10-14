import React, { useMemo, useRef, useState } from 'react'
import { importLocalPath, schedulePlaybackProxy, uploadAsset } from '../../lib/assetService'
import { isDesktopApp, pickMediaPaths } from '../../lib/desktop'
import { useEditorStore } from '../../store/useEditorStore'
import { toast } from '../../lib/toastStore'

interface UploadFirstCanvasProps {
  projectId: string | null
  projectStatus: 'loading' | 'ready' | 'error'
  projectError: string | null
  onRetry: () => void | Promise<void>
}

const zoneStyle: React.CSSProperties = {
  width: 'min(760px, calc(100vw - 48px))',
  minHeight: 420,
  borderRadius: 28,
  border: '1px solid rgba(255,255,255,0.08)',
  background:
    'radial-gradient(circle at top left, rgba(233,69,96,0.18), transparent 34%), radial-gradient(circle at bottom right, rgba(26,108,240,0.12), transparent 30%), linear-gradient(180deg, #181818 0%, #101010 100%)',
  boxShadow: '0 28px 80px rgba(0,0,0,0.45)',
  padding: '40px 42px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  gap: 24,
}

export const UploadFirstCanvas: React.FC<UploadFirstCanvasProps> = ({
  projectId,
  projectStatus,
  projectError,
  onRetry,
}) => {
  const addAssetToTrackType = useEditorStore((state) => state.addAssetToTrackType)
  const fps = useEditorStore((state) => state.fps)

  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const canUpload = projectStatus === 'ready' && !uploading

  const helperText = useMemo(() => {
    if (projectStatus === 'loading') return 'Preparing your project...'
    if (projectStatus === 'error') return null
    if (uploading) return 'Uploading video...'
    return isDesktopApp()
      ? 'Open an MP4, MOV, MKV, or WebM from this computer'
      : 'Upload an MP4, MOV, or WebM video to start editing'
  }, [projectStatus, uploading])

  const placeVideo = (asset: { playback_url: string; id: string; name: string; duration_seconds: number | null; preview_url?: string | null }) => {
    const durationFrames = asset.duration_seconds
      ? Math.max(1, Math.round(asset.duration_seconds * fps))
      : fps * 5

    addAssetToTrackType('video', {
      assetUrl: asset.playback_url,
      assetId: asset.id,
      mediaType: 'video',
      label: asset.name,
      durationFrames,
      previewUrl: asset.preview_url ?? undefined,
    })
  }

  const ingestVideo = async (file: File) => {
    if (!projectId) {
      toast.warning('Project is still initializing. Try again in a moment.')
      return
    }

    if (!file.type.startsWith('video/')) {
      toast.error('Upload a video first. Audio and images can be added after the editor opens.')
      return
    }

    if (file.size > 200 * 1024 * 1024) {
      toast.error('Video is too large for the current browser-first workflow. Limit is 200MB.')
      return
    }

    setUploading(true)

    try {
      const asset = await uploadAsset({
        file,
        projectId,
      })

      placeVideo(asset)
      window.dispatchEvent(new Event('avi:assets-changed'))

      toast.success(`"${asset.name}" is ready. AI editing is now available.`)
    } catch (error) {
      console.error('Initial video upload failed:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to upload your video')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const openLocalVideo = async () => {
    if (!projectId) {
      toast.warning('Project is still initializing. Try again in a moment.')
      return
    }

    setUploading(true)
    try {
      const paths = await pickMediaPaths(true)
      const path = paths[0]
      if (!path) return
      const asset = await importLocalPath(path, projectId)
      if (asset.file_type !== 'video') {
        toast.error('Open a video first. Audio and images can be added after the editor opens.')
        return
      }
      void schedulePlaybackProxy(asset).catch(() => undefined)
      placeVideo(asset)
      window.dispatchEvent(new Event('avi:assets-changed'))
      toast.success(`"${asset.name}" is ready. AI editing is now available.`)
    } catch (error) {
      console.error('Local video import failed:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to open your video')
    } finally {
      setUploading(false)
    }
  }

  const handleInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await ingestVideo(file)
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)

    const file = event.dataTransfer.files?.[0]
    if (!file) return
    await ingestVideo(file)
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background:
          'radial-gradient(circle at top, rgba(233,69,96,0.1), transparent 36%), linear-gradient(180deg, #0e0e0e 0%, #090909 100%)',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        onChange={handleInputChange}
        disabled={!canUpload}
        style={{ display: 'none' }}
      />

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={(event) => {
          event.preventDefault()
          setIsDragging(false)
        }}
        onDrop={handleDrop}
        style={{
          ...zoneStyle,
          transform: isDragging ? 'scale(1.01)' : 'scale(1)',
          borderColor: isDragging ? 'rgba(233,69,96,0.6)' : 'rgba(255,255,255,0.08)',
          boxShadow: isDragging ? '0 36px 90px rgba(233,69,96,0.18)' : zoneStyle.boxShadow,
          transition: 'transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ maxWidth: 420 }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                borderRadius: 999,
                padding: '6px 12px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                fontSize: 11,
                color: '#b0b0b0',
                letterSpacing: 0.6,
                textTransform: 'uppercase',
              }}
            >
              <span style={{ color: '#e94560' }}>●</span>
              Upload-first canvas
            </div>

            <h1
              style={{
                margin: '18px 0 12px',
                fontSize: 42,
                lineHeight: 1.05,
                color: '#fff',
                letterSpacing: -1.4,
              }}
            >
              Start with a video.
              <br />
              Then let AI help cut it.
            </h1>

            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.7, color: '#969696' }}>
              Upload your first clip to unlock the timeline, preview, trim controls, and AI editing.
              Additional audio and image uploads stay available once the editor opens.
            </p>
          </div>

          <div
            style={{
              minWidth: 220,
              flex: '0 0 220px',
              alignSelf: 'flex-start',
              padding: '16px 18px',
              borderRadius: 18,
              background: 'rgba(0,0,0,0.22)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ fontSize: 11, color: '#7c7c7c', textTransform: 'uppercase', letterSpacing: 0.9 }}>
              What unlocks after upload
            </div>
            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              {[
                'Timeline trim, split, duplicate',
                'AI prompt editing on uploaded clips',
                'Preview playback with audio',
                'Download edited result',
              ].map((item) => (
                <div key={item} style={{ display: 'flex', gap: 10, fontSize: 13, color: '#c7c7c7' }}>
                  <span style={{ color: '#6ee7b7' }}>✓</span>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            minHeight: 150,
            borderRadius: 22,
            border: `1px dashed ${isDragging ? 'rgba(233,69,96,0.75)' : 'rgba(255,255,255,0.14)'}`,
            background: isDragging ? 'rgba(233,69,96,0.08)' : 'rgba(255,255,255,0.02)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 14,
            padding: '28px 16px',
          }}
        >
          <div style={{ fontSize: 42 }}>{uploading ? '⟳' : projectStatus === 'error' ? '⚠' : '🎬'}</div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#f3f3f3' }}>
            {projectStatus === 'error'
              ? 'Project setup failed'
              : isDragging
              ? 'Drop your video here'
              : isDesktopApp()
                ? 'Open your first video'
                : 'Upload your first video'}
          </div>
          {projectStatus === 'error' ? (
            <>
              <div style={{ fontSize: 13, color: '#f87171', textAlign: 'center', maxWidth: 320 }}>
                {projectError ?? 'Could not set up your project. Please try again.'}
              </div>
              <button
                onClick={onRetry}
                style={{
                  marginTop: 4,
                  background: '#e94560',
                  border: 'none',
                  borderRadius: 999,
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                  padding: '12px 22px',
                  cursor: 'pointer',
                  boxShadow: '0 14px 30px rgba(233,69,96,0.28)',
                }}
              >
                Retry project setup
              </button>
            </>
          ) : (
            <>
              {helperText && (
                <div style={{ fontSize: 13, color: '#808080', textAlign: 'center' }}>{helperText}</div>
              )}
              <button
                onClick={() => {
                  if (isDesktopApp()) {
                    void openLocalVideo()
                    return
                  }
                  inputRef.current?.click()
                }}
                disabled={!canUpload}
                style={{
                  marginTop: 4,
                  background: canUpload ? '#e94560' : '#3a3a3a',
                  border: 'none',
                  borderRadius: 999,
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                  padding: '12px 22px',
                  cursor: canUpload ? 'pointer' : 'not-allowed',
                  boxShadow: canUpload ? '0 14px 30px rgba(233,69,96,0.28)' : 'none',
                }}
              >
                {uploading ? 'Opening...' : isDesktopApp() ? 'Open Video' : 'Choose Video'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
