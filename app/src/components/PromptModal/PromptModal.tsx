import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useEditorStore, type Track } from '../../store/useEditorStore'
import { useAuth } from '../../lib/authContext'
import { toast } from '../../lib/toastStore'
import { hasUsableVideoClips } from '../../lib/editorUtils'
import { applyLocalPrompt } from '../../lib/localPrompt'

// ── Types shared with the API ──────────────────────────────────────────────────
export interface PromptRequest {
  prompt: string
  frameRange: { startFrame: number; endFrame: number } | null
  compositionContext: {
    tracks: Track[]
    totalFrames: number
    fps: number
  }
}

export interface PromptResponse {
  success: boolean
  explanation: string
  modifiedComposition: {
    tracks: Track[]
    totalFrames: number
    fps: number
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Clips whose range overlaps with the selection (or all clips if no selection). */
const restorePreviewUrls = (nextTracks: Track[], currentTracks: Track[]): Track[] => {
  const previews = new Map<string, string>()
  for (const track of currentTracks) {
    for (const clip of track.clips) {
      if (clip.assetId && clip.previewUrl) previews.set(clip.assetId, clip.previewUrl)
    }
  }

  return nextTracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => ({
      ...clip,
      previewUrl: clip.previewUrl ?? (clip.assetId ? previews.get(clip.assetId) : undefined),
    })),
  }))
}

const getContextClips = (tracks: Track[], range: { startFrame: number; endFrame: number } | null) => {
  if (!range) return tracks.flatMap((t) => t.clips)
  return tracks.flatMap((t) =>
    t.clips.filter((c) => c.startFrame <= range.endFrame && c.endFrame >= range.startFrame)
  )
}

// ── Component ─────────────────────────────────────────────────────────────────
export const PromptModal: React.FC = () => {
  const {
    isPromptOpen,
    closePrompt,
    currentSelection,
    compositionTree,
    totalFrames,
    fps,
    setProposedComposition,
  } = useEditorStore()
  const { session } = useAuth()

  const [prompt,   setPrompt]   = useState('')
  const [status,   setStatus]   = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [response, setResponse] = useState<PromptResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const canUseAi = hasUsableVideoClips(compositionTree)

  // Auto-focus input when modal opens
  useEffect(() => {
    if (isPromptOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setPrompt('')
      setStatus('idle')
      setResponse(null)
      setErrorMsg('')
    }
  }, [isPromptOpen])

  const handleSubmit = useCallback(async () => {
    const trimmedPrompt = prompt.trim()
    
    // Validation
    if (!trimmedPrompt) {
      toast.warning('Please enter a prompt')
      return
    }

    if (!canUseAi) {
      toast.info('Upload a video first, then AI can work on your timeline.')
      return
    }
    
    if (trimmedPrompt.length > 1000) {
      toast.error('Prompt too long (max 1000 characters)')
      return
    }

    if (status === 'loading') return

    setStatus('loading')
    setResponse(null)
    setErrorMsg('')

    const sanitizedPrompt = trimmedPrompt
      .replace(/[<>]/g, '')
      .substring(0, 1000)

    const stageLocal = (note: string) => {
      const local = applyLocalPrompt({
        prompt: sanitizedPrompt,
        frameRange: currentSelection,
        tracks: compositionTree,
        totalFrames,
        fps,
      })
      setResponse({
        success: true,
        explanation: `${local.explanation} ${note}`,
        modifiedComposition: {
          tracks: restorePreviewUrls(local.tracks, compositionTree),
          totalFrames: local.totalFrames,
          fps: local.fps,
        },
      })
      setStatus('done')
      toast.success('Local edit is ready to preview')
    }

    const accessToken = session?.access_token
    if (!accessToken) {
      stageLocal('(offline edit)')
      return
    }

    const body: PromptRequest = {
      prompt: sanitizedPrompt,
      frameRange: currentSelection,
      compositionContext: { tracks: compositionTree, totalFrames, fps },
    }

    try {
      const res = await fetch('/api/prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        throw new Error(`API error ${res.status}`)
      }

      const data: PromptResponse = await res.json()
      
      if (!data.modifiedComposition || !data.modifiedComposition.tracks) {
        throw new Error('Invalid response from AI: missing composition data')
      }

      setResponse({
        ...data,
        modifiedComposition: {
          ...data.modifiedComposition,
          tracks: restorePreviewUrls(data.modifiedComposition.tracks, compositionTree),
        },
      })
      setStatus('done')
      toast.success('AI response generated successfully!')
    } catch (err) {
      console.warn('Cloud prompt failed, using the local editor', err)
      stageLocal('(cloud model unavailable)')
    }
  }, [prompt, status, currentSelection, compositionTree, totalFrames, fps, canUseAi, session])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Instead of applying directly, stage as a ghost preview for side-by-side review
  const handlePreview = () => {
    if (response?.modifiedComposition.tracks) {
      setProposedComposition(response.modifiedComposition.tracks)
      closePrompt()
      // User now sees split-screen; presses Enter to accept or Esc to reject
    }
  }

  if (!isPromptOpen) return null

  const contextClips = getContextClips(compositionTree, currentSelection)

  return (
    <>
      {/* ── Backdrop ── */}
      <div
        onClick={closePrompt}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(2px)',
          zIndex: 40,
        }}
      />

      {/* ── Modal ── */}
      <div
        style={{
          position: 'fixed',
          top: '18%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 580,
          maxWidth: 'calc(100vw - 32px)',
          background: '#1c1c1c',
          border: '1px solid #333',
          borderRadius: 12,
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          zIndex: 50,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #2a2a2a',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, color: '#e94560' }}>✦ AI Prompt</span>
          <kbd
            style={{
              marginLeft: 'auto',
              fontSize: 10,
              color: '#555',
              background: '#252525',
              border: '1px solid #333',
              borderRadius: 4,
              padding: '2px 6px',
              fontFamily: 'monospace',
            }}
          >
            ⌘K
          </kbd>
          <button
            onClick={closePrompt}
            style={{
              background: 'none',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>

        {/* ── Context bar ── */}
        <div
          style={{
            padding: '8px 16px',
            background: '#181818',
            borderBottom: '1px solid #2a2a2a',
            fontSize: 11,
            color: '#666',
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span>
            <span style={{ color: '#444' }}>Range: </span>
            {currentSelection
              ? <span style={{ color: '#63a0ff' }}>{currentSelection.startFrame} → {currentSelection.endFrame}</span>
              : <span style={{ color: '#555' }}>full composition</span>
            }
          </span>
          <span>
            <span style={{ color: '#444' }}>Clips in context: </span>
            <span style={{ color: '#aaa' }}>
              {contextClips.map((c) => c.label).join(', ') || 'none'}
            </span>
          </span>
        </div>

        {/* ── Input ── */}
        <div style={{ padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 16, color: '#e94560', flexShrink: 0 }}>›</span>
          <input
            ref={inputRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              canUseAi
                ? 'e.g. "trim the intro, tighten the pause, and duplicate the ending shot"'
                : 'Upload a video first to unlock AI editing'
            }
            disabled={status === 'loading' || !canUseAi}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#f0f0f0',
              fontSize: 14,
              fontFamily: 'inherit',
              caretColor: '#e94560',
            }}
          />
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim() || status === 'loading' || !canUseAi}
            style={{
              background: status === 'loading' ? '#333' : '#e94560',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              padding: '6px 14px',
              cursor: status === 'loading' || !prompt.trim() || !canUseAi ? 'not-allowed' : 'pointer',
              opacity: !prompt.trim() || !canUseAi ? 0.4 : 1,
              flexShrink: 0,
              transition: 'background 0.15s',
            }}
          >
            {status === 'loading' ? 'Generating…' : 'Generate ↵'}
          </button>
        </div>

        {!canUseAi && (
          <div
            style={{
              margin: '0 16px 16px',
              padding: '12px 14px',
              background: 'rgba(26,108,240,0.08)',
              border: '1px solid rgba(26,108,240,0.22)',
              borderRadius: 8,
              fontSize: 12,
              color: '#9bbcff',
              lineHeight: 1.6,
            }}
          >
            Upload a video into the timeline first. Then AI can trim clips, shorten sections, split shots,
            duplicate beats, and refine the current edit.
          </div>
        )}

        {/* ── Response panel ── */}
        {status === 'error' && (
          <div
            style={{
              margin: '0 16px 16px',
              padding: '10px 14px',
              background: 'rgba(233,69,96,0.1)',
              border: '1px solid rgba(233,69,96,0.3)',
              borderRadius: 8,
              fontSize: 12,
              color: '#e94560',
            }}
          >
            ✕ {errorMsg}
          </div>
        )}

        {status === 'done' && response && (
          <div
            style={{
              margin: '0 16px 16px',
              border: '1px solid #2e2e2e',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {/* Explanation */}
            <div
              style={{
                padding: '10px 14px',
                background: 'rgba(5, 150, 105, 0.08)',
                borderBottom: '1px solid #2e2e2e',
                fontSize: 12,
                color: '#6ee7b7',
                lineHeight: 1.6,
              }}
            >
              <span style={{ color: '#059669', fontWeight: 700 }}>✓ </span>
              {response.explanation}
            </div>

            {/* Modified clips preview */}
            <div
              style={{
                padding: '10px 14px',
                background: '#181818',
                borderBottom: '1px solid #2a2a2a',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
              }}
            >
              {response.modifiedComposition.tracks.flatMap((t) =>
                t.clips.map((c) => (
                  <span
                    key={c.id}
                    style={{
                      fontSize: 11,
                      background: c.color + '33',
                      border: `1px solid ${c.color}66`,
                      color: '#ddd',
                      borderRadius: 4,
                      padding: '2px 8px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {c.mediaType === 'video' && <span title="Video">🎬</span>}
                    {c.mediaType === 'audio' && <span title="Audio">🎵</span>}
                    {c.mediaType === 'image' && <span title="Image">🖼</span>}
                    {c.mediaType === 'text' && <span title="Text">📝</span>}
                    {c.label}
                    {c.mediaType === 'text' && c.text && (
                      <span style={{ color: '#888', fontSize: 9 }}> "{c.text}"</span>
                    )}
                    {(c.mediaStart != null || c.mediaEnd != null) && (
                      <span style={{ color: '#666', fontSize: 9 }}>
                        [{c.mediaStart ?? 0}-{c.mediaEnd ?? '?'}]
                      </span>
                    )}
                    {c.opacity != null && c.opacity < 1 && (
                      <span style={{ color: '#888', fontSize: 9 }}>
                        {Math.round(c.opacity * 100)}%
                      </span>
                    )}
                  </span>
                ))
              )}
            </div>
            {/* Apply button */}
            <div
              style={{
                padding: '10px 14px',
                background: '#1c1c1c',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
              }}
            >
              <button
                onClick={() => setStatus('idle')}
                style={{
                  background: 'none',
                  border: '1px solid #333',
                  borderRadius: 6,
                  color: '#888',
                  fontSize: 12,
                  padding: '6px 14px',
                  cursor: 'pointer',
                }}
              >
                Discard
              </button>
              <button
                onClick={handlePreview}
                style={{
                  background: '#1a6cf0',
                  border: 'none',
                  borderRadius: 6,
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '6px 18px',
                  cursor: 'pointer',
                }}
              >
                Preview Split-Screen →
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
