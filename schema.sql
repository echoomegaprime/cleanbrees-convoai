-- Schema for cleanbrees-convoai
-- D1 Database: cleanbrees-db (1f72e1e8-e6aa-4ef7-a1e6-9b7c873abfe8)
-- NOTE: Shares D1 database with cleanbrees-api. See cleanbrees-api/schema.sql for full schema.
-- This file contains only the table(s) defined in cleanbrees-convoai source code.
-- Auto-generated from source code
-- Run: npx wrangler d1 execute cleanbrees-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT,
  caller_number TEXT,
  status TEXT,
  duration_seconds INTEGER,
  agent_id TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_call_logs_created ON call_logs(created_at DESC);
