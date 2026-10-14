import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion'

export const HelloComposition: React.FC = () => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()

  // Fade in over first 30 frames, fade out over last 30
  const opacity = interpolate(
    frame,
    [0, 30, durationInFrames - 30, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )

  // Gentle scale pulse
  const scale = interpolate(frame, [0, durationInFrames / 2, durationInFrames], [0.95, 1.05, 0.95])

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
      }}
    >
      {/* Colored rectangle */}
      <div
        style={{
          width: 320,
          height: 180,
          borderRadius: 16,
          background: 'linear-gradient(90deg, #e94560, #0f3460)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${scale})`,
          boxShadow: '0 8px 32px rgba(233,69,96,0.4)',
        }}
      >
        <span
          style={{
            fontSize: 32,
            fontWeight: 800,
            color: '#fff',
            fontFamily: 'sans-serif',
            letterSpacing: 2,
          }}
        >
          avi
        </span>
      </div>

      {/* Subtitle */}
      <p
        style={{
          marginTop: 24,
          fontSize: 18,
          color: 'rgba(255,255,255,0.7)',
          fontFamily: 'sans-serif',
          letterSpacing: 1,
        }}
      >
        Context-Aware AI Video Editor
      </p>

      {/* Frame counter (dev aid) */}
      <p
        style={{
          marginTop: 12,
          fontSize: 12,
          color: 'rgba(255,255,255,0.3)',
          fontFamily: 'monospace',
        }}
      >
        frame {frame}
      </p>
    </AbsoluteFill>
  )
}
