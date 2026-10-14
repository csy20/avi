import React, { useState, useRef } from 'react'
import { importLocalPath, schedulePlaybackProxy, uploadAsset } from '../../lib/assetService'
import { isDesktopApp, pickMediaPaths } from '../../lib/desktop'
import { useProjectManager } from '../../hooks/useProjectManager'
import { toast } from '../../lib/toastStore'
import { ButtonSpinner } from '../Spinner/Spinner'

interface AssetUploadProps {
  onUploadComplete?: (url: string, assetId: string) => void
}

export const AssetUpload: React.FC<AssetUploadProps> = ({ onUploadComplete }) => {
  const { projectId } = useProjectManager()
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file size (50MB limit)
    if (file.size > 50 * 1024 * 1024) {
      toast.error('File size must be less than 50MB')
      return
    }

    setUploading(true)

    try {
      toast.info('Uploading asset...')
      
      const asset = await uploadAsset({
        file,
        projectId: projectId || undefined,
      })

      toast.success(`"${file.name}" uploaded successfully!`)
      
      window.dispatchEvent(new Event('avi:assets-changed'))
      if (onUploadComplete) {
        onUploadComplete(asset.playback_url, asset.id)
      }
    } catch (error) {
      console.error('Upload failed:', error)
      toast.error('Failed to upload asset')
    } finally {
      setUploading(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  return (
    <div style={styles.container}>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,audio/*,image/*"
        onChange={handleFileSelect}
        disabled={uploading}
        style={{ display: 'none' }}
      />
      
      <button
        onClick={() => {
          if (!projectId) {
            toast.warning('Project is still initializing. Try again in a moment.')
            return
          }
          if (!isDesktopApp()) {
            fileInputRef.current?.click()
            return
          }

          setUploading(true)
          void pickMediaPaths(false)
            .then(async (paths) => {
              for (const path of paths) {
                const asset = await importLocalPath(path, projectId)
                toast.success(`"${asset.name}" imported`)
                void schedulePlaybackProxy(asset).catch(() => undefined)
                window.dispatchEvent(new Event('avi:assets-changed'))
                onUploadComplete?.(asset.playback_url, asset.id)
              }
            })
            .catch((error: unknown) => {
              toast.error(error instanceof Error ? error.message : 'Failed to import media')
            })
            .finally(() => setUploading(false))
        }}
        disabled={uploading}
        style={{
          ...styles.button,
          opacity: uploading ? 0.6 : 1,
          cursor: uploading ? 'not-allowed' : 'pointer',
        }}
      >
        {uploading ? (
          <>
            <ButtonSpinner />
            <span>Uploading...</span>
          </>
        ) : (
          <>
            <span style={{ fontSize: 16 }}>📁</span>
            <span>Upload Asset</span>
          </>
        )}
      </button>

      {uploading && (
        <>
          <style>{'@keyframes assetUploadShimmer { to { background-position: -200% center; } }'}</style>
          <div style={styles.shimmer} />
        </>
      )}

      <div style={styles.hint}>
        {isDesktopApp() ? 'Opens files from this computer. Nothing is uploaded.' : 'Supports video, audio, and image files (max 50MB)'}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: 16,
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '10px 16px',
    background: '#252525',
    border: '1px solid #333',
    borderRadius: 8,
    color: '#fff',
    fontSize: 13,
    fontWeight: 500,
    transition: 'all 0.2s',
  },
  shimmer: {
    height: 3,
    background: 'linear-gradient(90deg, transparent 0%, #e94560 50%, transparent 100%)',
    backgroundSize: '200%',
    animation: 'assetUploadShimmer 1.2s linear infinite',
  },
  hint: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
  },
}
