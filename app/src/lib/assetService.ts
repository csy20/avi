import { type Track } from '../store/useEditorStore'
import { deleteMediaBlob, loadMediaBlob, restoreMediaBlob, saveMediaBlob } from './mediaStorage'

export interface Asset {
  id: string
  project_id: string
  name: string
  file_type: 'video' | 'audio' | 'image'
  file_size: number | null
  duration_seconds: number | null
  playback_url: string
  thumbnail_url: string | null
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

const toAsset = (record: StoredAssetRecord, playbackUrl: string): Asset => ({
  id: record.id,
  project_id: record.project_id,
  name: record.name,
  file_type: record.file_type,
  file_size: record.file_size,
  duration_seconds: record.duration_seconds,
  playback_url: playbackUrl,
  thumbnail_url: record.thumbnail_url,
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

const resolveAssetPlaybackUrl = async (record: StoredAssetRecord): Promise<string | null> => {
  const indexedPlaybackUrl = await loadMediaBlob(record.id)
  if (indexedPlaybackUrl) {
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

  return toAsset(record, playbackUrl)
}

export async function getProjectAssets(projectId: string): Promise<Asset[]> {
  const database = await getDatabase()
  const transaction = database.transaction(STORE_NAME, 'readonly')
  const index = transaction.objectStore(STORE_NAME).index('project_id')
  const records = await requestToPromise(index.getAll(projectId))
  await transactionToPromise(transaction)

  const assets = await Promise.all(
    (records ?? []).map(async (record) => {
      const playbackUrl = await resolveAssetPlaybackUrl(record)
      return toAsset(record, playbackUrl ?? '')
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
      .filter((entry): entry is { assetId: string; record: StoredAssetRecord | null; playbackUrl: string } => Boolean(entry.playbackUrl))
      .map((entry) => [entry.assetId, entry.playbackUrl])
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
