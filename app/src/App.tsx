import React, { useState } from 'react'
import { PlayerPanel }  from './components/PlayerPanel/PlayerPanel'
import { PreviewErrorBoundary } from './components/PlayerPanel/PreviewErrorBoundary'
import { Timeline }     from './components/Timeline/Timeline'
import { PromptModal }  from './components/PromptModal/PromptModal'
import { WasmPanel }    from './components/WasmPanel/WasmPanel'
import { AuthModal }    from './components/AuthModal/AuthModal'
import { AssetLibrary }  from './components/AssetLibrary/AssetLibrary'
import { UploadFirstCanvas } from './components/UploadFirstCanvas/UploadFirstCanvas'
import { ToastContainer } from './components/ToastContainer/ToastContainer'
import { Spinner } from './components/Spinner/Spinner'
import { useCommandK }        from './hooks/useCommandK'
import { useGhostPreviewKeys } from './hooks/useGhostPreviewKeys'
import { useProjectManager } from './hooks/useProjectManager'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import { useTimelineShortcuts } from './hooks/useTimelineShortcuts'
import { useAuth } from './lib/authContext'
import { useEditorStore }      from './store/useEditorStore'
import { toast } from './lib/toastStore'
import { exportEditedVideo } from './lib/videoExportService'
import { hasMissingRenderableMedia, hasUsableVideoClips } from './lib/editorUtils'

const App: React.FC = () => {
  const { user, loading: authLoading, signOut } = useAuth()
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showAssets, setShowAssets] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const isOnline = useOnlineStatus()
  
  // Initialize project manager (auto-save functionality)
  const { projectId, projectStatus, projectError, retryProjectInit, hasUnsavedChanges, forceSave } = useProjectManager()
  
  // Register Cmd+K / Ctrl+K global shortcut
  useCommandK()
  // Register Enter / Esc (proposal) + Cmd+Z/Y (undo/redo)
  useGhostPreviewKeys()
  useTimelineShortcuts()

  const compositionTree = useEditorStore((s) => s.compositionTree)
  const proposedComposition = useEditorStore((s) => s.proposedComposition)
  const totalFrames = useEditorStore((s) => s.totalFrames)
  const fps = useEditorStore((s) => s.fps)
  const undo = useEditorStore((s) => s.undo)
  const redo = useEditorStore((s) => s.redo)
  const hasPrimaryVideo = hasUsableVideoClips(compositionTree)
  const hasMissingMedia = hasMissingRenderableMedia(compositionTree)
  const isUploadFirst = !hasPrimaryVideo

  const handleExport = async () => {
    if (!hasPrimaryVideo) {
      toast.info('Upload and place a video on the timeline before exporting.')
      return
    }

    if (proposedComposition) {
      toast.info('Accept or reject the AI preview before exporting.')
      return
    }

    if (hasMissingMedia) {
      toast.error('Export is blocked because some media files are missing locally.')
      return
    }

    setExporting(true)
    setExportProgress(0)
    toast.info('Preparing your edited video for download...')

    try {
      const { blob, filename } = await exportEditedVideo({
        tracks: compositionTree,
        totalFrames,
        fps,
        onProgress: setExportProgress,
      })

      const downloadUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
      toast.success('Edited video downloaded successfully.')
    } catch (error) {
      console.error('Export failed:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to export the edited video')
    } finally {
      setExporting(false)
      setExportProgress(0)
    }
  }

  const handleSave = async () => {
    toast.info('Saving project...')
    try {
      await forceSave()
      toast.success('Project saved!')
    } catch (err) {
      toast.error('Save failed. Please try again.')
      console.error('Save error:', err)
    }
  }

  const handleSignOut = async () => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm(
        'You have unsaved changes. Sign out anyway? Your changes may be lost.'
      )
      if (!confirmed) return
    }
    await signOut()
  }

  // Show auth modal if not authenticated
  if (!authLoading && !user) {
    return (
      <>
        <AuthModal />
        <ToastContainer />
      </>
    )
  }

  // Show loading state while checking auth
  if (authLoading) {
    return (
      <div style={{
        height: '100vh',
        background: '#0f0f0f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#e94560', marginBottom: 20 }}>
            avi
          </div>
          <Spinner size="large" text="Initializing your workspace..." />
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: '#0f0f0f',
        overflow: 'hidden',
      }}
    >
      {/* ── App header ── */}
      <header
        style={{
          height: 52,
          background: 'linear-gradient(180deg, #1a1a1a 0%, #151515 100%)',
          borderBottom: '1px solid #2a2a2a',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          gap: 16,
          flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18, color: '#e94560' }}>✦</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>
            avi
          </span>
          <div style={{ 
            width: 1, 
            height: 20, 
            background: '#2a2a2a',
            margin: '0 8px' 
          }} />
          <span style={{ fontSize: 11, color: '#666', fontWeight: 500 }}>
            AI Video Editor
          </span>
        </div>

        {!isUploadFirst && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 16 }}>
            <button
              onClick={() => setShowAssets(!showAssets)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: showAssets ? '#e94560' : '#252525',
                border: '1px solid #333',
                borderRadius: 6,
                color: showAssets ? '#fff' : '#aaa',
                fontSize: 12,
                padding: '6px 12px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <span>📂</span>
              Assets
            </button>
            <button
              onClick={handleSave}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: hasUnsavedChanges ? '#252525' : '#1f1f1f',
                border: hasUnsavedChanges ? '1px solid #333' : '1px solid #2a2a2a',
                borderRadius: 6,
                color: hasUnsavedChanges ? '#aaa' : '#666',
                fontSize: 12,
                padding: '6px 12px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <span>💾</span>
              {hasUnsavedChanges ? 'Save •' : 'Saved'}
            </button>
            <button
              onClick={handleExport}
              disabled={exporting || hasMissingMedia || Boolean(proposedComposition)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: exporting ? '#1a6cf0' : '#252525',
                border: '1px solid #333',
                borderRadius: 6,
                color: exporting ? '#fff' : '#aaa',
                fontSize: 12,
                padding: '6px 12px',
                cursor: exporting || hasMissingMedia || Boolean(proposedComposition) ? 'not-allowed' : 'pointer',
                opacity: exporting || hasMissingMedia || Boolean(proposedComposition) ? 0.7 : 1,
                transition: 'all 0.2s',
              }}
              title={
                proposedComposition
                  ? 'Accept or reject the AI preview before exporting'
                  : hasMissingMedia
                    ? 'Missing local media blocks export'
                    : 'Download edited video'
              }
            >
              <span>⬇</span>
              {exporting ? `Exporting ${exportProgress}%` : 'Export'}
            </button>
            <button
              onClick={undo}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#252525',
                border: '1px solid #333',
                borderRadius: 6,
                color: '#aaa',
                fontSize: 12,
                padding: '6px 12px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <span>↩</span>
            </button>
            <button
              onClick={redo}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: '#252525',
                border: '1px solid #333',
                borderRadius: 6,
                color: '#aaa',
                fontSize: 12,
                padding: '6px 12px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <span>↪</span>
            </button>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* Project ID indicator */}
        {projectId && (
          <div style={{
            fontSize: 10,
            color: hasUnsavedChanges ? '#f59e0b' : '#555',
            background: '#1a1a1a',
            padding: '4px 8px',
            borderRadius: 4,
            fontFamily: 'monospace',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
            {hasUnsavedChanges && <span style={{ fontSize: 8 }}>●</span>}
            ID: {projectId.slice(0, 8)}...
          </div>
        )}

        {/* Offline indicator */}
        {!isOnline && (
          <div style={{
            fontSize: 11,
            color: '#f59e0b',
            background: 'rgba(245, 158, 11, 0.1)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            padding: '4px 10px',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <span>⚠</span>
            Offline
          </div>
        )}

        {/* User info and actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Keyboard shortcuts button */}
          <button
            onClick={() => setShowShortcuts(!showShortcuts)}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: 16,
              cursor: 'pointer',
              padding: '4px 8px',
              borderRadius: 4,
            }}
            title="Keyboard Shortcuts"
          >
            ⌨
          </button>

          {/* User avatar */}
          <div style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #e94560 0%, #1a6cf0 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            color: '#fff',
          }}>
            {user?.email?.charAt(0).toUpperCase() || 'U'}
          </div>
          
          <button
            onClick={handleSignOut}
            style={{
              background: '#252525',
              border: '1px solid #333',
              borderRadius: 6,
              color: '#888',
              fontSize: 12,
              padding: '6px 12px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            Sign Out
          </button>
        </div>
      </header>

      {!isUploadFirst ? (
        <>
          <WasmPanel />

          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
            {showAssets && (
              <div style={{ width: 260, flexShrink: 0, overflow: 'hidden' }}>
                <AssetLibrary projectId={projectId} />
              </div>
            )}
            <PreviewErrorBoundary>
              <PlayerPanel projectId={projectId} />
            </PreviewErrorBoundary>
          </div>

          <div style={{ height: 230, flexShrink: 0, position: 'relative', zIndex: 20 }}>
            <Timeline />
          </div>
        </>
      ) : (
        <UploadFirstCanvas
          projectId={projectId}
          projectStatus={projectStatus}
          projectError={projectError}
          onRetry={retryProjectInit}
        />
      )}

      {/* ── AI Prompt modal (rendered at root, above everything) ── */}
      <PromptModal />

      {/* ── Keyboard Shortcuts Modal ── */}
      {showShortcuts && (
        <>
          <div
            onClick={() => setShowShortcuts(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(4px)',
              zIndex: 40,
            }}
          />
          <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#1a1a1a',
            border: '1px solid #2a2a2a',
            borderRadius: 12,
            padding: '24px',
            minWidth: 320,
            zIndex: 50,
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          }}>
            <h3 style={{ 
              margin: '0 0 16px 0', 
              fontSize: 16, 
              fontWeight: 700, 
              color: '#fff' 
            }}>
              Keyboard Shortcuts
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { keys: '⌘K / Ctrl+K', action: 'Open AI Prompt' },
                { keys: '⌘Z / Ctrl+Z', action: 'Undo' },
                { keys: '⌘Y / Ctrl+Shift+Z', action: 'Redo' },
                { keys: 'Enter', action: 'Accept AI Proposal' },
                { keys: 'Esc', action: 'Reject AI Proposal / Close Modal' },
                { keys: 'Export', action: 'Download current edited video' },
                { keys: 'S', action: 'Split selected clip at playhead' },
                { keys: 'D', action: 'Duplicate selected clip' },
                { keys: 'Delete', action: 'Delete selected clip' },
                { keys: 'Space', action: 'Play/Pause' },
              ].map(({ keys, action }) => (
                <div key={keys} style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: '1px solid #2a2a2a',
                }}>
                  <span style={{ color: '#aaa', fontSize: 13 }}>{action}</span>
                  <kbd style={{
                    background: '#252525',
                    border: '1px solid #333',
                    borderRadius: 4,
                    padding: '4px 8px',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: '#888',
                  }}>
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowShortcuts(false)}
              style={{
                marginTop: 16,
                width: '100%',
                padding: '10px',
                background: '#252525',
                border: '1px solid #333',
                borderRadius: 6,
                color: '#fff',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Got it!
            </button>
          </div>
        </>
      )}
      
      {/* ── Toast notifications ── */}
      <ToastContainer />
    </div>
  )
}

export default App
