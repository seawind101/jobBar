CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fb_id TEXT UNIQUE,
    username TEXT,
    pin TEXT,
    money INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company TEXT,
    title TEXT,
    description TEXT,
    link TEXT,
    status TEXT,
    employee_id TEXT,
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



CREATE TABLE IF NOT EXISTS job_application_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    field TEXT,
    path TEXT,
    original_name TEXT,
    data BLOB,
    mime TEXT
);

CREATE TABLE IF NOT EXISTS job_applicant_details (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL,
    first_name TEXT,
    last_name TEXT
    ,portfolio_link TEXT
);

-- Tags for positions (employment)
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS position_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    UNIQUE(position_id, tag_id)
);

CREATE TABLE IF NOT EXISTS company_employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    fb_id TEXT NOT NULL,
    UNIQUE(company_id, fb_id)
);

CREATE TABLE IF NOT EXISTS company_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT,
    employee_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS position_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position_id INTEGER NOT NULL,
    fb_id TEXT NOT NULL,
    applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(position_id, fb_id)
);