import aiosqlite
from backend.config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS style_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT,
    outline TEXT,
    meta_title TEXT,
    meta_description TEXT,
    slug TEXT,
    tags TEXT,
    categories TEXT,
    wp_site TEXT,
    wp_post_id INTEGER,
    status TEXT DEFAULT 'draft',
    settings TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS structure_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    structure TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wp_sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    user TEXT NOT NULL,
    app_password TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""

DEFAULT_STYLES = [
    ("Informacyjny", "Rzeczowy, obiektywny ton. Fakty i dane na pierwszym planie. Bez opinii autora."),
    ("Poradnikowy", "Praktyczne wskazowki krok po kroku. Bezposredni zwrot do czytelnika. Jasne instrukcje."),
    ("Ekspercki", "Gleboka analiza tematu. Profesjonalny jezyk branzy. Powolywanie sie na zrodla i dane."),
    ("Newsowy", "Krotkie zdania, odwrocona piramida. Najwazniejsze info na poczatku. Obiektywny ton."),
    ("Storytelling", "Narracyjny styl, angazujacy czytelnika. Przykladami i historiami ilustruje tezy."),
    ("SEO-agresywny", "Maksymalna optymalizacja pod slowa kluczowe. Naglowki z frazami. Duzo pytan i odpowiedzi."),
]


async def get_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def init_db():
    db = await get_db()
    try:
        await db.executescript(SCHEMA)
        for name, desc in DEFAULT_STYLES:
            await db.execute(
                "INSERT OR IGNORE INTO style_templates (name, description) VALUES (?, ?)",
                (name, desc),
            )
        await db.commit()
    finally:
        await db.close()


async def get_setting(key: str, default: str = "") -> str:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT value FROM settings WHERE key = ?", (key,))
        row = await cursor.fetchone()
        return row["value"] if row else default
    finally:
        await db.close()


async def set_setting(key: str, value: str):
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
            (key, value, value),
        )
        await db.commit()
    finally:
        await db.close()


async def get_all_wp_sites() -> list[dict]:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM wp_sites ORDER BY name")
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        await db.close()


async def get_wp_site_by_name(name: str) -> dict | None:
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM wp_sites WHERE name = ?", (name,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()
