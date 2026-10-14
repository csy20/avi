import assert from 'node:assert/strict'
import test from 'node:test'
import type { Clip } from '../store/useEditorStore'
import { movedClipRange, rippleDelete, snapStart } from './timelineEdit.ts'

const clip = (id: string, startFrame: number, endFrame: number): Clip => ({
  id,
  trackId: 'track-1',
  startFrame,
  endFrame,
  label: id,
  color: '#fff',
})

test('movedClipRange keeps the clip duration', () => {
  assert.deepEqual(movedClipRange(10, 19, 40), { startFrame: 40, endFrame: 49 })
  assert.deepEqual(movedClipRange(10, 19, -4), { startFrame: 0, endFrame: 9 })
})

test('snapStart pulls the nearest edge inside the threshold', () => {
  assert.equal(snapStart(12, 10, [0, 10, 100], 8), 10)
  assert.equal(snapStart(92, 10, [100], 8), 90)
  assert.equal(snapStart(40, 10, [0], 8), 40)
})

test('rippleDelete closes the gap after the removed clip', () => {
  const clips = [clip('a', 0, 9), clip('b', 10, 19), clip('c', 30, 34)]
  const next = rippleDelete(clips, 'b')
  assert.deepEqual(
    next.map((item) => [item.id, item.startFrame, item.endFrame]),
    [
      ['a', 0, 9],
      ['c', 20, 24],
    ]
  )
})
