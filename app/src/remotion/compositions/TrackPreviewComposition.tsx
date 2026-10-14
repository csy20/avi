import React, { useEffect, useRef, useState } from 'react'
import { AbsoluteFill, Html5Audio, Img, Html5Video, Sequence, interpolate, useCurrentFrame } from 'remotion'
import { type Clip, type Track, useEditorStore } from '../../store/useEditorStore'
import { getSafeMediaTrimProps, validateClip } from '../../lib/clipValidation'
import { applyPixelFilter, cssFilterFor, type PixelFilterName } from '../../lib/pixelFilter'

const playbackSrc = (clip: Clip) => clip.previewUrl || clip.assetUrl || ''

const PausedWasmGrade: React.FC<{ clip: Clip; src: string; filter: PixelFilterName }> = ({ clip, src, filter }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ready, setReady] = useState(false)
  const frame = useCurrentFrame()
  const fps = useEditorStore((state) => state.fps)
  const isPlaying = useEditorStore((state) => state.isPlaying)

  useEffect(() => {
    if (isPlaying) {
      setReady(false)
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return

    const paint = async (element: CanvasImageSource) => {
      if (cancelled) return
      canvas.width = 640
      canvas.height = 360
      context.drawImage(element, 0, 0, canvas.width, canvas.height)
      const image = context.getImageData(0, 0, canvas.width, canvas.height)
      const filtered = await applyPixelFilter(new Uint8Array(image.data), filter)
      if (cancelled) return
      image.data.set(filtered)
      context.putImageData(image, 0, 0)
      setReady(true)
    }

    if (clip.mediaType === 'image') {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => {
        paint(image).catch(() => setReady(false))
      }
      image.onerror = () => setReady(false)
      image.src = src
      return () => {
        cancelled = true
      }
    }

    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'auto'
    video.playsInline = true
    video.src = src

    const seek = () => {
      const seconds = ((clip.mediaStart ?? 0) + frame) / Math.max(fps, 1)
      const duration = Number.isFinite(video.duration) ? video.duration : seconds
      video.currentTime = Math.min(Math.max(0, seconds), duration)
    }

    const onSeeked = () => {
      paint(video).catch(() => setReady(false))
    }

    video.addEventListener('loadeddata', seek)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', () => setReady(false))

    return () => {
      cancelled = true
      video.removeEventListener('loadeddata', seek)
      video.removeEventListener('seeked', onSeeked)
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [clip.mediaStart, clip.mediaType, filter, fps, frame, isPlaying, src])

  if (isPlaying) return null

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        opacity: ready ? 1 : 0,
      }}
    />
  )
}

const getMediaFailureMessage = (clip: Clip, error?: string) => {
  if (error && error.trim().length > 0) {
    return error.trim()
  }

  return `Unable to load ${clip.mediaType ?? 'media'} for this clip.`
}

const MediaFailureOverlay: React.FC<{
  message: string
  opacity: number
}> = ({ message, opacity }) => (
  <AbsoluteFill
    style={{
      opacity,
      background: 'linear-gradient(135deg, rgba(18,18,18,0.76), rgba(6,6,6,0.9))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 36px',
    }}
  >
    <div
      style={{
        width: 'min(100%, 520px)',
        borderRadius: 14,
        border: '1px solid rgba(251,191,36,0.42)',
        background: 'rgba(10,10,10,0.84)',
        boxShadow: '0 16px 44px rgba(0,0,0,0.32)',
        padding: '20px 24px',
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 1.1,
          color: '#fbbf24',
          fontFamily: 'monospace',
        }}
      >
        MEDIA ERROR
      </div>
      <div
        style={{
          marginTop: 10,
          fontSize: 13,
          lineHeight: 1.5,
          color: '#c6c6c6',
        }}
      >
        {message}
      </div>
    </div>
  </AbsoluteFill>
)

const VideoClipRenderer: React.FC<{
  clip: Clip
  opacity: number
  trimBefore?: number
  trimAfter?: number
}> = ({ clip, opacity, trimBefore, trimAfter }) => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    setErrorMessage(null)
  }, [clip.id, clip.assetUrl, clip.previewUrl, clip.mediaStart, clip.mediaEnd])

  if (errorMessage) {
    return (
      <MediaFailureOverlay
        message={getMediaFailureMessage(clip, errorMessage)}
        opacity={opacity}
      />
    )
  }

  const src = playbackSrc(clip)
  const cssFilter = clip.pixelFilter ? cssFilterFor(clip.pixelFilter) : undefined

  return (
    <AbsoluteFill style={{ opacity }}>
      <Html5Video
        src={src}
        trimBefore={trimBefore}
        trimAfter={trimAfter}
        onError={(error) => setErrorMessage(error.message)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', filter: cssFilter }}
      />
      {clip.pixelFilter && <PausedWasmGrade clip={clip} src={src} filter={clip.pixelFilter} />}
    </AbsoluteFill>
  )
}

const AudioClipRenderer: React.FC<{
  clip: Clip
  trimBefore?: number
  trimAfter?: number
}> = ({ clip, trimBefore, trimAfter }) => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    setErrorMessage(null)
  }, [clip.id, clip.assetUrl, clip.mediaStart, clip.mediaEnd])

  if (errorMessage) {
    return (
      <MediaFailureOverlay
        message={getMediaFailureMessage(clip, errorMessage)}
        opacity={1}
      />
    )
  }

  return (
    <Html5Audio
      src={clip.assetUrl!}
      trimBefore={trimBefore}
      trimAfter={trimAfter}
      onError={(error) => setErrorMessage(error.message)}
    />
  )
}

const ImageClipRenderer: React.FC<{ clip: Clip; opacity: number }> = ({ clip, opacity }) => {
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    setHasError(false)
  }, [clip.id, clip.assetUrl, clip.previewUrl])

  if (hasError) {
    return (
      <MediaFailureOverlay
        message={getMediaFailureMessage(clip)}
        opacity={opacity}
      />
    )
  }

  const src = playbackSrc(clip)
  const cssFilter = clip.pixelFilter ? cssFilterFor(clip.pixelFilter) : undefined

  return (
    <AbsoluteFill style={{ opacity }}>
      <Img
        src={src}
        onError={() => setHasError(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', filter: cssFilter }}
      />
      {clip.pixelFilter && <PausedWasmGrade clip={clip} src={src} filter={clip.pixelFilter} />}
    </AbsoluteFill>
  )
}

const ClipRenderer: React.FC<{ clip: Clip }> = ({ clip }) => {
  if (!validateClip(clip)) {
    return null
  }

  const opacity = clip.opacity ?? 1

  if (clip.mediaType === 'text' && clip.text) {
    return (
      <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', opacity }}>
        <div
          style={{
            fontSize: clip.fontSize || 48,
            fontWeight: 800,
            color: clip.fontColor || '#ffffff',
            textAlign: 'center',
            textShadow: '2px 2px 8px rgba(0,0,0,0.7)',
            padding: '0 40px',
          }}
        >
          {clip.text}
        </div>
      </AbsoluteFill>
    )
  }

  if (clip.isMissingAsset) {
    return (
      <AbsoluteFill
        style={{
          background: 'linear-gradient(135deg, rgba(42,42,42,0.95), rgba(22,22,22,0.95))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity,
        }}
      >
          <div
            style={{
              padding: '18px 24px',
              borderRadius: 12,
              border: '1px dashed rgba(251,191,36,0.55)',
              color: '#fbbf24',
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: 0.6,
            }}
          >
            Missing media asset
          </div>
        </AbsoluteFill>
      )
  }

  const trimProps = getSafeMediaTrimProps(clip)

  if (clip.mediaType === 'video' && clip.assetUrl) {
    return (
      <VideoClipRenderer
        clip={clip}
        opacity={opacity}
        trimBefore={trimProps.trimBefore}
        trimAfter={trimProps.trimAfter}
      />
    )
  }

  if (clip.mediaType === 'audio' && clip.assetUrl) {
    return (
      <AudioClipRenderer clip={clip} trimBefore={trimProps.trimBefore} trimAfter={trimProps.trimAfter} />
    )
  }

  if (clip.mediaType === 'image' && clip.assetUrl) {
    return (
      <ImageClipRenderer clip={clip} opacity={opacity} />
    )
  }

  return null
}

export interface TrackPreviewProps {
  tracks: Track[]
  totalFrames: number
  isProposed?: boolean
}

export const TrackPreviewComposition: React.FC<TrackPreviewProps> = ({
  tracks,
  isProposed = false,
}) => {
  const frame = useCurrentFrame()
  const glowOpacity = isProposed ? interpolate(frame % 60, [0, 30, 60], [0.35, 0.8, 0.35]) : 0
  // FIX: 1 - validate clips before preview render so bad trim values never hit Remotion.
  const safeTracks = tracks.map((track) => ({
    ...track,
    clips: track.clips.filter(validateClip),
  }))

  const hasMediaClips = safeTracks.some((track) =>
    track.clips.some((clip) => clip.assetUrl || clip.isMissingAsset || (clip.mediaType === 'text' && clip.text))
  )

  return (
    <AbsoluteFill
      style={{
        background: '#0e0e0e',
        outline: isProposed ? `2px solid rgba(99,160,255,${glowOpacity})` : 'none',
        boxShadow: isProposed ? `inset 0 0 60px rgba(99,160,255,${glowOpacity * 0.15})` : 'none',
      }}
    >
      {hasMediaClips && (
        <AbsoluteFill style={{ zIndex: 0 }}>
          {safeTracks.map((track) =>
            track.clips
              .filter((clip) => clip.assetUrl || clip.isMissingAsset || (clip.mediaType === 'text' && clip.text))
              .map((clip) => (
                <Sequence
                  key={clip.id}
                  from={clip.startFrame}
                  durationInFrames={clip.endFrame - clip.startFrame + 1}
                  layout="none"
                >
                  <ClipRenderer clip={clip} />
                </Sequence>
              ))
          )}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  )
}
