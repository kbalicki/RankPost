import json
from backend.ai.client import generate_text, generate_image


def _parse_json_response(text: str, fallback=None):
    """Strip markdown fences and parse JSON. Return fallback on failure."""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text[:-3]
    try:
        return json.loads(text.strip())
    except (json.JSONDecodeError, ValueError):
        if fallback is not None:
            return fallback
        raise ValueError(f"AI zwrocilo nieprawidlowy JSON: {text[:200]}")


SYSTEM_PROMPT = """Jestes ekspertem SEO i copywriterem. Tworzysz artykuly zoptymalizowane pod wyszukiwarki.
Zasady:
- Pisz w formacie HTML (uzyj h2, h3, p, ul, ol, strong, em)
- Nie dodawaj tagu h1 - to bedzie tytul posta
- Kazdy akapit powinien miec 3-6 zdan
- Uzywaj naturalnie slow kluczowych
- Pisz angazujaco i merytorycznie
- Odpowiadaj TYLKO trescia artykulu, bez komentarzy"""


async def generate_outline(
    topic: str,
    source_texts: list[str],
    style_description: str,
    paragraphs_min: int,
    paragraphs_max: int,
    include_intro: bool,
    include_summary: bool,
    additional_notes: str,
    language: str,
    model: str,
) -> dict:
    sources_block = ""
    if source_texts:
        sources_block = "\n\n--- ZRODLA ---\n" + "\n---\n".join(source_texts[:5])

    lang_label = "polskim" if language == "pl" else "angielskim"

    prompt = f"""Stworz outline (plan) artykulu na temat: "{topic}"

Wymagania:
- Jezyk: {lang_label}
- Styl: {style_description}
- Liczba sekcji (akapitow z naglowkami H2): od {paragraphs_min} do {paragraphs_max}
- Wstep: {"tak" if include_intro else "nie"}
- Podsumowanie: {"tak" if include_summary else "nie"}

{f"Dodatkowe uwagi: {additional_notes}" if additional_notes else ""}
{sources_block}

Odpowiedz TYLKO w formacie JSON:
{{
  "title": "Tytul artykulu",
  "sections": [
    {{"heading": "Naglowek sekcji", "key_points": ["punkt 1", "punkt 2"]}}
  ]
}}"""

    result = await generate_text(prompt, system=SYSTEM_PROMPT, model=model, max_tokens=2048)
    return _parse_json_response(result, fallback={"title": topic, "sections": [{"heading": "Sekcja 1", "key_points": []}]})


async def generate_article_content(
    outline: dict,
    source_texts: list[str],
    style_description: str,
    additional_notes: str,
    language: str,
    model: str,
    target_length: int,
) -> str:
    sources_block = ""
    if source_texts:
        sources_block = "\n\n--- ZRODLA DO INSPIRACJI (nie kopiuj, parafrazuj) ---\n" + "\n---\n".join(source_texts[:5])

    lang_label = "polskim" if language == "pl" else "angielskim"
    words_per_section = target_length // max(len(outline.get("sections", [])), 1)

    sections_desc = "\n".join(
        f"## {s['heading']}\nKluczowe punkty: {', '.join(s.get('key_points', []))}"
        for s in outline.get("sections", [])
    )

    prompt = f"""Napisz pelny artykul w jezyku {lang_label} wedlug ponizszego planu.

Tytul: {outline.get('title', '')}

Plan:
{sections_desc}

Wymagania:
- Styl: {style_description}
- Kazda sekcja powinna miec ok. {words_per_section} slow
- Calkowita dlugosc: ok. {target_length} slow
- Format: HTML (h2, h3, p, ul, ol, strong, em). Nie uzywaj h1.
- Pisz plynnie, z naturalnym ulokowaniem slow kluczowych

{f"Dodatkowe uwagi: {additional_notes}" if additional_notes else ""}
{sources_block}

Odpowiedz TYLKO trescia HTML artykulu, bez zadnych komentarzy."""

    return await generate_text(prompt, system=SYSTEM_PROMPT, model=model, max_tokens=max(4096, target_length * 3))


async def humanize_content(content: str, language: str = "pl", model: str = "claude") -> str:
    """Rewrite AI-generated content to sound naturally human-written."""
    lang_label = "polskim" if language == "pl" else "angielskim"
    prompt = f"""Przepisz ponizszy artykul HTML w jezyku {lang_label}, aby brzmial naturalnie i ludzko.

Zasady:
- Usun typowe wzorce AI: "W dzisiejszym swiecie...", "Warto zauwazyc, ze...", "Podsumowujac..."
- Dodaj osobiste zwroty: "Sprawdzilem to sam", "Z mojego doswiadczenia", "Szczerze mowiac"
- Uzywaj roznej dlugosci zdan - krotkie, srednie i dlugie na przemian
- Wstaw potoczne wyrazenia i idiomy tam gdzie pasuja
- Nie uzywaj perfekcyjnych przejsc miedzy akapitami - ludzie tak nie pisza
- Zachowaj wszystkie fakty, linki, naglowki i strukture HTML
- Czasem zacznij zdanie od "I", "Ale", "Bo" - naturalny jezyk
- Unikaj powtarzania tych samych przymiotnikow
- Zachowaj ten sam format HTML (h2, h3, p, ul, ol, strong, em, a)
- NIE dodawaj nowych linkow ani nie usuwaj istniejacych
- NIE zmieniaj naglowkow H2/H3

Artykul HTML:
{content}

Odpowiedz TYLKO przepisanym HTML artykulu, bez komentarzy."""

    return await generate_text(prompt, model=model, max_tokens=max(4096, len(content) * 2))


async def generate_seo_meta(title: str, content_preview: str, language: str, model: str) -> dict:
    lang_label = "polskim" if language == "pl" else "angielskim"
    prompt = f"""Na podstawie tytulu i fragmentu artykulu wygeneruj meta dane SEO w jezyku {lang_label}.

Tytul: {title}
Fragment: {content_preview[:2000]}

Odpowiedz TYLKO w formacie JSON:
{{
  "meta_title": "tytul SEO (max 60 znakow)",
  "meta_description": "opis SEO (max 155 znakow)",
  "slug": "slug-url-artykulu"
}}"""

    result = await generate_text(prompt, model=model, max_tokens=512)
    return _parse_json_response(result, fallback={"meta_title": title[:60], "meta_description": "", "slug": ""})


async def generate_tags(title: str, content_preview: str, tags_min: int, tags_max: int, language: str, model: str) -> list[str]:
    lang_label = "polskim" if language == "pl" else "angielskim"
    prompt = f"""Wygeneruj tagi (slowa kluczowe) dla artykulu w jezyku {lang_label}.

Tytul: {title}
Fragment: {content_preview[:2000]}

Wygeneruj od {tags_min} do {tags_max} tagow.
Odpowiedz TYLKO jako JSON array stringow, np: ["tag1", "tag2", "tag3"]"""

    result = await generate_text(prompt, model=model, max_tokens=512)
    return _parse_json_response(result, fallback=[])


async def suggest_categories(title: str, content_preview: str, available_categories: list[dict], model: str, cats_min: int = 1, cats_max: int = 3) -> list[int]:
    cats_list = ", ".join(f"{c['id']}:{c['name']}" for c in available_categories)
    prompt = f"""Wybierz najlepsze kategorie dla tego artykulu.

Tytul: {title}
Fragment: {content_preview[:1000]}

Dostepne kategorie (id:nazwa): {cats_list}

Wybierz od {cats_min} do {cats_max} najbardziej pasujacych kategorii.
Odpowiedz TYLKO jako JSON array z ID kategorii, np: [1, 5]"""

    result = await generate_text(prompt, model=model, max_tokens=256)
    return _parse_json_response(result, fallback=[])


FALLBACK_IMAGE_PROMPT = "Photorealistic high-quality photograph. Natural lighting, sharp focus. No text, no watermarks."

async def _get_image_style_prompt(style_name: str) -> str:
    """Fetch image style prompt from DB by name."""
    from backend.database import get_db
    db = await get_db()
    try:
        cursor = await db.execute("SELECT prompt FROM image_styles WHERE name = ?", (style_name,))
        row = await cursor.fetchone()
        return row["prompt"] if row else FALLBACK_IMAGE_PROMPT
    finally:
        await db.close()

async def generate_featured_image_url(title: str, image_style: str = "Fotorealistyczne") -> str:
    style_prompt = await _get_image_style_prompt(image_style)
    prompt = f"Blog header image for article: '{title}'. {style_prompt}"
    return await generate_image(prompt)
