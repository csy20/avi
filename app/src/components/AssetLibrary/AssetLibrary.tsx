import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useEditorStore, type Track } from '../../store/useEditorStore'
import {
  uploadAsset,
  getProjectAssets,
  deleteAsset,
  importMediaPaths,
  type Asset,
} from '../../lib/assetService'
import { isDesktopApp, pickMediaPaths } from '../../lib/desktop'
import { toast } from '../../lib/toastStore'
import { Spinner } from '../Spinner/Spinner'

// ── Helpers ─────────────────────────────────────────────────────────────────

const MEDIA_TYPE_ICONS: Record<string, string> = {
  video: '🎬',
  audio: '🎵',
  image: '🖼',
}

const TRACK_TYPE_MAP: Record<string, Track['type']> = {
  video: 'video',
  audio: 'audio',
  image: 'overlay',
}

// ── Component ───────────────────────────────────────────────────────────────

interface AssetLibraryProps {
  projectId: string | null
}

export const AssetLibrary: React.FC<AssetLibraryProps> = ({ projectId }) => {
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fps = useEditorStore((s) => s.fps)
  const addAssetToTrackType = useEditorStore((s) => s.addAssetToTrackType)
  const markAssetMissing = useEditorStore((s) => s.markAssetMissing)

  // ── Load assets ──────────────────────────────────────────────────────────
  const loadAssets = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const data = await getProjectAssets(projectId)
      setAssets(data)
    } catch (err) {
      console.error('Failed to load assets:', err)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  useEffect(() => {
    const refresh = () => {
      void loadAssets()
    }
    window.addEventListener('avi:assets-changed', refresh)
    return () => window.removeEventListener('avi:assets-changed', refresh)
  }, [loadAssets])

  const importDesktopPaths = async (paths: string[]) => {
    if (!projectId) {
      toast.error('No project available. Please wait for project to initialize.')
      return
    }
    if (paths.length === 0) return

    setUploading(true)
    try {
      const imported = await importMediaPaths(paths, projectId)
      if (imported.length === 0) {
        toast.error('Choose a video, audio, or image file.')
        return
      }
      setAssets((prev) => {
        const ids = new Set(imported.map((asset) => asset.id))
        return [...imported, ...prev.filter((asset) => !ids.has(asset.id))]
      })
      toast.success(imported.length === 1 ? `${imported[0].name} imported` : `${imported.length} files imported`)
    } catch (err) {
      console.error('Import failed:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to import file. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  // ── Upload handler ───────────────────────────────────────────────────────
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    console.log('[AssetLibrary] Upload triggered, file:', file?.name, 'projectId:', projectId)
    if (!file) return

    if (!projectId) {
      toast.error('No project available. Please wait for project to initialize.')
      return
    }

    // Reset input so the same file can be re-selected
    e.target.value = ''

    // Validate file type
    const isVideo = file.type.startsWith('video/')
    const isAudio = file.type.startsWith('audio/')
    const isImage = file.type.startsWith('image/')
    if (!isVideo && !isAudio && !isImage) {
      toast.error('Please upload a video, audio, or image file.')
      return
    }

    // Validate file size (100MB max)
    if (file.size > 100 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 100MB.')
      return
    }

    setUploading(true)
    toast.info(`Uploading ${file.name}...`)

    try {
      const asset = await uploadAsset({
        file,
        projectId,
      })

      setAssets((prev) => [asset, ...prev])
      toast.success(`${file.name} uploaded successfully!`)
    } catch (err) {
      console.error('Upload failed:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to upload file. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  // ── Add to timeline ──────────────────────────────────────────────────────
  const handleAddToTimeline = async (asset: Asset) => {
    if (asset.status === 'missing' || !asset.playback_url) {
      toast.warning('This asset is missing locally. Re-upload it from the Assets panel to use it again.')
      return
    }

    const trackType = TRACK_TYPE_MAP[asset.file_type] || 'overlay'

    // Detect duration for video/audio
    let durationFrames = fps * 5 // default 5 seconds for images

    if ((asset.file_type === 'video' || asset.file_type === 'audio') && asset.duration_seconds) {
      durationFrames = Math.round(asset.duration_seconds * fps)
    }

    addAssetToTrackType(trackType, {
      assetUrl: asset.playback_url,
      assetId: asset.id,
      mediaType: asset.file_type as 'video' | 'audio' | 'image',
      label: asset.name,
      durationFrames,
      previewUrl: asset.preview_url ?? undefined,
    })

    toast.success(`Added "${asset.name}" to timeline`)
  }

  // ── Delete handler ───────────────────────────────────────────────────────
  const handleDelete = async (asset: Asset) => {
    if (confirmDelete !== asset.id) {
      setConfirmDelete(asset.id)
      return
    }

    try {
      await deleteAsset(asset.id)
      setAssets((prev) => prev.filter((a) => a.id !== asset.id))
      markAssetMissing(asset.id)
      toast.success(`Deleted "${asset.name}"`)
    } catch (err) {
      console.error('Delete failed:', err)
      toast.error('Failed to delete asset')
    } finally {
      setConfirmDelete(null)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#141414',
      borderRight: '1px solid #2a2a2a',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid #2a2a2a',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#ccc' }}>Assets</span>
        <span style={{
          fontSize: 10,
          color: '#555',
          background: '#252525',
          padding: '2px 6px',
          borderRadius: 4,
        }}>
          {assets.length}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => {
            if (!projectId) {
              toast.warning('Waiting for project to initialize...')
              return
            }
            if (!isDesktopApp()) {
              fileInputRef.current?.click()
              return
            }
            void pickMediaPaths(false)
              .then((paths) => importDesktopPaths(paths))
              .catch((err: unknown) => {
                toast.error(err instanceof Error ? err.message : 'Failed to open files')
              })
          }}
          disabled={uploading}
          style={{
            background: '#e94560',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            padding: '5px 12px',
            cursor: uploading ? 'not-allowed' : 'pointer',
            opacity: uploading ? 0.5 : 1,
          }}
        >
          {uploading ? 'Importing...' : isDesktopApp() ? '+ Import' : '+ Upload'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,audio/*,image/*"
          onChange={handleUpload}
          style={{ display: 'none' }}
        />
      </div>

      {/* Asset list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px',
      }}>
        {loading && (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <Spinner size="small" text="Loading assets..." />
          </div>
        )}

        {!loading && assets.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '32px 16px',
            color: '#555',
            fontSize: 12,
          }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>📂</div>
            <div>No assets yet</div>
            <div style={{ marginTop: 6, color: '#444', fontSize: 11 }}>
              {isDesktopApp() ? 'Import videos, audio, or images from this computer' : 'Upload videos, audio, or images to get started'}
            </div>
          </div>
        )}

        {assets.map((asset) => (
          <div
            key={asset.id}
            style={{
              background: '#1a1a1a',
              border: '1px solid #2a2a2a',
              borderRadius: 8,
              padding: '10px 12px',
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#3a3a3a')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#2a2a2a')}
          >
            {/* Type icon / thumbnail */}
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 6,
              background: '#252525',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              flexShrink: 0,
            }}>
              {asset.thumbnail_url ? (
                <img
                  src={asset.thumbnail_url}
                  alt={asset.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6 }}
                />
              ) : (
                MEDIA_TYPE_ICONS[asset.file_type] || '📄'
              )}
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12,
                color: '#ddd',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>
                {asset.name}
              </div>
              <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>
                {asset.file_type}
                {asset.duration_seconds && ` · ${asset.duration_seconds.toFixed(1)}s`}
                {asset.file_size && ` · ${(asset.file_size / 1024 / 1024).toFixed(1)}MB`}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <button
                onClick={() => handleAddToTimeline(asset)}
                title="Add to timeline"
                style={{
                  background: '#252525',
                  border: '1px solid #333',
                  borderRadius: 4,
                  color: '#aaa',
                  fontSize: 12,
                  padding: '4px 8px',
                  cursor: 'pointer',
                }}
              >
                + TL
              </button>
              <button
                onClick={() => handleDelete(asset)}
                title={confirmDelete === asset.id ? 'Click again to confirm' : 'Delete'}
                style={{
                  background: confirmDelete === asset.id ? 'rgba(233,69,96,0.2)' : '#252525',
                  border: `1px solid ${confirmDelete === asset.id ? '#e94560' : '#333'}`,
                  borderRadius: 4,
                  color: confirmDelete === asset.id ? '#e94560' : '#666',
                  fontSize: 12,
                  padding: '4px 6px',
                  cursor: 'pointer',
                }}
              >
                🗑
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
