import { convertFileSrc, invoke } from '@tauri-apps/api/core'

export const isDesktopApp = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'm4v']
const MEDIA_EXTENSIONS = [
  ...VIDEO_EXTENSIONS,
  'mp3',
  'wav',
  'aac',
  'm4a',
  'flac',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
]

export async function pickMediaPaths(videosOnly: boolean): Promise<string[]> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({
    multiple: true,
    title: videosOnly ? 'Open video' : 'Import media',
    filters: [
      {
        name: videosOnly ? 'Video' : 'Media',
        extensions: videosOnly ? VIDEO_EXTENSIONS : MEDIA_EXTENSIONS,
      },
    ],
  })

  if (!selected) return []
  return Array.isArray(selected) ? selected : [selected]
}

export async function allowMediaPath(path: string): Promise<void> {
  await invoke('allow_media_path', { path })
}

export function desktopMediaUrl(path: string): string {
  return convertFileSrc(path)
}

export function isSupportedMediaPath(path: string, videosOnly = false): boolean {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return (videosOnly ? VIDEO_EXTENSIONS : MEDIA_EXTENSIONS).includes(extension)
}

export async function localFileSize(path: string): Promise<number | null> {
  try {
    const info = await invoke<{ size: number }>('local_file_info', { path })
    return Number.isFinite(info.size) ? info.size : null
  } catch {
    return null
  }
}

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    const tools = await invoke<{ ffmpeg: boolean }>('media_tools')
    return tools.ffmpeg
  } catch {
    return false
  }
}

export async function generatePlaybackProxy(source: string, assetId: string): Promise<string> {
  return invoke<string>('generate_proxy', { source, assetId })
}

export async function saveExportFile(filename: string, blob: Blob): Promise<'saved' | 'downloaded' | 'cancelled'> {
  if (!isDesktopApp()) {
    downloadBlob(filename, blob)
    return 'downloaded'
  }

  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  const extension = filename.split('.').pop() || 'webm'
  const path = await save({
    defaultPath: filename,
    filters: [{ name: 'Video', extensions: [extension] }],
  })

  if (!path) return 'cancelled'

  await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
  return 'saved'
}

function downloadBlob(filename: string, blob: Blob) {
  const downloadUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = downloadUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
}
