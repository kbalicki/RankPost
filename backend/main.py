import json
import httpx
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.scraper.file_parser import parse_file

from backend.database import init_db, get_db, get_setting, set_setting, get_all_wp_sites
from backend.engine.pipeline import (
    step_scrape,
    step_outline,
    step_generate_content,
    step_seo_meta,
    step_tags,
    step_suggest_categories,
    step_publish,
    save_article,
    update_article,
)
from backend.content.generator import generate_featured_image_url


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(title="RankPost", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# --- Models ---

class ScrapeRequest(BaseModel):
    urls: list[str]

class OutlineRequest(BaseModel):
    topic: str
    source_urls: list[str] = []
    file_texts: list[str] = []
    style_description: str = "Informacyjny"
    paragraphs_min: int = 4
    paragraphs_max: int = 8
    include_intro: bool = True
    include_summary: bool = True
    additional_notes: str = ""
    language: str = "pl"
    model: str = "claude"

class GenerateContentRequest(BaseModel):
    outline: dict
    source_urls: list[str] = []
    file_texts: list[str] = []
    style_description: str = "Informacyjny"
    additional_notes: str = ""
    language: str = "pl"
    model: str = "claude"
    target_length: int = 1200

class SeoMetaRequest(BaseModel):
    title: str
    content: str
    language: str = "pl"
    model: str = "claude"

class TagsRequest(BaseModel):
    title: str
    content: str
    tags_min: int = 3
    tags_max: int = 8
    language: str = "pl"
    model: str = "claude"

class CategoriesRequest(BaseModel):
    title: str
    content: str
    wp_site: str
    model: str = "claude"

class PublishRequest(BaseModel):
    wp_site: str
    title: str
    content: str
    category_ids: list[int] = []
    tag_names: list[str] = []
    meta_title: str = ""
    meta_description: str = ""
    slug: str = ""
    featured_image_url: str | None = None
    publish_status: str = "draft"
    scheduled_date: str = ""

class FeaturedImageRequest(BaseModel):
    title: str

class StyleTemplate(BaseModel):
    name: str
    description: str

class SaveArticleRequest(BaseModel):
    title: str = ""
    content: str = ""
    outline: dict = {}
    meta_title: str = ""
    meta_description: str = ""
    slug: str = ""
    tags: list[str] = []
    categories: list[int] = []
    wp_site: str = ""
    settings: dict = {}

class SettingsUpdate(BaseModel):
    openai_api_key: str = ""
    anthropic_api_key: str = ""

class WpSiteCreate(BaseModel):
    name: str
    url: str
    user: str
    app_password: str

class KeywordRequest(BaseModel):
    keyword: str
    language: str = "pl"

class ContentScoreRequest(BaseModel):
    title: str
    content: str
    keywords: list[str] = []
    language: str = "pl"
    model: str = "claude"

class RewriteRequest(BaseModel):
    source_url: str = ""
    source_text: str = ""
    style_description: str = "Informacyjny"
    additional_notes: str = ""
    language: str = "pl"
    model: str = "claude"
    target_length: int = 1200

class StructureTemplate(BaseModel):
    name: str
    description: str
    structure: dict

class ImageGalleryRequest(BaseModel):
    title: str
    count: int = 4


# --- Settings API ---

@app.get("/api/settings")
async def get_settings():
    openai_key = await get_setting("openai_api_key")
    anthropic_key = await get_setting("anthropic_api_key")
    return {
        "openai_api_key": openai_key,
        "anthropic_api_key": anthropic_key,
        "openai_api_key_set": bool(openai_key),
        "anthropic_api_key_set": bool(anthropic_key),
    }


@app.post("/api/settings")
async def update_settings(req: SettingsUpdate):
    if req.openai_api_key:
        await set_setting("openai_api_key", req.openai_api_key)
    if req.anthropic_api_key:
        await set_setting("anthropic_api_key", req.anthropic_api_key)
    return {"ok": True}


# --- WP Sites CRUD ---

@app.get("/api/wp-sites")
async def list_wp_sites():
    sites = await get_all_wp_sites()
    return {"sites": [{"id": s["id"], "name": s["name"], "url": s["url"]} for s in sites]}


@app.post("/api/wp-sites")
async def create_wp_site(req: WpSiteCreate):
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO wp_sites (name, url, user, app_password) VALUES (?, ?, ?, ?)",
            (req.name, req.url.rstrip("/"), req.user, req.app_password),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "name": req.name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await db.close()


@app.put("/api/wp-sites/{site_id}")
async def update_wp_site(site_id: int, req: WpSiteCreate):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE wp_sites SET name = ?, url = ?, user = ?, app_password = ? WHERE id = ?",
            (req.name, req.url.rstrip("/"), req.user, req.app_password, site_id),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


@app.delete("/api/wp-sites/{site_id}")
async def delete_wp_site(site_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM wp_sites WHERE id = ?", (site_id,))
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


@app.get("/api/wp-sites/{site_name}/categories")
async def wp_categories(site_name: str):
    try:
        from backend.wordpress.client import get_categories
        cats = await get_categories(site_name)
        return {"categories": cats}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/wp-sites/{site_name}/test")
async def test_wp_connection(site_name: str):
    try:
        from backend.wordpress.client import get_categories
        cats = await get_categories(site_name)
        return {"ok": True, "categories_count": len(cats), "message": f"Polaczono! Znaleziono {len(cats)} kategorii."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# --- File Upload ---

@app.post("/api/upload-files")
async def upload_files(files: list[UploadFile] = File(...)):
    results = []
    for f in files:
        try:
            content = await f.read()
            text = parse_file(f.filename, content)
            results.append({"filename": f.filename, "text": text, "chars": len(text)})
        except Exception as e:
            results.append({"filename": f.filename, "text": "", "error": str(e)})
    return {"files": results}


# --- Content API ---

@app.post("/api/scrape")
async def scrape(req: ScrapeRequest):
    results = await step_scrape(req.urls)
    return {"sources": results}


@app.post("/api/outline")
async def outline(req: OutlineRequest):
    sources = await step_scrape(req.source_urls)
    source_texts = [s["text"] for s in sources if s.get("text")]
    source_texts.extend(req.file_texts)
    settings = req.model_dump()
    result = await step_outline(settings, source_texts)
    return {"outline": result, "sources_count": len(source_texts)}


@app.post("/api/generate-content")
async def generate_content(req: GenerateContentRequest):
    sources = await step_scrape(req.source_urls) if req.source_urls else []
    source_texts = [s["text"] for s in sources if s.get("text")]
    source_texts.extend(req.file_texts)
    settings = req.model_dump()
    content = await step_generate_content(settings, req.outline, source_texts)
    return {"content": content}


@app.post("/api/seo-meta")
async def seo_meta(req: SeoMetaRequest):
    result = await step_seo_meta(req.title, req.content, req.language, req.model)
    return result


@app.post("/api/tags")
async def tags(req: TagsRequest):
    result = await step_tags(req.title, req.content, req.model_dump())
    return {"tags": result}


@app.post("/api/suggest-categories")
async def suggest_cats(req: CategoriesRequest):
    suggested_ids, all_cats = await step_suggest_categories(req.title, req.content, req.wp_site, req.model)
    return {"suggested_ids": suggested_ids, "all_categories": all_cats}


@app.post("/api/featured-image")
async def featured_image(req: FeaturedImageRequest):
    url = await generate_featured_image_url(req.title)
    return {"image_url": url}


@app.post("/api/image-gallery")
async def image_gallery(req: ImageGalleryRequest):
    from backend.ai.client import generate_image
    urls = []
    prompts = [
        f"Professional blog header for '{req.title}'. Clean modern design, no text.",
        f"Minimalist illustration for article '{req.title}'. Flat design, subtle colors.",
        f"Abstract conceptual image for '{req.title}'. Professional, corporate style.",
        f"Creative editorial photo concept for '{req.title}'. Warm lighting, magazine quality.",
    ]
    for i in range(min(req.count, 4)):
        try:
            url = await generate_image(prompts[i])
            urls.append(url)
        except Exception as e:
            urls.append(None)
    return {"images": [u for u in urls if u]}


@app.post("/api/keyword-research")
async def keyword_research(req: KeywordRequest):
    import httpx as hx
    lang_map = {"pl": "pl", "en": "en"}
    hl = lang_map.get(req.language, "pl")

    # Google Autocomplete suggestions
    suggestions = []
    try:
        async with hx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://suggestqueries.google.com/complete/search",
                params={"client": "firefox", "q": req.keyword, "hl": hl},
            )
            data = resp.json()
            suggestions = data[1] if len(data) > 1 else []
    except Exception:
        pass

    # Related keywords via Google Suggest with prefixes
    related = []
    prefixes = ["jak ", "co ", "dlaczego ", "najlepszy ", ""] if hl == "pl" else ["how ", "what ", "why ", "best ", ""]
    try:
        async with hx.AsyncClient(timeout=15) as client:
            for prefix in prefixes[:3]:
                resp = await client.get(
                    "https://suggestqueries.google.com/complete/search",
                    params={"client": "firefox", "q": f"{prefix}{req.keyword}", "hl": hl},
                )
                data = resp.json()
                if len(data) > 1:
                    for s in data[1]:
                        if s not in suggestions and s not in related:
                            related.append(s)
    except Exception:
        pass

    # Google Trends (if pytrends available)
    trends_data = []
    try:
        from pytrends.request import TrendReq
        import asyncio
        def _get_trends():
            pytrends = TrendReq(hl=hl, tz=60)
            pytrends.build_payload([req.keyword], timeframe="today 3-m", geo=hl.upper())
            related_queries = pytrends.related_queries()
            result = []
            if req.keyword in related_queries:
                top = related_queries[req.keyword].get("top")
                if top is not None:
                    for _, row in top.head(10).iterrows():
                        result.append({"query": row["query"], "value": int(row["value"])})
            return result
        trends_data = await asyncio.to_thread(_get_trends)
    except Exception:
        pass

    return {
        "suggestions": suggestions[:15],
        "related": related[:15],
        "trends": trends_data[:10],
    }


@app.post("/api/content-score")
async def content_score(req: ContentScoreRequest):
    import re
    from backend.ai.client import generate_text

    content_text = re.sub(r'<[^>]+>', ' ', req.content)
    word_count = len(content_text.split())
    h2_count = len(re.findall(r'<h2', req.content, re.I))
    h3_count = len(re.findall(r'<h3', req.content, re.I))
    link_count = len(re.findall(r'<a\s', req.content, re.I))
    img_count = len(re.findall(r'<img', req.content, re.I))
    paragraph_count = len(re.findall(r'<p', req.content, re.I))

    # Basic metrics
    metrics = {
        "word_count": word_count,
        "h2_count": h2_count,
        "h3_count": h3_count,
        "link_count": link_count,
        "img_count": img_count,
        "paragraph_count": paragraph_count,
    }

    # Keyword density
    keyword_density = {}
    for kw in req.keywords:
        count = content_text.lower().count(kw.lower())
        density = round((count / max(word_count, 1)) * 100, 2)
        keyword_density[kw] = {"count": count, "density_pct": density}
    metrics["keyword_density"] = keyword_density

    # AI analysis
    prompt = f"""Ocen artykul pod katem SEO i jakosci. Daj ocene 0-100 i krotkie wskazowki.

Tytul: {req.title}
Liczba slow: {word_count}
Naglowki H2: {h2_count}, H3: {h3_count}
Linki: {link_count}, Obrazki: {img_count}
{f"Slowa kluczowe: {', '.join(req.keywords)}" if req.keywords else ""}

Fragment artykulu: {content_text[:3000]}

Odpowiedz TYLKO w formacie JSON:
{{
  "score": 75,
  "readability": "dobra/srednia/slaba",
  "seo_score": 70,
  "tips": ["wskazowka 1", "wskazowka 2", "wskazowka 3"]
}}"""

    try:
        result = await generate_text(prompt, model=req.model, max_tokens=512)
        result = result.strip()
        if result.startswith("```"):
            result = result.split("\n", 1)[1]
            if result.endswith("```"):
                result = result[:-3]
        ai_analysis = json.loads(result)
    except Exception:
        ai_analysis = {"score": 0, "readability": "brak danych", "seo_score": 0, "tips": ["Nie udalo sie przeanalizowac"]}

    return {**metrics, **ai_analysis}


@app.post("/api/rewrite")
async def rewrite_article(req: RewriteRequest):
    from backend.ai.client import generate_text

    source_text = req.source_text
    if req.source_url and not source_text:
        sources = await step_scrape([req.source_url])
        if sources and sources[0].get("text"):
            source_text = sources[0]["text"]

    if not source_text:
        raise HTTPException(status_code=400, detail="Brak tekstu zrodlowego. Podaj URL lub wklej tekst.")

    lang_label = "polskim" if req.language == "pl" else "angielskim"
    prompt = f"""Przepisz ponizszy artykul w jezyku {lang_label}, tworzac calkowicie nowa, oryginalna wersje.

Zasady:
- Zachowaj kluczowe informacje i fakty
- Zmien strukture, kolejnosc akapitow, naglowki
- Uzyj innych sformlowan i synoniow
- Styl: {req.style_description}
- Dlugosc: ok. {req.target_length} slow
- Format: HTML (h2, h3, p, ul, ol, strong, em). Bez h1.
{f"Dodatkowe uwagi: {req.additional_notes}" if req.additional_notes else ""}

ORYGINALNY TEKST:
{source_text[:8000]}

Odpowiedz TYLKO nowym HTML artykulu, bez komentarzy."""

    content = await generate_text(prompt, model=req.model, max_tokens=max(4096, req.target_length * 3))

    # Generate title
    title_prompt = f"Wymysl krotki, chwytliwy tytul artykulu w jezyku {lang_label} na podstawie tresci:\n{content[:1000]}\n\nOdpowiedz TYLKO tytulem, bez cudzyslowow."
    title = await generate_text(title_prompt, model=req.model, max_tokens=100)

    return {"title": title.strip().strip('"'), "content": content}


# --- Structure Templates CRUD ---

@app.get("/api/structure-templates")
async def list_structure_templates():
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM structure_templates ORDER BY name")
        rows = await cursor.fetchall()
        return {"templates": [dict(r) for r in rows]}
    except Exception:
        return {"templates": []}
    finally:
        await db.close()


@app.post("/api/structure-templates")
async def create_structure_template(tpl: StructureTemplate):
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO structure_templates (name, description, structure) VALUES (?, ?, ?)",
            (tpl.name, tpl.description, json.dumps(tpl.structure)),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "name": tpl.name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await db.close()


@app.delete("/api/structure-templates/{tpl_id}")
async def delete_structure_template(tpl_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM structure_templates WHERE id = ?", (tpl_id,))
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


# --- WP Analytics ---

@app.get("/api/wp-sites/{site_name}/analytics")
async def wp_analytics(site_name: str):
    from backend.wordpress.client import _get_site_config, _auth_header
    cfg = await _get_site_config(site_name)
    headers = {"Authorization": _auth_header(cfg["user"], cfg["app_password"])}
    base = cfg["url"].rstrip("/")

    async with httpx.AsyncClient(timeout=30) as client:
        # Get recent posts with views-like stats
        resp = await client.get(
            f"{base}/wp-json/wp/v2/posts",
            headers=headers,
            params={"per_page": 20, "orderby": "date", "order": "desc", "_fields": "id,title,date,status,link,comment_count"},
        )
        resp.raise_for_status()
        posts = resp.json()

        # Get counts
        posts_resp = await client.get(f"{base}/wp-json/wp/v2/posts", headers=headers, params={"per_page": 1, "status": "publish"})
        total_published = int(posts_resp.headers.get("X-WP-Total", 0))

        drafts_resp = await client.get(f"{base}/wp-json/wp/v2/posts", headers=headers, params={"per_page": 1, "status": "draft"})
        total_drafts = int(drafts_resp.headers.get("X-WP-Total", 0))

        scheduled_resp = await client.get(f"{base}/wp-json/wp/v2/posts", headers=headers, params={"per_page": 1, "status": "future"})
        total_scheduled = int(scheduled_resp.headers.get("X-WP-Total", 0))

        cats_resp = await client.get(f"{base}/wp-json/wp/v2/categories", headers=headers, params={"per_page": 1})
        total_cats = int(cats_resp.headers.get("X-WP-Total", 0))

    return {
        "total_published": total_published,
        "total_drafts": total_drafts,
        "total_scheduled": total_scheduled,
        "total_categories": total_cats,
        "recent_posts": [
            {
                "id": p["id"],
                "title": p["title"]["rendered"],
                "date": p["date"],
                "status": p["status"],
                "link": p.get("link", ""),
                "comments": p.get("comment_count", 0),
            }
            for p in posts
        ],
    }


@app.post("/api/publish")
async def publish(req: PublishRequest):
    result = await step_publish(
        wp_site=req.wp_site,
        title=req.title,
        content=req.content,
        category_ids=req.category_ids,
        tag_names=req.tag_names,
        meta_title=req.meta_title,
        meta_description=req.meta_description,
        slug=req.slug,
        featured_image_url=req.featured_image_url,
        publish_status=req.publish_status,
        scheduled_date=req.scheduled_date,
    )
    return result


class InternalLinksRequest(BaseModel):
    content: str
    wp_site: str
    model: str = "claude"


class BulkItemRequest(BaseModel):
    topic: str
    style_description: str = "Informacyjny"
    additional_notes: str = ""
    language: str = "pl"
    model: str = "claude"
    target_length: int = 1200
    generate_tags: bool = True
    generate_seo: bool = True
    wp_site: str = ""
    publish_status: str = "draft"


@app.post("/api/internal-links")
async def internal_links(req: InternalLinksRequest):
    from backend.wordpress.client import get_posts
    from backend.ai.client import generate_text

    posts = await get_posts(req.wp_site, per_page=50)
    if not posts:
        return {"updated_content": req.content, "links_added": 0}

    posts_list = "\n".join(f"- \"{p['title']}\" -> {p['link']}" for p in posts)

    prompt = f"""Masz artykul HTML i liste istniejacych postow na blogu.
Dodaj 2-5 linkow wewnetrznych do artykulu, wstawiajac je naturalnie w tresci (jako <a href="URL">anchor text</a>).

Zasady:
- Linkuj tylko do tematycznie powiazanych postow
- Anchor text powinien byc naturalny (nie "kliknij tutaj")
- Nie zmieniaj struktury ani tresci artykulu poza dodaniem linkow
- Jesli zaden post nie pasuje tematycznie, zwroc oryginalny HTML bez zmian

Istniejace posty:
{posts_list}

Artykul HTML:
{req.content}

Odpowiedz TYLKO zmodyfikowanym HTML artykulu, bez komentarzy."""

    updated = await generate_text(prompt, model=req.model, max_tokens=max(4096, len(req.content) * 2))
    # Count added links roughly
    import re
    original_links = len(re.findall(r'<a\s', req.content))
    new_links = len(re.findall(r'<a\s', updated))
    return {"updated_content": updated, "links_added": max(0, new_links - original_links)}


@app.post("/api/generate-single")
async def generate_single(req: BulkItemRequest):
    """Generate a complete article from topic alone (outline + content + SEO + tags), optionally publish."""
    settings = req.model_dump()
    settings["paragraphs_min"] = 4
    settings["paragraphs_max"] = 8
    settings["include_intro"] = True
    settings["include_summary"] = True
    settings["tags_min"] = 3
    settings["tags_max"] = 8

    # 1. Outline
    outline = await step_outline(settings, [])

    # 2. Content
    content = await step_generate_content(settings, outline, [])

    # 3. SEO
    seo = {}
    if req.generate_seo:
        seo = await step_seo_meta(outline.get("title", req.topic), content, req.language, req.model)

    # 4. Tags
    tags = []
    if req.generate_tags:
        tags = await step_tags(outline.get("title", req.topic), content, settings)

    # 5. Publish if wp_site provided
    publish_result = None
    if req.wp_site:
        publish_result = await step_publish(
            wp_site=req.wp_site,
            title=outline.get("title", req.topic),
            content=content,
            category_ids=[],
            tag_names=tags,
            meta_title=seo.get("meta_title", ""),
            meta_description=seo.get("meta_description", ""),
            slug=seo.get("slug", ""),
            featured_image_url=None,
            publish_status=req.publish_status,
        )

    # 6. Save to DB
    article_id = await save_article({
        "title": outline.get("title", req.topic),
        "content": content,
        "outline": outline,
        "meta_title": seo.get("meta_title", ""),
        "meta_description": seo.get("meta_description", ""),
        "slug": seo.get("slug", ""),
        "tags": tags,
        "categories": [],
        "wp_site": req.wp_site,
        "settings": settings,
    })

    return {
        "article_id": article_id,
        "title": outline.get("title", req.topic),
        "published": publish_result is not None,
        "wp_post_id": publish_result.get("id") if publish_result else None,
        "wp_link": publish_result.get("link") if publish_result else None,
    }


@app.post("/api/articles")
async def save_article_endpoint(req: SaveArticleRequest):
    article_id = await save_article(req.model_dump())
    return {"id": article_id}


@app.get("/api/articles")
async def list_articles():
    db = await get_db()
    try:
        cursor = await db.execute("SELECT id, title, status, wp_site, created_at FROM articles ORDER BY created_at DESC LIMIT 50")
        rows = await cursor.fetchall()
        return {"articles": [dict(r) for r in rows]}
    finally:
        await db.close()


@app.get("/api/articles/{article_id}")
async def get_article(article_id: int):
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM articles WHERE id = ?", (article_id,))
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Article not found")
        return dict(row)
    finally:
        await db.close()


@app.delete("/api/articles/{article_id}")
async def delete_article(article_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM articles WHERE id = ?", (article_id,))
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


# --- Style Templates ---

@app.get("/api/styles")
async def list_styles():
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM style_templates ORDER BY name")
        rows = await cursor.fetchall()
        return {"styles": [dict(r) for r in rows]}
    finally:
        await db.close()


@app.post("/api/styles")
async def create_style(style: StyleTemplate):
    db = await get_db()
    try:
        cursor = await db.execute(
            "INSERT INTO style_templates (name, description) VALUES (?, ?)",
            (style.name, style.description),
        )
        await db.commit()
        return {"id": cursor.lastrowid, "name": style.name}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await db.close()


@app.put("/api/styles/{style_id}")
async def update_style(style_id: int, style: StyleTemplate):
    db = await get_db()
    try:
        await db.execute(
            "UPDATE style_templates SET name = ?, description = ? WHERE id = ?",
            (style.name, style.description, style_id),
        )
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


@app.delete("/api/styles/{style_id}")
async def delete_style(style_id: int):
    db = await get_db()
    try:
        await db.execute("DELETE FROM style_templates WHERE id = ?", (style_id,))
        await db.commit()
        return {"ok": True}
    finally:
        await db.close()


# --- Static files (frontend) ---

app.mount("/static", StaticFiles(directory="frontend"), name="static")

@app.get("/")
async def root():
    return FileResponse("frontend/index.html")
