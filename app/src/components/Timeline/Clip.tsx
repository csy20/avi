import React, { useEffect, useRef } from 'react'
import { type Clip } from '../../store/useEditorStore'
import { useWaveformStore } from '../../lib/waveformStore'
import { PIXELS_PER_FRAME, TRACK_HEIGHT, CLIP_PADDING } from './constants'

interface Props {
  clip: Clip
  isSelected: boolean
  onSelect: (event: React.MouseEvent) => void
  onTrimStart: (event: React.MouseEvent, edge: 'left' | 'right') => void
}

export const ClipBlock: React.FC<Props> = ({ clip, isSelected, onSelect, onTrimStart }) => {
  const left = clip.startFrame * PIXELS_PER_FRAME
  const width = Math.max((clip.endFrame - clip.startFrame + 1) * PIXELS_PER_FRAME - 2, 6)
  const peaks = useWaveformStore((state) => (clip.assetId ? state.peaks[clip.assetId] : undefined))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const showWaveform = Boolean(peaks && peaks.length > 0 && (clip.mediaType === 'audio' || clip.mediaType === 'video'))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !peaks || peaks.length === 0) return

    const drawWidth = Math.max(1, width - 14)
    const drawHeight = TRACK_HEIGHT - CLIP_PADDING * 2 - 8
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.floor(drawWidth * ratio)
    canvas.height = Math.floor(drawHeight * ratio)
    const context = canvas.getContext('2d')
    if (!context) return

    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, drawWidth, drawHeight)
    context.fillStyle = 'rgba(255,255,255,0.55)'
    const barWidth = drawWidth / peaks.length
    peaks.forEach((peak, index) => {
      const barHeight = Math.max(1, peak * (drawHeight - 2))
      context.fillRect(index * barWidth, (drawHeight - barHeight) / 2, Math.max(1, barWidth - 0.4), barHeight)
    })
  }, [peaks, width])

  return (
    <div
      data-clip={clip.id}
      title={`${clip.label} [${clip.startFrame} – ${clip.endFrame}]`}
      onMouseDown={onSelect}
      style={{
        position: 'absolute',
        left,
        top: CLIP_PADDING,
        width,
        height: TRACK_HEIGHT - CLIP_PADDING * 2,
        background: clip.isMissingAsset ? 'rgba(104, 104, 104, 0.65)' : clip.color,
        borderRadius: 4,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        padding: '0 10px',
        cursor: 'grab',
        userSelect: 'none',
        boxShadow: isSelected ? '0 0 0 1px rgba(255,255,255,0.65), 0 2px 10px rgba(0,0,0,0.45)' : '0 1px 4px rgba(0,0,0,0.45)',
        border: clip.isMissingAsset
          ? '1px dashed rgba(255,255,255,0.45)'
          : isSelected
            ? '1px solid rgba(255,255,255,0.85)'
            : '1px solid rgba(255,255,255,0.12)',
        flexShrink: 0,
        opacity: clip.isMissingAsset ? 0.85 : 1,
      }}
    >
      <div
        data-resize-handle="left"
        onMouseDown={(event) => onTrimStart(event, 'left')}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 7,
          height: '100%',
          background: isSelected ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.14)',
          cursor: 'ew-resize',
        }}
      />

      {showWaveform && (
        <canvas
          ref={canvasRef}
          aria-hidden
          style={{
            position: 'absolute',
            left: 7,
            right: 7,
            bottom: 3,
            width: 'calc(100% - 14px)',
            height: 16,
            pointerEvents: 'none',
          }}
        />
      )}

      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#fff',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          paddingRight: clip.isMissingAsset ? 70 : 0,
          position: 'relative',
          zIndex: 1,
          textShadow: '0 1px 2px rgba(0,0,0,0.8)',
        }}
      >
        {clip.label}
      </span>

      {clip.isMissingAsset && (
        <span
          style={{
            position: 'absolute',
            right: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 9,
            fontWeight: 700,
            color: '#fbbf24',
            letterSpacing: 0.6,
          }}
        >
          MISSING
        </span>
      )}

      <div
        data-resize-handle="right"
        onMouseDown={(event) => onTrimStart(event, 'right')}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: 7,
          height: '100%',
          background: isSelected ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.14)',
          cursor: 'ew-resize',
        }}
      />
    </div>
  )
}
