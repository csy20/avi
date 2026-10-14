import assert from 'node:assert/strict'
import test from 'node:test'
import { readLocalProject, writeLocalProject } from './localProject.ts'

test('local project round-trips through storage', () => {
  const memory = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
    },
  })

  writeLocalProject({
    tracks: [],
    totalFrames: 150,
    fps: 30,
  })

  assert.deepEqual(readLocalProject(), {
    tracks: [],
    totalFrames: 150,
    fps: 30,
  })
})

test('a corrupt local project reads as empty', () => {
  const memory = new Map<string, string>([['avi.localProject.v1', '{not json']])
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
    },
  })

  assert.equal(readLocalProject(), null)
})
