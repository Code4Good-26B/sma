# Database Setup

This folder contains the database setup files for the SMA news automation project.

The database is used as the shared state between the system components:

```text
Collector -> DB -> Processor -> DB -> Dashboard -> DB -> Publisher -> DB
```

For the full database contract, field ownership, statuses, and component responsibilities, see:

```text
docs/db_contract.md
```

---

## Files

- `schema.sql` - Creates the main database schema.
- `seed.sql` - Inserts sample data for development and testing.
- `retention_policy.sql` - Defines how old heavy fields are cleaned to keep the database small.
- `README.md` - Explains how to use the database setup files.

---

## Database setup

To initialize the database:

1. Create a Supabase project.
2. Open the Supabase SQL Editor.
3. Run `schema.sql`.
4. Run `seed.sql` if sample data is needed.

`schema.sql` should be treated as the source of truth for the actual database structure.

---

## Environment variables

Each developer should create a local `.env` file based on `.env.example`.

For direct database access, the main required variable is:

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE
```

Depending on the component implementation, additional Supabase variables may also be needed:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
```

Never commit a real `.env` file to GitHub.

`.env.example` should be committed to GitHub with placeholder values only.

---

## Component-specific setup

Each component owner is responsible for installing the dependencies required for their implementation language and framework.

Examples:

- Python components should install the Python packages they need.
- Node.js or TypeScript components should install the relevant npm packages.
- Frontend components should use the environment variables and client libraries required by their chosen implementation.

All components must follow the same database contract defined in:

```text
docs/db_contract.md
```

The DB contract is mandatory.

Language-specific helper files are optional.

---

## Optional Python DB helper

Python components may optionally use:

```text
shared/python/db_client.py
```

This helper reads `DATABASE_URL` from the local `.env` file and opens a PostgreSQL connection.

To use it, create and activate a Python virtual environment.

Create a virtual environment:

```bash
python -m venv .venv
```

Activate it on Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

Install the required Python packages:

```bash
pip install psycopg2-binary python-dotenv
```

In the future, Python dependencies can be managed with a `requirements.txt` file.

---

## DB access policy

Each component may connect to the database using the tools and language that fit its implementation.

Components implemented in different languages may use different database libraries, as long as they follow the same DB contract.

The important shared rules are:

- Use the field names defined in `schema.sql`.
- Follow the component ownership rules in `docs/db_contract.md`.
- Read and update only the fields owned by the component.
- Use the defined status workflow.
- Do not overwrite fields owned by other components.

---

## Retention policy

The file `retention_policy.sql` defines how old heavy fields are cleaned to keep the database small.

The current policy removes heavy raw fields from old completed items, such as:

- `raw_text`
- `raw_html`

The policy keeps important metadata, review decisions, summaries, source URLs, and publishing information.

This allows the system to stay lightweight while preserving useful history.

---

## Important notes

- GitHub stores the code and setup files, not real secrets.
- Real credentials should be shared privately and never committed.
- `.env` should never be committed to GitHub.
- `.env.example` should be committed to GitHub.
- `.venv/` should not be committed to GitHub.
- Each developer is responsible for their own local setup.
- Supabase is the shared hosted database for the project.
- The database contract is the source of truth for how components interact with the database.