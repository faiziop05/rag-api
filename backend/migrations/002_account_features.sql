-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Purely additive (IF NOT EXISTS everywhere) — safe to run even if some of it
-- already exists, and safe to run against a live database with existing rows.
--
-- Adds what's needed for: real profile editing, email verification, a
-- theme preference that syncs across devices, a real (persisted) email
-- notifications preference, and server-side chat history so conversations
-- survive a cleared browser / a different device — instead of only living
-- in localStorage.

-- ── Users: profile + preferences + verification ─────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme text NOT NULL DEFAULT 'dark';

-- ── Server-side chat history ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  knowledge_base_id text NOT NULL,
  title text NOT NULL DEFAULT 'New chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_threads_user_kb_idx ON chat_threads (user_id, knowledge_base_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  citations jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON chat_messages (thread_id, created_at);
