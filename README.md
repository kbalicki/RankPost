# RankPost

AI-powered article generator with WordPress publishing. Generate SEO-optimized blog posts using Claude or GPT, edit them with WYSIWYG editor, and publish directly to WordPress.

## Features

- **5-step wizard**: Form -> Outline (editable) -> Article (WYSIWYG) -> SEO/Tags/Categories -> Publish
- **Generator**: One-click article generation (outline + content + SEO + tags) with WP publish
- **Bulk generation**: Generate multiple articles from a list of topics with progress tracking
- **3 AI models**: Claude CLI (local), Claude API (Sonnet 4), GPT-4o
- **Internal linking**: AI suggests and inserts internal links to existing WP posts
- **SERP preview**: Live Google search result preview while editing SEO meta
- **Scheduling**: Schedule posts for future publication via WP REST API
- **Source scraping**: Scrape URLs or upload files (PDF, DOCX, XLSX, TXT) as source material
- **Style templates**: Save and reuse writing style instructions (CRUD)
- **Featured images**: Generate via DALL-E 3
- **AI-suggested categories**: Based on existing WP categories
- **Article history**: Browse, preview details, resume editing, delete
- **Dark/light mode**: Toggle with localStorage persistence
- **Multiple WP sites**: Manage several WordPress installations
- **Keyword research**: Google Suggest + Google Trends (pytrends) - free, no API key
- **Content score**: Word count, headings, links, images + AI quality analysis
- **Rewrite mode**: Scrape URL or paste text, AI rewrites with new structure
- **Structure templates**: Save reusable article structures (sections/headings)
- **Analytics dashboard**: WP site stats (published/drafts/scheduled/categories)
- **Image gallery**: Generate multiple DALL-E images, pick the best one

## Tech Stack

- **Backend**: Python FastAPI + SQLite (aiosqlite)
- **Frontend**: Vanilla HTML/JS + CSS (no framework)
- **AI**: `anthropic` + `openai` SDKs + Claude CLI
- **Scraper**: httpx + BeautifulSoup4 + readability-lxml
- **Keywords**: Google Suggest API + pytrends (Google Trends)
- **WordPress**: REST API + Application Passwords (Basic Auth)

## Setup

```bash
# 1. Clone and enter
cd RankPost

# 2. Create .env from example
cp .env.example .env

# 3. Run (auto-creates venv, installs deps, starts server)
./run.sh
```

Open `http://localhost:8000` in browser.

## Configuration

1. Go to **Settings** tab
2. Add API keys (OpenAI for GPT/DALL-E, Anthropic for Claude API)
3. Add WordPress sites (URL + login + Application Password)
4. Test connection

Claude CLI model works without API keys if `claude` is installed locally.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/outline` | Generate article outline |
| POST | `/api/generate-content` | Generate article from outline |
| POST | `/api/seo-meta` | Generate SEO meta data |
| POST | `/api/tags` | Generate tags |
| POST | `/api/suggest-categories` | AI-suggest WP categories |
| POST | `/api/featured-image` | Generate image via DALL-E 3 |
| POST | `/api/internal-links` | Add internal links to article |
| POST | `/api/publish` | Publish to WordPress |
| POST | `/api/generate-single` | Full pipeline (bulk item) |
| POST | `/api/scrape` | Scrape URLs |
| POST | `/api/upload-files` | Upload source files |
| GET/POST | `/api/settings` | API keys management |
| CRUD | `/api/wp-sites` | WordPress sites |
| CRUD | `/api/styles` | Style templates |
| CRUD | `/api/articles` | Article history |
| POST | `/api/keyword-research` | Google Suggest + Trends |
| POST | `/api/content-score` | Content quality analysis |
| POST | `/api/rewrite` | Rewrite/paraphrase content |
| CRUD | `/api/structure-templates` | Article structure templates |
| POST | `/api/image-gallery` | Generate multiple images |
| GET | `/api/wp-sites/{name}/analytics` | WP site analytics |

## Project Structure

```
RankPost/
├── backend/
│   ├── main.py              # FastAPI app, all routes
│   ├── config.py             # .env loading
│   ├── database.py           # SQLite schema & helpers
│   ├── ai/
│   │   └── client.py         # Claude & OpenAI wrappers
│   ├── content/
│   │   └── generator.py      # Prompt engineering for all AI tasks
│   ├── engine/
│   │   └── pipeline.py       # Orchestration steps
│   ├── scraper/
│   │   ├── scraper.py        # URL scraping
│   │   └── file_parser.py    # PDF/DOCX/XLSX parsing
│   └── wordpress/
│       └── client.py         # WP REST API client
├── frontend/
│   ├── index.html            # Single page app
│   ├── app.js                # All frontend logic
│   └── style.css             # Styles + dark mode
├── .env.example
├── requirements.txt
└── run.sh
```
