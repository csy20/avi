import { type Track, useEditorStore } from '../store/useEditorStore'
import { allowMediaPath, desktopMediaUrl, ffmpegAvailable, generatePlaybackProxy, isDesktopApp, isSupportedMediaPath, localFileSize } from './desktop'
import { deleteMediaBlob, loadMediaBlob, restoreMediaBlob, saveMediaBlob } from './mediaStorage'
import { peaksFromArrayBuffer, useWaveformStore } from './waveformStore'

export interface Asset {
  id: string
  project_id: string
  name: string
  file_type: 'video' | 'audio' | 'image'
  file_size: number | null
  duration_seconds: number | null
  playback_url: string
  thumbnail_url: string | null
  local_path?: string | null
  preview_url?: string | null
  created_at: string
  mime_type: string | null
  width: number | null
  height: number | null
  status: 'ready' | 'missing'
}

interface StoredAssetRecord {
  id: string
  project_id: string
  name: string
  file_type: Asset['file_type']
  file_size: number | null
  duration_seconds: number | null
  thumbnail_url: string | null
  created_at: string
  mime_type: string | null
  width: number | null
  height: number | null
  status: 'ready' | 'missing'
  local_path?: string | null
  proxy_path?: string | null
  waveform?: number[] | null
  blob?: Blob
}

export interface UploadAssetOptions {
  file: File
  projectId?: string
}

const DB_NAME = 'avi-local-assets'
const DB_VERSION = 1
const STORE_NAME = 'assets'
const EXPORTED_FILE_NAME_PATTERN = /^avi-export-/i

let dbPromise: Promise<IDBDatabase> | null = null

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })

const transactionToPromise = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })

const getDatabase = async () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = () => {
        const database = request.result

        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('project_id', 'project_id', { unique: false })
        }
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
    })
  }

  return dbPromise
}

const toAsset = (record: StoredAssetRecord, playbackUrl: string, previewUrl?: string | null): Asset => ({
  id: record.id,
  project_id: record.project_id,
  name: record.name,
  file_type: record.file_type,
  file_size: record.file_size,
  duration_seconds: record.duration_seconds,
  playback_url: playbackUrl,
  thumbnail_url: record.thumbnail_url,
  local_path: record.local_path ?? null,
  preview_url: previewUrl ?? null,
  created_at: record.created_at,
  mime_type: record.mime_type ?? null,
  width: record.width ?? null,
  height: record.height ?? null,
  status: playbackUrl ? 'ready' : 'missing',
})

const createAssetId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const detectFileType = (file: File): Asset['file_type'] => {
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type.startsWith('image/')) return 'image'

  throw new Error('Unsupported file type. Please upload video, audio, or image files.')
}

const detectMediaMetadata = (file: File, fileType: Asset['file_type']) =>
  new Promise<{ durationSeconds: number | null; width: number | null; height: number | null }>((resolve, _reject) => {
    const TIMEOUT_MS = 15000
    const timeoutId = setTimeout(() => {
      URL.revokeObjectURL(objectUrl)
      resolve({ durationSeconds: null, width: null, height: null })
    }, TIMEOUT_MS)

    const cleanup = () => {
      clearTimeout(timeoutId)
      URL.revokeObjectURL(objectUrl)
    }

    if (fileType === 'image') {
      const image = new Image()
      const objectUrl = URL.createObjectURL(file)

      image.onload = () => {
        cleanup()
        resolve({
          durationSeconds: null,
          width: image.naturalWidth || null,
          height: image.naturalHeight || null,
        })
      }

      image.onerror = () => {
        cleanup()
        resolve({ durationSeconds: null, width: null, height: null })
      }

      image.src = objectUrl
      return
    }

    const media = document.createElement(fileType === 'audio' ? 'audio' : 'video')
    const objectUrl = URL.createObjectURL(file)

    media.preload = 'metadata'
    media.onloadedmetadata = () => {
      const durationSeconds = Number.isFinite(media.duration) ? media.duration : null
      cleanup()
      resolve({
        durationSeconds,
        width: fileType === 'video' ? (Number.isFinite((media as HTMLVideoElement).videoWidth) ? (media as HTMLVideoElement).videoWidth : null) : null,
        height: fileType === 'video' ? (Number.isFinite((media as HTMLVideoElement).videoHeight) ? (media as HTMLVideoElement).videoHeight : null) : null,
      })
    }

    media.onerror = () => {
      cleanup()
      resolve({ durationSeconds: null, width: null, height: null })
    }

    media.src = objectUrl
  })

const getAssetRecord = async (assetId: string): Promise<StoredAssetRecord | null> => {
  const database = await getDatabase()
  const transaction = database.transaction(STORE_NAME, 'readonly')
  const store = transaction.objectStore(STORE_NAME)
  const record = await requestToPromise(store.get(assetId))
  await transactionToPromise(transaction)
  return record ?? null
}

const putAssetRecord = async (record: StoredAssetRecord): Promise<void> => {
  const database = await getDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  transaction.objectStore(STORE_NAME).put(record)
  await transactionToPromise(transaction)
}

const rememberWaveform = (assetId: string, peaks: number[] | null | undefined) => {
  if (!peaks || peaks.length === 0) return
  useWaveformStore.getState().setPeaks(assetId, peaks)
}

const desktopPlaybackUrl = async (path: string | null | undefined): Promise<string | null> => {
  if (!path || !isDesktopApp()) return null
  try {
    await allowMediaPath(path)
  } catch {
    return null
  }
  return desktopMediaUrl(path)
}

const resolveAssetPlaybackUrl = async (record: StoredAssetRecord): Promise<string | null> => {
  const localPlaybackUrl = await desktopPlaybackUrl(record.local_path)
  if (localPlaybackUrl) {
    rememberWaveform(record.id, record.waveform)
    return localPlaybackUrl
  }

  const indexedPlaybackUrl = await loadMediaBlob(record.id)
  if (indexedPlaybackUrl) {
    rememberWaveform(record.id, record.waveform)
    return indexedPlaybackUrl
  }

  if (!(record.blob instanceof Blob)) {
    return null
  }

  const playbackUrl = await restoreMediaBlob(record.id, record.blob)
  const { blob: _legacyBlob, ...metadataRecord } = record
  await putAssetRecord({
    ...metadataRecord,
    mime_type: metadataRecord.mime_type ?? null,
    width: metadataRecord.width ?? null,
    height: metadataRecord.height ?? null,
    status: 'ready',
  })
  return playbackUrl
}

export async function uploadAsset({
  file,
  projectId,
}: UploadAssetOptions): Promise<Asset> {
  if (!projectId) {
    throw new Error('Project must be initialized before uploading assets')
  }

  if (EXPORTED_FILE_NAME_PATTERN.test(file.name)) {
    throw new Error('Exported files are excluded from source assets. Rename the file before importing.')
  }

  const fileType = detectFileType(file)

  const [{ durationSeconds, width, height }, thumbnailUrl] = await Promise.all([
    detectMediaMetadata(file, fileType),
    fileType === 'video' ? generateVideoThumbnail(file) : Promise.resolve(null),
  ])

  const assetId = createAssetId()
  const playbackUrl = await saveMediaBlob(assetId, file)

  const record: StoredAssetRecord = {
    id: assetId,
    project_id: projectId,
    name: file.name,
    file_type: fileType,
    file_size: file.size,
    duration_seconds: durationSeconds,
    thumbnail_url: thumbnailUrl,
    created_at: new Date().toISOString(),
    mime_type: file.type || null,
    width,
    height,
    status: 'ready',
  }

  try {
    await putAssetRecord(record)
  } catch (error) {
    await deleteMediaBlob(assetId)
    throw error
  }

  const asset = toAsset(record, playbackUrl)
  void captureWaveform(asset, file)
  return asset
}

export async function getProjectAssets(projectId: string): Promise<Asset[]> {
  const database = await getDatabase()
  const transaction = database.transaction(STORE_NAME, 'readonly')
  const index = transaction.objectStore(STORE_NAME).index('project_id')
  const records = await requestToPromise(index.getAll(projectId))
  await transactionToPromise(transaction)

  const assets = await Promise.all(
    (records ?? []).map(async (record) => {
      if (record.waveform && record.waveform.length > 0) {
        useWaveformStore.getState().setPeaks(record.id, record.waveform)
      }
      const playbackUrl = await resolveAssetPlaybackUrl(record)
      const previewUrl = await desktopPlaybackUrl(record.proxy_path)
      return toAsset(record, playbackUrl ?? '', previewUrl)
    })
  )

  return assets
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
}

export async function deleteAsset(assetId: string): Promise<void> {
  await deleteMediaBlob(assetId)

  const database = await getDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  transaction.objectStore(STORE_NAME).delete(assetId)
  await transactionToPromise(transaction)
}

export async function deleteProjectAssets(projectId: string): Promise<void> {
  const database = await getDatabase()
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  const store = transaction.objectStore(STORE_NAME)
  const index = store.index('project_id')
  const records = await requestToPromise(index.getAll(projectId))

  for (const record of records ?? []) {
    store.delete(record.id)
  }

  await transactionToPromise(transaction)
  await Promise.all((records ?? []).map((record) => deleteMediaBlob(record.id)))
}

export async function resolveTracksWithAssets(tracks: Track[], fps: number): Promise<Track[]> {
  const assetIds = Array.from(
    new Set(
      tracks.flatMap((track) => track.clips.map((clip) => clip.assetId).filter(Boolean)) as string[]
    )
  )

  const assetPayloads = await Promise.all(
    assetIds.map(async (assetId) => {
      const record = await getAssetRecord(assetId)
      const playbackUrl = record
        ? await resolveAssetPlaybackUrl(record)
        : await loadMediaBlob(assetId)

      return {
        assetId,
        record,
        playbackUrl,
        previewUrl: record ? await desktopPlaybackUrl(record.proxy_path) : null,
      }
    })
  )

  const recordMap = new Map(
    assetPayloads
      .map((entry) => entry.record)
      .filter((record): record is StoredAssetRecord => Boolean(record))
      .map((record) => [record.id, record])
  )
  const playbackUrlMap = new Map(
    assetPayloads
      .filter((entry): entry is { assetId: string; record: StoredAssetRecord | null; playbackUrl: string; previewUrl: string | null } => Boolean(entry.playbackUrl))
      .map((entry) => [entry.assetId, entry.playbackUrl])
  )
  const previewUrlMap = new Map(
    assetPayloads
      .filter((entry) => Boolean(entry.previewUrl))
      .map((entry) => [entry.assetId, entry.previewUrl as string])
  )

  return tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      if (!clip.assetId) return { ...clip }

      const record = recordMap.get(clip.assetId)
      const playbackUrl = record ? playbackUrlMap.get(clip.assetId) : undefined
      if (!playbackUrl) {
        return {
          ...clip,
          assetUrl: undefined,
          isMissingAsset: true,
        }
      }

      const mediaDurationFrames =
        clip.mediaDurationFrames ??
        (record?.duration_seconds != null ? Math.max(1, Math.round(record.duration_seconds * fps)) : undefined)

      return {
        ...clip,
        assetUrl: playbackUrl,
        previewUrl: previewUrlMap.get(clip.assetId),
        isMissingAsset: false,
        mediaDurationFrames,
      }
    }),
  }))
}

export async function generateVideoThumbnail(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true

    video.onloadeddata = () => {
      video.currentTime = Math.min(1, video.duration / 2)
    }

    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
      const context = canvas.getContext('2d')

      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      } else {
        resolve(null)
      }

      URL.revokeObjectURL(video.src)
    }

    video.onerror = () => {
      resolve(null)
      URL.revokeObjectURL(video.src)
    }

    video.src = URL.createObjectURL(file)
  })
}

const fileTypeFromName = (name: string): Asset['file_type'] => {
  const extension = name.split('.').pop()?.toLowerCase() ?? ''
  if (['mp4', 'mov', 'webm', 'mkv', 'm4v'].includes(extension)) return 'video'
  if (['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'].includes(extension)) return 'audio'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension)) return 'image'
  throw new Error('Unsupported file. Choose a video, audio file, or image.')
}

const metadataFromSrc = (src: string, fileType: Asset['file_type']) =>
  new Promise<{ durationSeconds: number | null; width: number | null; height: number | null }>((resolve) => {
    let settled = false
    const finish = (value: { durationSeconds: number | null; width: number | null; height: number | null }) => {
      if (settled) return
      settled = true
      if (src.startsWith('blob:')) URL.revokeObjectURL(src)
      resolve(value)
    }
    const timeoutId = window.setTimeout(() => {
      finish({ durationSeconds: null, width: null, height: null })
    }, 15000)

    const done = (value: { durationSeconds: number | null; width: number | null; height: number | null }) => {
      window.clearTimeout(timeoutId)
      finish(value)
    }

    if (fileType === 'image') {
      const image = new Image()
      image.onload = () => done({ durationSeconds: null, width: image.naturalWidth || null, height: image.naturalHeight || null })
      image.onerror = () => done({ durationSeconds: null, width: null, height: null })
      image.src = src
      return
    }

    const media = document.createElement(fileType === 'audio' ? 'audio' : 'video')
    media.preload = 'metadata'
    media.onloadedmetadata = () => {
      const video = media as HTMLVideoElement
      done({
        durationSeconds: Number.isFinite(media.duration) ? media.duration : null,
        width: fileType === 'video' && Number.isFinite(video.videoWidth) ? video.videoWidth : null,
        height: fileType === 'video' && Number.isFinite(video.videoHeight) ? video.videoHeight : null,
      })
    }
    media.onerror = () => done({ durationSeconds: null, width: null, height: null })
    media.src = src
  })

const thumbnailFromSrc = (src: string) =>
  new Promise<string | null>((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, (video.duration || 0) / 2)
    }
    video.onseeked = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 180
      const context = canvas.getContext('2d')
      resolve(context ? (context.drawImage(video, 0, 0, canvas.width, canvas.height), canvas.toDataURL('image/jpeg', 0.8)) : null)
    }
    video.onerror = () => resolve(null)
    video.src = src
  })

const WAVEFORM_BYTE_LIMIT = 40 * 1024 * 1024

export async function captureWaveform(asset: Asset, file?: File): Promise<void> {
  if (asset.file_type === 'image') return

  try {
    let bytes: ArrayBuffer | null = null
    if (file && file.size <= WAVEFORM_BYTE_LIMIT) {
      bytes = await file.arrayBuffer()
    } else if (
      asset.playback_url &&
      asset.file_size != null &&
      asset.file_size > 0 &&
      asset.file_size <= WAVEFORM_BYTE_LIMIT
    ) {
      const response = await fetch(asset.playback_url)
      if (!response.ok) return
      bytes = await response.arrayBuffer()
    }

    if (!bytes) return
    const peaks = await peaksFromArrayBuffer(bytes)
    if (!peaks) return

    useWaveformStore.getState().setPeaks(asset.id, peaks)
    const record = await getAssetRecord(asset.id)
    if (record) {
      await putAssetRecord({ ...record, waveform: peaks })
    }
  } catch {
    // A missing waveform still leaves the clip editable.
  }
}

export async function importLocalPath(path: string, projectId: string): Promise<Asset> {
  const name = path.split(/[/\\]/).pop() || 'media'
  if (EXPORTED_FILE_NAME_PATTERN.test(name)) {
    throw new Error('Exported files are excluded from source assets. Rename the file before importing.')
  }

  const fileType = fileTypeFromName(name)
  await allowMediaPath(path)
  const playbackUrl = await desktopMediaUrl(path)
  const [{ durationSeconds, width, height }, thumbnailUrl, fileSize] = await Promise.all([
    metadataFromSrc(playbackUrl, fileType),
    fileType === 'video' ? thumbnailFromSrc(playbackUrl) : Promise.resolve(null),
    localFileSize(path),
  ])

  const record: StoredAssetRecord = {
    id: createAssetId(),
    project_id: projectId,
    name,
    file_type: fileType,
    file_size: fileSize,
    duration_seconds: durationSeconds,
    thumbnail_url: thumbnailUrl,
    created_at: new Date().toISOString(),
    mime_type: null,
    width,
    height,
    status: 'ready',
    local_path: path,
  }

  await putAssetRecord(record)
  const asset = toAsset(record, playbackUrl)
  void captureWaveform(asset)
  return asset
}

export async function importMediaPaths(paths: string[], projectId: string): Promise<Asset[]> {
  const imported: Asset[] = []
  for (const path of paths) {
    if (!isSupportedMediaPath(path)) continue
    const asset = await importLocalPath(path, projectId)
    imported.push(asset)
    void schedulePlaybackProxy(asset).catch(() => undefined)
  }

  if (imported.length > 0) {
    window.dispatchEvent(new Event('avi:assets-changed'))
  }

  return imported
}

export async function schedulePlaybackProxy(asset: Asset): Promise<void> {
  if (!isDesktopApp() || asset.file_type !== 'video' || !asset.local_path) return
  if (!(await ffmpegAvailable())) return

  const proxyPath = await generatePlaybackProxy(asset.local_path, asset.id)
  const record = await getAssetRecord(asset.id)
  if (!record) return

  await putAssetRecord({ ...record, proxy_path: proxyPath })
  useEditorStore.getState().setAssetPreviewUrl(asset.id, await desktopMediaUrl(proxyPath))
}
