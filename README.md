# RAT — Repo Analysis Tool

RAT is a local-first dashboard for exploring Git repository history. It imports a repository from a remote URL or ZIP archive, indexes commit-level line changes, and presents repository, directory, file, commit-set, and author metrics.

## Features

- Import multiple repositories by Git URL or ZIP archive containing `.git`
- Live clone, extraction, and history-indexing progress
- Repository, directory, and file drill-down with breadcrumbs
- Added lines, removed lines, growth, churn, modifications, modification frequency, and churn rate
- Reference selection, committer-date ranges, manual commit sets, and author filtering
- Author churn and ownership, with `.mailmap` identities and manual identity merging
- Searchable, sortable, paginated file metrics
- Monthly added/removed-lines timeline
- Responsive dark interface with loading, empty, and error states

## Requirements

- Node.js 20 or newer
- npm
- Git CLI
- `unzip` for ZIP imports

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Production check and server:

```bash
npm run build
npm start
```

Runtime data is created under `data/` and is intentionally ignored by Git. Imported repositories and the SQLite database remain on the machine running RAT.

## Importing repositories

### Clone URL

Choose **Add repository → Clone URL**, paste a public Git URL (or one accessible through your local Git credentials), and start the import. RAT performs a full bare clone so the complete history is available.

### ZIP archive

Choose **Upload ZIP** and select an archive containing a working tree with its `.git` directory, or a bare Git repository. GitHub's “Download ZIP” archives omit `.git` and therefore cannot be analyzed.

## Metric semantics

For reference commit `hᵣ`, `H` is the filtered set of reachable non-merge commits. Merge commits are retained only as graph traversal nodes. Dates use committer timestamps.

- Added lines: `l⁺`
- Removed lines: `l⁻`
- Growth: `δ = l⁺ − l⁻`
- Churn: `λ = l⁺ + l⁻`
- Modifications: commits in `H` with nonzero churn on the file or subtree
- Modification frequency: `η = modifications / |H|`
- Churn rate: `ρ = churn / |H|`
- Author ownership: author churn divided by scope churn

Directory values recursively aggregate descendants. Binary files are excluded. Pure renames add no churn; an edited rename is attributed to its new path. Empty and binary-only commits still count toward `|H|`. A zero denominator produces zero.

## Architecture

- Next.js App Router, React, TypeScript, and Tailwind CSS
- SQLite through `better-sqlite3`
- One streamed `git log --all --numstat -M50%` ingestion pass per repository
- Batched transactional inserts and cached commit-reachability/path aggregations
- Recharts for timeline visualization

The HTTP API lives under `src/app/api/repos`; ingestion and metric logic are isolated in `src/lib`.

## Verification

The implementation has been checked with:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Repository totals, file metrics, directory rollups, references, committer-date ranges, manual commit sets, author filtering, and ownership were independently compared against Git CLI output on cJSON. ZIP ingestion was tested with a synthetic repository containing merge, rename, binary-file, and `.mailmap` cases.

## AI declaration

AI-assisted development tools were used for requirements analysis, implementation, debugging, UI construction, and test planning. Generated work was reviewed and validated using TypeScript, ESLint, production builds, browser smoke tests, API tests, and independent Git CLI metric comparisons.
