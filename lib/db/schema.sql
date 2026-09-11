PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  location TEXT,
  linkedin_url TEXT,
  portfolio_url TEXT,
  summary TEXT,
  raw_cv_text TEXT,
  sectors TEXT NOT NULL DEFAULT '[]',
  target_countries TEXT NOT NULL DEFAULT '[]',
  sources_enabled TEXT NOT NULL DEFAULT '[]',
  preferred_contracts TEXT NOT NULL DEFAULT '["cdi","cdd"]',
  extraction_confidence INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experiences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  company TEXT,
  location TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  bullet_points TEXT NOT NULL DEFAULT '[]',
  skills_used TEXT NOT NULL DEFAULT '[]',
  position_index INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (profile_id) REFERENCES profile(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS educations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  school TEXT NOT NULL,
  degree TEXT,
  field TEXT,
  location TEXT,
  start_date TEXT,
  end_date TEXT,
  description TEXT,
  position_index INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (profile_id) REFERENCES profile(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  level TEXT,
  evidence_experience_ids TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (profile_id) REFERENCES profile(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS languages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  level TEXT,
  FOREIGN KEY (profile_id) REFERENCES profile(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS offres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  country TEXT,
  location TEXT,
  contract_type TEXT,
  salary TEXT,
  description_html TEXT NOT NULL,
  description_text TEXT NOT NULL,
  description_status TEXT NOT NULL DEFAULT 'ok',
  posted_at TEXT,
  scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
  score INTEGER DEFAULT 0,
  score_breakdown TEXT,
  is_vie INTEGER NOT NULL DEFAULT 0,
  raw_payload TEXT,
  scrape_errors TEXT,
  UNIQUE(source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_offres_score ON offres(score DESC);
CREATE INDEX IF NOT EXISTS idx_offres_posted ON offres(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_offres_country ON offres(country);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  offre_id INTEGER,
  file_path TEXT NOT NULL,
  format TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (offre_id) REFERENCES offres(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_offre ON documents(offre_id);

CREATE TABLE IF NOT EXISTS candidatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offre_id INTEGER,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'envoyee',
  notes TEXT,
  contact TEXT,
  deadline TEXT,
  cv_doc_id INTEGER,
  lm_doc_id INTEGER,
  msg_doc_id INTEGER,
  -- Snapshot fields for imported candidatures (no offre_id)
  ext_company TEXT,
  ext_title TEXT,
  ext_country TEXT,
  ext_url TEXT,
  ext_score INTEGER,
  FOREIGN KEY (offre_id) REFERENCES offres(id) ON DELETE SET NULL,
  FOREIGN KEY (cv_doc_id) REFERENCES documents(id) ON DELETE SET NULL,
  FOREIGN KEY (lm_doc_id) REFERENCES documents(id) ON DELETE SET NULL,
  FOREIGN KEY (msg_doc_id) REFERENCES documents(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  log TEXT NOT NULL DEFAULT '[]'
);
