import json
from backend.ai.client import generate_text, generate_image


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
    result = result.strip()
    if result.startswith("```"):
        result = result.split("\n", 1)[1]
        if result.endswith("```"):
            result = result[:-3]
    return json.loads(result)


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
    result = result.strip()
    if result.startswith("```"):
        result = result.split("\n", 1)[1]
        if result.endswith("```"):
            result = result[:-3]
    return json.loads(result)


async def generate_tags(title: str, content_preview: str, tags_min: int, tags_max: int, language: str, model: str) -> list[str]:
    lang_label = "polskim" if language == "pl" else "angielskim"
    prompt = f"""Wygeneruj tagi (slowa kluczowe) dla artykulu w jezyku {lang_label}.

Tytul: {title}
Fragment: {content_preview[:2000]}

Wygeneruj od {tags_min} do {tags_max} tagow.
Odpowiedz TYLKO jako JSON array stringow, np: ["tag1", "tag2", "tag3"]"""

    result = await generate_text(prompt, model=model, max_tokens=512)
    result = result.strip()
    if result.startswith("```"):
        result = result.split("\n", 1)[1]
        if result.endswith("```"):
            result = result[:-3]
    return json.loads(result)


async def suggest_categories(title: str, content_preview: str, available_categories: list[dict], model: str) -> list[int]:
    cats_list = ", ".join(f"{c['id']}:{c['name']}" for c in available_categories)
    prompt = f"""Wybierz najlepsze kategorie dla tego artykulu.

Tytul: {title}
Fragment: {content_preview[:1000]}

Dostepne kategorie (id:nazwa): {cats_list}

Wybierz 1-3 najbardziej pasujace kategorie.
Odpowiedz TYLKO jako JSON array z ID kategorii, np: [1, 5]"""

    result = await generate_text(prompt, model=model, max_tokens=256)
    result = result.strip()
    if result.startswith("```"):
        result = result.split("\n", 1)[1]
        if result.endswith("```"):
            result = result[:-3]
    return json.loads(result)


async def generate_featured_image_url(title: str, model: str = "dall-e-3") -> str:
    prompt = f"Professional, modern blog header image for article titled: '{title}'. Clean design, no text on image, suitable for a professional blog."
    return await generate_image(prompt)
