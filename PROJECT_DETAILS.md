# avi: AI-Powered Video Editor

## Project Overview

**avi** is a local-first AI video editor that combines a modern timeline-based editing interface with artificial intelligence capabilities. It allows users to upload media assets (video, audio, images), arrange them on a timeline, and use AI prompts to modify their video compositions.

### Core Features

1. **Timeline-Based Editing** - Multi-track timeline for video, audio, and overlay tracks
2. **AI Prompt Integration** - Use natural language prompts to edit video compositions via Gemini AI
3. **WebAssembly Processing** - Client-side video processing using WebAssembly (Rust-compiled)
4. **Optional cloud sync** - Supabase auth and project persistence when configured. The editor runs offline without it
5. **Video Export** - Client-side WebM export through MediaRecorder, with 720p and 1080p presets
6. **Asset Library** - Browser uploads in IndexedDB, or native file references in the Tauri app

---

## Architecture

### Monorepo Structure

```
avi/
├── app/                    # Frontend (React + Vite)
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── hooks/        # Custom React hooks
│   │   ├── lib/          # Utility libraries & services
│   │   ├── store/        # Zustand state management
│   │   ├── wasm-pkg/     # WebAssembly module
│   │   └── remotion/     # Remotion compositions
│   └── package.json
│
├── api/                   # Backend (Express + Node.js)
│   ├── src/
│   │   ├── routes/       # API endpoints
│   │   └── middleware/   # Express middleware
│   └── package.json
│
├── src-tauri/             # Tauri 2 desktop shell
└── package.json           # Root workspace configuration
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend Framework | React 18 |
| Build Tool | Vite |
| State Management | Zustand |
| Preview | Remotion Player |
| Export | Canvas + MediaRecorder (WebM) |
| Desktop | Tauri 2 |
| WebAssembly | Rust (wasm-pack) |
| Backend | Express.js (optional) |
| Database/Auth | Supabase (optional) |
| AI Integration | Gemini when configured, local heuristics otherwise |
| Validation | Zod |

---

## Frontend Architecture (app/)

### Component Hierarchy

```
App.tsx
├── Header (toolbar)
│   ├── Logo & branding
│   ├── Asset Library toggle
│   ├── Save button
│   ├── Export button
│   ├── Undo/Redo buttons
│   ├── Project ID indicator
│   ├── Offline indicator
│   └── User info / Sign Out
│
├── WasmPanel (WASM video processor)
│
├── Main Content Area
│   ├── AssetLibrary (sidebar)
│   │   ├── Upload zone
│   │   └── Asset grid
│   │
│   └── PlayerPanel (video preview)
│       ├── Preview player
│       ├── Ghost preview bar
│       └── Error boundary
│
├── Timeline
│   ├── TimelineRuler (frame numbers)
│   ├── TimelineTrack (track container)
│   │   ├── Clip (media clip)
│   │   └── Playhead
│   ├── Selection overlay
│   └── Track controls
│
├── PromptModal (AI prompt interface)
│
├── AuthModal (login/signup)
│
├── UploadFirstCanvas (initial state)
│
└── ToastContainer (notifications)
```

### State Management

The editor uses **Zustand** for state management (`useEditorStore.ts`):

**Key State Properties:**
- `compositionTree: Track[]` - Current timeline composition
- `proposedComposition: Track[] | null` - AI-generated preview (pending acceptance)
- `playheadPosition: number` - Current frame position
- `selectedClip: SelectedClip | null` - Currently selected clip
- `totalFrames: number` - Total timeline duration
- `fps: number` - Frames per second (default: 30)
- `history: Track[][]` - Undo history stack
- `historyIndex: number` - Current position in history

**Key Actions:**
- `addClip()`, `removeClip()`, `trimClip()`, `splitClip()`, `duplicateClip()`
- `addTrack()` - Add video/audio/overlay tracks
- `undo()`, `redo()` - History navigation
- `openPrompt()`, `acceptProposal()`, `rejectProposal()` - AI workflow

### Authentication

Supabase Auth integration (`authContext.tsx`):
- Email/password sign-in and sign-up
- GitHub OAuth
- Session persistence with automatic token refresh

### Project Management

The `useProjectManager` hook handles:
- Project creation/loading from Supabase
- Auto-save every 3 seconds
- Manual save functionality
- Offline capability with IndexedDB
- Project repair on load

### Asset Management

- **Upload**: Files stored in IndexedDB for local access
- **Storage Service**: `mediaStorage.ts` handles IndexedDB operations
- **Asset Service**: `assetService.ts` resolves asset URLs and handles missing assets

---

## Backend Architecture (api/)

### API Endpoints

**Base URL:** `http://localhost:4000`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/health` | GET | No | Health check |
| `/api/prompt` | POST | Yes | AI prompt processing |
| `/api/projects` | GET | Yes | List projects (placeholder) |

### Prompt API (`/api/prompt`)

**Request:**
```typescript
{
  prompt: string;                           // User's AI instruction
  frameRange: { startFrame: number; endFrame: number } | null;  // Optional frame scope
  compositionContext: {
    tracks: Track[];                        // Current timeline
    totalFrames: number;
    fps: number;
  }
}
```

**Response:**
```typescript
{
  success: boolean;
  explanation: string;                      // What the AI did
  modifiedComposition: Composition;        // Modified timeline
}
```

### AI Processing Pipeline

1. **Validation** - Zod schema validates incoming request
2. **Context Building** - Constructs prompt with composition data
3. **Gemini API Call** - Sends to Google Gemini 2.0 Flash
4. **Response Parsing** - Extracts JSON from Gemini response
5. **Schema Validation** - Validates AI response structure
6. **Fallback Mode** - If API fails, uses mock LLM with heuristic mutations

### Mock LLM Capabilities

When Gemini API is unavailable, the fallback provides:
- Color changes (red, blue, green, purple, etc.)
- Clip extending/trimming by frame count
- Clip renaming
- Opacity adjustments
- Clip splitting at midpoint
- Text overlay addition
- Pixel filters: grayscale, sepia, invert, brightness, warm

### Authentication Middleware

Uses JWT validation via `express-jwt` and JWKS from Supabase:
- Validates Supabase access tokens
- Returns 401 on invalid/missing tokens
- Rate limiting: 10 requests per minute

---

## Key Modules & Services

### `videoExportService.ts`

Handles client-side video export:
- Composites tracks onto a canvas in realtime
- Applies WASM pixel filters when the frame can be read
- Records WebM with MediaRecorder at 720p or 1080p
- Saves through a native dialog in the desktop app, or a browser download on the web

### `clipValidation.ts`

Validates and repairs timeline state:
- Ensures clip start/end frames are valid
- Repairs orphaned clips
- Normalizes timeline offsets

### `projectService.ts`

Supabase project CRUD:
- `createProject()` - Create new project
- `getProject()` - Load project by ID
- `updateProjectComposition()` - Save timeline changes

### `supabaseClient.ts`

Creates a Supabase client only when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set. Otherwise the editor stays local.

---

## WebAssembly Module

Located in `app/src/wasm-pkg/`:
- Rust-compiled WASM for client-side processing
- Video frame manipulation
- Performance-critical operations

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Open AI prompt modal |
| `Cmd/Ctrl + Z` | Undo |
| `Cmd/Ctrl + Y` / `Cmd/Ctrl + Shift + Z` | Redo |
| `Enter` | Accept AI proposal |
| `Esc` | Reject AI proposal / Close modal |
| `S` | Split selected clip at playhead |
| `D` | Duplicate selected clip |
| `Delete` | Delete selected clip |
| `Space` | Play/Pause |

---

## Data Models

### Track
```typescript
{
  id: string;
  name: string;
  type: 'video' | 'audio' | 'overlay';
  clips: Clip[];
}
```

### Clip
```typescript
{
  id: string;
  trackId: string;
  startFrame: number;
  endFrame: number;
  label: string;
  color: string;
  assetUrl?: string;
  assetId?: string;
  mediaType?: 'video' | 'audio' | 'image' | 'text';
  mediaStart?: number;
  mediaEnd?: number;
  mediaDurationFrames?: number;
  opacity?: number;
  text?: string;           // For text overlays
  fontSize?: number;
  fontColor?: string;
  isMissingAsset?: boolean;
  status?: 'ready' | 'missing' | 'loading';
}
```

---

## Database Schema (Supabase)

```sql
-- Projects table
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  composition_tree JSONB NOT NULL,
  total_frames INTEGER NOT NULL,
  fps INTEGER NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security policies for user-owned projects
```

---

## Environment Variables

### Frontend (app/.env)
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

### Backend (api/.env)
```
PORT=4000
CORS_ORIGIN=http://127.0.0.1:3000
GEMINI_MODEL=gemini-3.6-flash
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GEMINI_API_KEY=your_gemini_api_key
```

---

## Running the Project

```bash
# Install dependencies
cd /path/to/avi
npm install

# Run both app and API concurrently
npm run dev

# Or run separately:
npm run dev:app     # Frontend on http://127.0.0.1:3000
npm run dev:api      # API on http://localhost:4000
npm run tauri:dev    # Desktop shell
```

---

## Known Bugs & Fixes

The codebase references several bug fixes (marked as FIX: comments):
- **FIX: BUG-B**: Missing clips should not inflate timeline duration
- **FIX: 1**: Split operations must create valid preview trim ranges
- **FIX: 2**: Missing assets require re-upload prompt
- **FIX: 3**: Repaired timelines should restart at frame 0

---

## Summary

avi is a local-first video editor that combines:
1. **Modern React frontend** with Vite for fast development
2. **Zustand state management** for complex timeline editing
3. **Remotion Player** for preview and a MediaRecorder WebM export
4. **WebAssembly** for client-side pixel filters
5. **Tauri 2** for the macOS, Windows, and Linux app
6. **Optional Supabase** for auth and project sync
7. **Optional Gemini**, with local keyword edits when the model is unavailable

The editor works offline. IndexedDB holds browser-uploaded media. The desktop app references files on disk. See `ARCHITECTURE.md` for the decisions behind the shell, proxies, and AI fallback.