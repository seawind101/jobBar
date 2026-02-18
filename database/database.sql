CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fb_id TEXT UNIQUE,
    username TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT,
    title TEXT,
    description TEXT,
    link TEXT,
    status TEXT,
    employee_id INTEGER,
    pay INTEGER
);

CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    description TEXT,
    link TEXT,
    owner_id INTEGER,
    pColor TEXT DEFAULT '#000000',
    sColor TEXT DEFAULT '#ffffff',
    bpColor TEXT DEFAULT '#ffffff',
    bsColor TEXT DEFAULT '#000000'
);


CREATE TABLE IF NOT EXISTS job_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    fb_id TEXT NOT NULL,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(job_id, fb_id)
);
