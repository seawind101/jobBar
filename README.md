# jobBar

A small job/issue board web application (Node.js + Express + EJS + SQLite).

This README explains how to run the app locally, what the main features are, and where to find key files in the project.

## Quick start — run the app (Windows / PowerShell)

1. Install dependencies:

```powershell
npm install
```

2. Initialize the database (this creates tables and seed data):

```powershell
npm run init-database
```
3. Copy the provided .env-template to .env, edit values, then start the server:

PowerShell:
```powershell
Copy-Item .env-template .env
# edit .env with your preferred editor
node app
# or use nodemon if you prefer:
npx nodemon app
```

macOS / Linux:
```bash
cp .env-template .env
# edit .env
node app
# or
npx nodemon app
```

4. Open your browser at http://localhost:3000 (or the port set in `PORT`).

If you prefer npm scripts for running, add a script such as `"start": "node app"` to `package.json` or use any process manager you like.

## Using the .env-template

Use the repository's `.env-template` as the source of truth — copy it to `.env` and update values for your environment. The template contains example values; if the template is missing, you can create a `.env` with keys like:

```
PORT=
SECRET=
AUTH_URL=http://localhost:4000/auth
THIS_URL=http://localhost:3000/login
MANAGERS=
CPOST=
JPOST=
EPOST=
```

- `SECRET` is used for express-session — keep it secret in production.  
- `MANAGERS` is a comma-separated list (or JSON array) of fb_id values for manager/admin views.  
- `CPOST` and `JPOST` are numeric defaults used by views for pricing (create-post / job-post amounts).

## What the app does (high level)

- Hosts companies, job postings (issues) and full-time positions.
- Users can apply to jobs (issues) and positions via an application form that accepts file uploads.
- Company owners can manage job applicants, accept and fire employees. When accepting an applicant they are added to `company_employees`.
- The app enforces that a user can be an employee of only one company at a time. Employed users are blocked from applying to positions, but may still apply to jobs (issues).
- Uploaded files are stored in the SQLite DB (BLOB) and relevant metadata is kept in `job_application_files`.

## Project structure (important files/folders)

- `app.js` — application bootstrap, middleware, session, route registration, and `app.listen`.
- `routes/` — Express route handlers (one file per resource). Important ones:
	- `routes/index.js` — home/index routes
	- `routes/login.js` — login/auth routes
	- `routes/job.js` — company job listing and job apply endpoint
	- `routes/Eform.js` — application form rendering and submission (handles file uploads)
	- `routes/position.js` — position apply endpoint
	- `routes/profile.js` — user profile page (applications, accepted work, employment)
	- `routes/jobManager.js` and `routes/positionManager.js` — company owner management pages (accept/fire applicants)
- `views/` — EJS templates used by the app (e.g. `profile.ejs`, `job.ejs`, `eJob.ejs`, `edit.ejs`).
- `public/` — static assets (CSS, JS, icons).
- `database/` — `database.sqlite` (SQLite DB) and `database.sql` (schema used by the init script).
- `scripts/initDatabase.js` — helper script run by `npm run init-database` to create tables and seed minimal data.

## Database notes

- The app uses SQLite at `./database/database.sqlite` by default.
- Tables include `users`, `companies`, `jobs`, `company_positions`, `job_applications`, `position_applications`, `job_application_files`, `job_applicant_details`, `company_employees`, `tags`, and `position_tags`.
- The `company_employees` table is used to track which fb_id (user) is employed by which company; business logic prevents being employed by more than one company at a time.

## Key application flows

- Applying to a job (issue):
	1. The user clicks Apply — this either posts to `/job/:jobId/apply` or goes to the application form `/eform?jobId=...`.
	2. The server creates a `job_applications` row and saves any uploaded files in `job_application_files`.

- Applying to a position:
	1. Apply redirects to `/eform?positionId=...` where the user completes the form and uploads files.
	2. The server blocks application submission if the user is already employed (server-side enforcement in `routes/Eform.js`).

- Accepting an applicant (company owner):
	- Owner uses job/position manager pages (`/jobManager/:companyName`, `/positionManager/:companyName`) to accept an applicant. The app sets job/position status, assigns `employee_id`, and inserts a `company_employees` row (INSERT OR IGNORE) to prevent duplicates.

## How the profile page popups work (recent UX updates)

- The profile page (`/profile`) shows applied and accepted jobs in the Issues box.
- Hovering an issue will show a floating popup with Title, Description, Link and Pay. Clicking the issue title locks the popup so the link can be clicked.

If you don't see the popup, make sure you served the latest files and clear your browser cache.

## Environment and security

- This project reads environment variables with `dotenv` — never commit production secrets to the repository.
- The app uses `express-session` with the `SECRET` env var. For production use a secure session store (Redis, etc.) and secure cookies.

## Common commands

- Install dependencies: `npm install`
- Initialize DB: `npm run init-database`
- Start server: `node app` (or `npm start` if configured)

## Troubleshooting

- Server doesn't start:
	- Check the terminal output for errors. Common problems: missing `SECRET` or inability to open `database/database.sqlite` (permissions).
	- Make sure `npm run init-database` has been run so tables exist.

- Popups or CSS not working:
	- Hard-refresh the browser (Ctrl+F5) to ensure you have the latest client files.
	- Open DevTools and check the Console for JS errors.

## Development notes

- Routes use `req.session.fb_id` to identify the user. Many actions check ownership using `owner_id` on companies.
- The code includes several defensive DB ALTER statements to add missing columns if an older DB schema is present. This helps with upgrades but also means migrations are non-atomic — be careful on production data.

## Contributing

- If you want to contribute, fork the repo and open a PR. Keep changes small and include tests or manual verification steps.

---
If you want, I can also:
- Add an example `.env.sample` to the repo.
- Move inline CSS/JS from templates into `public/css` / `public/js` for cleaner separation.
- Add scripts to `package.json` for common commands (`start`, `dev`, `migrate`).

Enjoy — if you want a trimmed README or additional developer docs (API reference, route list), tell me which sections to expand.