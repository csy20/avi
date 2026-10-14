import { hasMissingRenderableMedia, hasUsableVideoClips } from './editorUtils'
import { applyPixelFilter } from './pixelFilter'
import { type Clip, type Track } from '../store/useEditorStore'

export const EXPORT_PRESETS = {
  '720p': { width: 1280, height: 720, videoBitsPerSecond: 5_000_000 },
  '1080p': { width: 1920, height: 1080, videoBitsPerSecond: 8_000_000 },
} as const

export type ExportPresetName = keyof typeof EXPORT_PRESETS

interface ExportVideoOptions {
  tracks: Track[]
  fps: number
  totalFrames: number
  preset?: ExportPresetName
  onProgress?: (progress: number) => void
}

interface ExportResult {
  blob: Blob
  filename: string
  mimeType: string
}

type MediaResource =
  | {
      kind: 'image'
      clip: Clip
      image: HTMLImageElement
    }
  | {
      kind: 'video'
      clip: Clip
      element: HTMLVideoElement
      source: MediaElementAudioSourceNode | null
    }
  | {
      kind: 'audio'
      clip: Clip
      element: HTMLAudioElement
      source: MediaElementAudioSourceNode | null
    }
  | {
      kind: 'text'
      clip: Clip
    }

const getSupportedMimeType = () => {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? null
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms)
    ),
  ])

const waitForImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Failed to load image asset: ${src}`))
    image.src = src
  })

const waitForMediaReady = (element: HTMLMediaElement) =>
  new Promise<void>((resolve, reject) => {
    if (element.readyState >= 2) {
      resolve()
      return
    }

    const handleReady = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error(`Failed to load media element: ${element.currentSrc || element.src}`))
    }
    const cleanup = () => {
      element.removeEventListener('loadeddata', handleReady)
      element.removeEventListener('canplay', handleReady)
      element.removeEventListener('error', handleError)
    }

    element.addEventListener('loadeddata', handleReady)
    element.addEventListener('canplay', handleReady)
    element.addEventListener('error', handleError)
  })

const loadMediaResources = async (
  tracks: Track[],
  audioContext: AudioContext,
  destination: MediaStreamAudioDestinationNode
) => {
  const resources = await Promise.all(
    tracks.flatMap((track) =>
      track.clips.map(async (clip): Promise<MediaResource | null> => {
        if (clip.mediaType === 'text' && clip.text) {
          return { kind: 'text', clip }
        }

        if (!clip.assetUrl || clip.isMissingAsset) {
          return null
        }

        if (clip.mediaType === 'image') {
          const image = await withTimeout(waitForImage(clip.assetUrl), 8000, clip.label)
          return { kind: 'image', clip, image }
        }

        if (clip.mediaType === 'video') {
          const element = document.createElement('video')
          element.src = clip.assetUrl
          element.crossOrigin = 'anonymous'
          element.preload = 'auto'
          element.muted = false
          element.playsInline = true

          await withTimeout(waitForMediaReady(element), 8000, clip.label)

          let source: MediaElementAudioSourceNode | null = null
          try {
            source = audioContext.createMediaElementSource(element)
            source.connect(destination)
          } catch {
            source = null
          }

          return { kind: 'video', clip, element, source }
        }

        if (clip.mediaType === 'audio') {
          const element = document.createElement('audio')
          element.src = clip.assetUrl
          element.crossOrigin = 'anonymous'
          element.preload = 'auto'
          element.muted = false

          await withTimeout(waitForMediaReady(element), 8000, clip.label)

          let source: MediaElementAudioSourceNode | null = null
          try {
            source = audioContext.createMediaElementSource(element)
            source.connect(destination)
          } catch {
            source = null
          }

          return { kind: 'audio', clip, element, source }
        }

        return null
      })
    )
  )

  return resources.filter((resource): resource is MediaResource => Boolean(resource))
}

const drawCover = (
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number
) => {
  const intrinsicWidth = 'videoWidth' in source ? source.videoWidth : 'naturalWidth' in source ? source.naturalWidth : width
  const intrinsicHeight = 'videoHeight' in source ? source.videoHeight : 'naturalHeight' in source ? source.naturalHeight : height

  const scale = Math.max(width / intrinsicWidth, height / intrinsicHeight)
  const drawWidth = intrinsicWidth * scale
  const drawHeight = intrinsicHeight * scale
  const x = (width - drawWidth) / 2
  const y = (height - drawHeight) / 2
  context.drawImage(source, x, y, drawWidth, drawHeight)
}

const drawTextClip = (context: CanvasRenderingContext2D, clip: Clip, width: number, height: number) => {
  context.save()
  context.fillStyle = clip.fontColor || '#ffffff'
  context.font = `800 ${clip.fontSize || 56}px system-ui`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.shadowColor = 'rgba(0,0,0,0.55)'
  context.shadowBlur = 24
  context.fillText(clip.text || '', width / 2, height / 2, width - 120)
  context.restore()
}

const paintFilteredSource = async (
  context: CanvasRenderingContext2D,
  scratch: CanvasRenderingContext2D,
  scratchCanvas: HTMLCanvasElement,
  source: CanvasImageSource,
  clip: Clip,
  width: number,
  height: number
) => {
  scratch.clearRect(0, 0, width, height)
  drawCover(scratch, source, width, height)

  if (clip.pixelFilter) {
    try {
      const image = scratch.getImageData(0, 0, width, height)
      const filtered = await applyPixelFilter(new Uint8Array(image.data), clip.pixelFilter)
      image.data.set(filtered)
      scratch.putImageData(image, 0, 0)
    } catch (error) {
      console.warn('Pixel filter skipped for an export frame', error)
    }
  }

  context.drawImage(scratchCanvas, 0, 0)
}

const getClipFrameOffset = (clip: Clip, elapsedFrames: number) => {
  const mediaStart = clip.mediaStart ?? 0
  return mediaStart + (elapsedFrames - clip.startFrame)
}

export async function exportEditedVideo({
  tracks,
  fps,
  totalFrames,
  preset = '720p',
  onProgress,
}: ExportVideoOptions): Promise<ExportResult> {
  const { width, height, videoBitsPerSecond } = EXPORT_PRESETS[preset]
  if (!hasUsableVideoClips(tracks)) {
    throw new Error('Upload a video to the timeline before exporting')
  }

  if (hasMissingRenderableMedia(tracks)) {
    throw new Error('Export is blocked because some media files are missing from local storage')
  }

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser does not support video export')
  }

  const mimeType = getSupportedMimeType()
  if (!mimeType) {
    throw new Error('This browser does not support WebM recording for export')
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  const scratchCanvas = document.createElement('canvas')
  scratchCanvas.width = width
  scratchCanvas.height = height
  const scratch = scratchCanvas.getContext('2d', { willReadFrequently: true })
  if (!context || !scratch) {
    throw new Error('Failed to create an export canvas')
  }

  const audioContext = new AudioContext()
  await audioContext.resume()
  const destination = audioContext.createMediaStreamDestination()
  const resources = await loadMediaResources(tracks, audioContext, destination)

  const canvasStream = canvas.captureStream(fps)
  const exportStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ])

  const chunks: BlobPart[] = []
  const recorder = new MediaRecorder(exportStream, {
    mimeType,
    videoBitsPerSecond,
  })

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data)
    }
  }

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error('Export recording failed'))
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
  })

  const resourceState = new Map<HTMLMediaElement, boolean>()
  const durationMs = Math.max((totalFrames / fps) * 1000, 1000)
  const startTime = performance.now()

  recorder.start(250)

  const syncMedia = async (resource: Extract<MediaResource, { element: HTMLMediaElement }>, elapsedFrames: number) => {
    const { clip, element } = resource
    const isActive = elapsedFrames >= clip.startFrame && elapsedFrames <= clip.endFrame
    const wasActive = resourceState.get(element) ?? false

    if (!isActive) {
      if (wasActive && !element.paused) {
        element.pause()
      }
      resourceState.set(element, false)
      return
    }

    const desiredTime = clamp(
      getClipFrameOffset(clip, elapsedFrames) / fps,
      0,
      Math.max(element.duration || 0, 0)
    )

    if (!wasActive) {
      try {
        element.currentTime = desiredTime
      } catch {
        // Ignore seek errors until enough data is buffered.
      }

      try {
        await element.play()
      } catch {
        // If playback is blocked, subsequent ticks will retry.
      }
    } else if (Number.isFinite(element.currentTime) && Math.abs(element.currentTime - desiredTime) > 0.3) {
      try {
        element.currentTime = desiredTime
      } catch {
        // Ignore drift correction failures.
      }
    }

    resourceState.set(element, true)
  }

  const renderFrame = async () => {
    const elapsedMs = performance.now() - startTime
    const elapsedFrames = Math.min(totalFrames - 1, Math.max(0, Math.floor((elapsedMs / 1000) * fps)))

    context.clearRect(0, 0, width, height)
    context.fillStyle = '#0e0e0e'
    context.fillRect(0, 0, width, height)

    for (const resource of resources) {
      if ('element' in resource) {
        await syncMedia(resource, elapsedFrames)
      }

      const isActive = elapsedFrames >= resource.clip.startFrame && elapsedFrames <= resource.clip.endFrame
      if (!isActive) continue

      context.save()
      context.globalAlpha = resource.clip.opacity ?? 1

      if (resource.kind === 'image') {
        await paintFilteredSource(context, scratch, scratchCanvas, resource.image, resource.clip, width, height)
      }

      if (resource.kind === 'video' && resource.element.readyState >= 2) {
        await paintFilteredSource(context, scratch, scratchCanvas, resource.element, resource.clip, width, height)
      }

      if (resource.kind === 'text') {
        drawTextClip(context, resource.clip, width, height)
      }

      context.restore()
    }

    onProgress?.(Math.min(100, Math.round((elapsedFrames / Math.max(totalFrames - 1, 1)) * 100)))

    if (elapsedMs < durationMs) {
      return new Promise<void>((resolve, reject) => {
        requestAnimationFrame(() => {
          renderFrame().then(resolve).catch(reject)
        })
      })
    }
  }

  let blob: Blob

  try {
    await renderFrame()
    recorder.stop()
    blob = await stopPromise
  } catch (error) {
    if (recorder.state !== 'inactive') {
      recorder.stop()
    }

    try {
      await stopPromise
    } catch {
      // Ignore recorder shutdown errors and preserve the original failure.
    }

    throw error
  } finally {
    resources.forEach((resource) => {
      if ('element' in resource) {
        resource.element.pause()
      }
    })

    exportStream.getTracks().forEach((track) => track.stop())
    canvasStream.getTracks().forEach((track) => track.stop())
    destination.stream.getTracks().forEach((track) => track.stop())

    if (audioContext.state !== 'closed') {
      await audioContext.close()
    }
  }

  const now = new Date()
  const filename = `avi-export-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.webm`

  return {
    blob,
    filename,
    mimeType,
  }
}
