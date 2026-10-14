-- =====================================================
-- Supabase Schema for avi video editor
-- Run this in your Supabase SQL Editor
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. USERS TABLE (extends Supabase auth.users)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Policies for profiles
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Trigger to create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- 2. PROJECTS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL DEFAULT 'Untitled Project',
  description TEXT,
  thumbnail_url TEXT,
  fps INTEGER DEFAULT 30,
  total_frames INTEGER DEFAULT 150,
  schema_version INTEGER DEFAULT 1,  -- For future migrations
  composition_tree JSONB NOT NULL DEFAULT '[]'::jsonb,  -- Remotion JSON tree
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on projects
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Policies for projects
CREATE POLICY "Users can view their own projects"
  ON public.projects FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own projects"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own projects"
  ON public.projects FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own projects"
  ON public.projects FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_projects_user_id ON public.projects(user_id);
CREATE INDEX idx_projects_updated_at ON public.projects(updated_at DESC);

-- =====================================================
-- 3. ASSETS TABLE (for video/audio assets)
-- =====================================================
-- NOTE: Assets are currently stored in browser IndexedDB (assetService.ts),
-- NOT in this table. This table is a placeholder for future cloud storage.
-- Do not query this table from the app until cloud upload is implemented.
CREATE TABLE IF NOT EXISTS public.assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_type TEXT NOT NULL,  -- 'video', 'audio', 'image'
  file_size BIGINT,
  duration_seconds FLOAT,
  storage_url TEXT NOT NULL,
  thumbnail_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on assets
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

-- Policies for assets
CREATE POLICY "Users can view their own assets"
  ON public.assets FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own assets"
  ON public.assets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own assets"
  ON public.assets FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_assets_user_id ON public.assets(user_id);
CREATE INDEX idx_assets_project_id ON public.assets(project_id);

-- =====================================================
-- 4. STORAGE BUCKET SETUP (run in Supabase dashboard)
-- =====================================================
-- Go to Storage → Create bucket named "assets"
-- Set it to private
-- Add the following RLS policies in Storage:

-- Storage Policy: Allow authenticated users to upload
-- INSERT policy with condition: auth.role() = 'authenticated'

-- Storage Policy: Allow authenticated users to read their files
-- SELECT policy with condition: auth.role() = 'authenticated'

-- =====================================================
-- 5. UTILITY FUNCTIONS & MIGRATIONS
-- =====================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- 6. FUTURE MIGRATION HELPERS
-- =====================================================

-- Example: Migration function template for schema v2
-- CREATE OR REPLACE FUNCTION public.migrate_projects_v1_to_v2()
-- RETURNS void AS $$
-- BEGIN
--   UPDATE public.projects
--   SET 
--     composition_tree = transform_composition_data(composition_tree),
--     schema_version = 2
--   WHERE schema_version = 1;
-- END;
-- $$ LANGUAGE plpgsql;
