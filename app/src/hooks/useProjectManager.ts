import { useEffect, useRef, useCallback, useState } from 'react'
import { useEditorStore } from '../store/useEditorStore'
import { useAuth } from '../lib/authContext'
import { createProject, getProject, updateProjectComposition, createAutoSave } from '../lib/projectService'
import { resolveTracksWithAssets } from '../lib/assetService'
import { normalizeTimeline, repairTracks } from '../lib/clipValidation'
import { LOCAL_PROJECT_ID, readLocalProject, writeLocalProject } from '../lib/localProject'
import { toast } from '../lib/toastStore'

export function useProjectManager() {
  const { user, loading: authLoading } = useAuth()
  const compositionTree = useEditorStore((state) => state.compositionTree)
  const totalFrames = useEditorStore((state) => state.totalFrames)
  const fps = useEditorStore((state) => state.fps)
  const hydrateProject = useEditorStore((state) => state.hydrateProject)

  const projectIdRef = useRef<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectStatus, setProjectStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [projectError, setProjectError] = useState<string | null>(null)
  const autoSaveRef = useRef(createAutoSave(3000))
  const isInitializingRef = useRef(false)
  const isInitialized = useRef(false)
  const initInFlightRef = useRef(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  const updateProjectId = useCallback((id: string) => {
    projectIdRef.current = id
    setProjectId(id)
  }, [])

  const finishReady = useCallback((id: string) => {
    updateProjectId(id)
    setHasUnsavedChanges(false)
    setProjectStatus('ready')
    isInitialized.current = true
  }, [updateProjectId])

  const initializeLocal = useCallback(async (cancelled: { value: boolean }) => {
    if (initInFlightRef.current) return
    initInFlightRef.current = true
    isInitializingRef.current = true
    isInitialized.current = false
    setProjectStatus('loading')
    setProjectError(null)

    try {
      const saved = readLocalProject()
      const editorState = useEditorStore.getState()
      const fpsValue = saved?.fps ?? editorState.fps
      const resolvedTracks = await resolveTracksWithAssets(saved?.tracks ?? [], fpsValue)
      if (cancelled.value) return

      const repairedTimeline = repairTracks(resolvedTracks)
      const normalizedTimeline = normalizeTimeline(repairedTimeline.tracks)
      finishReady(LOCAL_PROJECT_ID)
      hydrateProject({
        tracks: normalizedTimeline.tracks,
        totalFrames: Math.max(0, (saved?.totalFrames ?? editorState.totalFrames) - normalizedTimeline.offsetFrames),
        fps: fpsValue,
      })

      const missingCount = normalizedTimeline.tracks
        .flatMap((track) => track.clips)
        .filter((clip) => clip.assetId && clip.isMissingAsset)
        .length
      if (missingCount > 0) {
        toast.warning(`${missingCount} media file${missingCount === 1 ? '' : 's'} missing from local storage. Re-import from Assets to restore playback.`)
      }
    } catch (error) {
      console.error('Local project load failed:', error)
      if (!cancelled.value) {
        setProjectError(error instanceof Error ? error.message : 'local project load failed')
        setProjectStatus('error')
      }
    } finally {
      initInFlightRef.current = false
      if (!cancelled.value) {
        isInitializingRef.current = false
      }
    }
  }, [finishReady, hydrateProject])

  const initializeProject = useCallback(async (cancelled: { value: boolean }) => {
    if (initInFlightRef.current) return
    initInFlightRef.current = true
    isInitializingRef.current = true
    isInitialized.current = false
    setProjectStatus('loading')
    setProjectError(null)

    const userId = user?.id
    if (!userId) {
      initInFlightRef.current = false
      isInitializingRef.current = false
      setProjectError('auth/session missing — please sign in again')
      setProjectStatus('error')
      return
    }

    const createFreshProject = async (editorState: { compositionTree: ReturnType<typeof useEditorStore.getState>['compositionTree']; totalFrames: number; fps: number }) => {
      const project = await createProject({
        composition_tree: editorState.compositionTree,
        total_frames: editorState.totalFrames,
        fps: editorState.fps,
      })

      if (cancelled.value) return

      updateProjectId(project.id)
      localStorage.setItem('currentProjectId', project.id)
      setHasUnsavedChanges(false)
      setProjectStatus('ready')
      isInitialized.current = true
    }

    try {
      const editorState = useEditorStore.getState()
      const hasLocalTimeline = editorState.compositionTree.some((track) => track.clips.length > 0)
      if (projectIdRef.current === LOCAL_PROJECT_ID && hasLocalTimeline) {
        await createFreshProject({
          compositionTree: editorState.compositionTree,
          totalFrames: editorState.totalFrames,
          fps: editorState.fps,
        })
        return
      }

      const savedProjectId = localStorage.getItem('currentProjectId')

      if (!savedProjectId) {
        const editorState = useEditorStore.getState()
        await createFreshProject({ compositionTree: editorState.compositionTree, totalFrames: editorState.totalFrames, fps: editorState.fps })
        return
      }

      let project = null
      try {
        project = await getProject(savedProjectId)
      } catch {
        localStorage.removeItem('currentProjectId')
        const editorState = useEditorStore.getState()
        await createFreshProject({ compositionTree: editorState.compositionTree, totalFrames: editorState.totalFrames, fps: editorState.fps })
        return
      }

      if (!project) {
        localStorage.removeItem('currentProjectId')
        const editorState = useEditorStore.getState()
        await createFreshProject({ compositionTree: editorState.compositionTree, totalFrames: editorState.totalFrames, fps: editorState.fps })
        return
      }

      const resolvedTracks = await resolveTracksWithAssets(project.composition_tree || [], project.fps)
      if (cancelled.value) return

      // FIX: 3 - repair and normalize reloaded timelines so playback and viewport restart at frame 0.
      const repairedTimeline = repairTracks(resolvedTracks)
      const normalizedTimeline = normalizeTimeline(repairedTimeline.tracks)

      const missingCount = normalizedTimeline.tracks
        .flatMap((track) => track.clips)
        .filter((clip) => clip.assetId && clip.isMissingAsset)
        .length

      updateProjectId(project.id)
      hydrateProject({
        tracks: normalizedTimeline.tracks,
        totalFrames: Math.max(0, project.total_frames - normalizedTimeline.offsetFrames),
        fps: project.fps,
      })
      localStorage.setItem('currentProjectId', project.id)
      setHasUnsavedChanges(false)
      setProjectStatus('ready')

      if (missingCount > 0) {
        // FIX: 2 - prompt the user to re-upload any asset that is missing locally after reload.
        toast.warning(`${missingCount} media file${missingCount === 1 ? '' : 's'} missing from local storage. Re-upload from Assets to restore playback.`)
      }

      if (repairedTimeline.removedCount > 0 || repairedTimeline.repairedCount > 0 || normalizedTimeline.offsetFrames !== 0) {
        toast.info(
          `Timeline repaired on load${normalizedTimeline.offsetFrames !== 0 ? ` and shifted by ${normalizedTimeline.offsetFrames} frame${normalizedTimeline.offsetFrames === 1 ? '' : 's'}` : ''}.`
        )
      }
    } catch (error) {
      console.error('Project initialization failed:', error)
      localStorage.removeItem('currentProjectId')

      if (!cancelled.value) {
        const message =
          error instanceof Error ? error.message : 'project create failed — unknown error'
        setProjectError(message)
        setProjectStatus('error')
        toast.error('Failed to set up project. Use Retry in the canvas.')
      }
    } finally {
      initInFlightRef.current = false
      if (!cancelled.value) {
        isInitializingRef.current = false
      }
    }
  }, [user, hydrateProject, updateProjectId])

  useEffect(() => {
    if (authLoading) return

    const cancelled = { value: false }
    if (user) {
      void initializeProject(cancelled)
    } else {
      void initializeLocal(cancelled)
    }

    return () => {
      cancelled.value = true
    }
  }, [user, authLoading, initializeProject, initializeLocal])

  const retryProjectInit = useCallback(async () => {
    initInFlightRef.current = false
    const cancelled = { value: false }
    if (!user) {
      await initializeLocal(cancelled)
      return
    }
    await initializeProject(cancelled)
  }, [user, initializeLocal, initializeProject])

  useEffect(() => {
    if (authLoading || !projectIdRef.current || isInitializingRef.current) return

    if (!isInitialized.current) {
      isInitialized.current = true
      return
    }

    if (!user) {
      writeLocalProject({ tracks: compositionTree, totalFrames, fps })
      setHasUnsavedChanges(false)
      return
    }

    autoSaveRef.current.schedule(async () => {
      try {
        await updateProjectComposition(projectIdRef.current!, compositionTree, totalFrames, fps)
        setHasUnsavedChanges(false)
      } catch (error) {
        console.error('Auto-save failed:', error)
        toast.error('Failed to auto-save. Please use the Save button.')
      }
    })

    setHasUnsavedChanges(true)
  }, [authLoading, compositionTree, totalFrames, fps, user])

  const forceSave = useCallback(async () => {
    if (!user) {
      const state = useEditorStore.getState()
      writeLocalProject({
        tracks: state.compositionTree,
        totalFrames: state.totalFrames,
        fps: state.fps,
      })
      setHasUnsavedChanges(false)
      return
    }

    if (!projectIdRef.current) return

    await autoSaveRef.current.flush()
    setHasUnsavedChanges(false)
  }, [user])

  useEffect(() => {
    const handleReconnect = () => {
      if (projectIdRef.current && user) {
        autoSaveRef.current.flush().catch(console.error)
      }
    }

    window.addEventListener('avi:reconnect', handleReconnect)
    return () => window.removeEventListener('avi:reconnect', handleReconnect)
  }, [user])

  useEffect(() => {
    if (!hasUnsavedChanges) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  return {
    projectId,
    projectStatus,
    projectError,
    retryProjectInit,
    forceSave,
    hasUnsavedChanges,
  }
}
