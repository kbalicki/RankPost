import re
import json
import logging
import httpx
from backend.scraper.scraper import scrape_multiple

logger = logging.getLogger("rankpost")


def html_to_gutenberg(html: str) -> str:
    """Convert raw HTML to WordPress Gutenberg block markup."""
    result = []
    # Split into top-level elements. We parse tag by tag.
    # Match top-level HTML tags
    pattern = re.compile(
        r'(<h[23][^>]*>.*?</h[23]>)|'
        r'(<p[^>]*>.*?</p>)|'
        r'(<ul[^>]*>.*?</ul>)|'
        r'(<ol[^>]*>.*?</ol>)|'
        r'(<blockquote[^>]*>.*?</blockquote>)|'
        r'(<table[^>]*>.*?</table>)|'
        r'(<figure[^>]*>.*?</figure>)',
        re.DOTALL | re.IGNORECASE
    )

    last_end = 0
    for m in pattern.finditer(html):
        # Any text between matches (shouldn't happen in well-formed HTML but handle it)
        gap = html[last_end:m.start()].strip()
        if gap:
            result.append(f'<!-- wp:html -->\n{gap}\n<!-- /wp:html -->')

        tag_html = m.group(0)
        tag_lower = tag_html.lower()

        if tag_lower.startswith('<h2'):
            inner = re.sub(r'</?h2[^>]*>', '', tag_html)
            result.append(f'<!-- wp:heading -->\n<h2 class="wp-block-heading">{inner}</h2>\n<!-- /wp:heading -->')
        elif tag_lower.startswith('<h3'):
            inner = re.sub(r'</?h3[^>]*>', '', tag_html)
            result.append(f'<!-- wp:heading {{"level":3}} -->\n<h3 class="wp-block-heading">{inner}</h3>\n<!-- /wp:heading -->')
        elif tag_lower.startswith('<p'):
            result.append(f'<!-- wp:paragraph -->\n{tag_html}\n<!-- /wp:paragraph -->')
        elif tag_lower.startswith('<ul'):
            result.append(f'<!-- wp:list -->\n{tag_html}\n<!-- /wp:list -->')
        elif tag_lower.startswith('<ol'):
            result.append(f'<!-- wp:list {{"ordered":true}} -->\n{tag_html}\n<!-- /wp:list -->')
        elif tag_lower.startswith('<blockquote'):
            inner = tag_html
            if 'wp-block-quote' not in inner:
                inner = inner.replace('<blockquote', '<blockquote class="wp-block-quote"', 1)
            result.append(f'<!-- wp:quote -->\n{inner}\n<!-- /wp:quote -->')
        elif tag_lower.startswith('<table'):
            result.append(f'<!-- wp:table -->\n<figure class="wp-block-table">{tag_html}</figure>\n<!-- /wp:table -->')
        elif tag_lower.startswith('<figure'):
            result.append(f'<!-- wp:image -->\n{tag_html}\n<!-- /wp:image -->')
        else:
            result.append(f'<!-- wp:html -->\n{tag_html}\n<!-- /wp:html -->')

        last_end = m.end()

    # Remaining content after last match
    remainder = html[last_end:].strip()
    if remainder:
        result.append(f'<!-- wp:html -->\n{remainder}\n<!-- /wp:html -->')

    return '\n\n'.join(result)
from backend.content.generator import (
    generate_outline,
    generate_article_content,
    generate_seo_meta,
    generate_tags,
    suggest_categories,
    generate_featured_image_url,
)
from backend.wordpress.client import (
    get_categories,
    create_or_get_tag,
    upload_media,
    create_post,
    detect_seo_plugin,
    set_seo_meta,
)
from backend.database import get_db


async def step_scrape(source_urls: list[str]) -> list[dict]:
    if not source_urls:
        return []
    return await scrape_multiple(source_urls)


async def step_outline(settings: dict, source_texts: list[str]) -> dict:
    return await generate_outline(
        topic=settings["topic"],
        source_texts=source_texts,
        style_description=settings["style_description"],
        paragraphs_min=settings["paragraphs_min"],
        paragraphs_max=settings["paragraphs_max"],
        include_intro=settings["include_intro"],
        include_summary=settings["include_summary"],
        additional_notes=settings.get("additional_notes", ""),
        language=settings.get("language", "pl"),
        model=settings.get("model", "claude"),
    )


async def step_generate_content(settings: dict, outline: dict, source_texts: list[str]) -> str:
    return await generate_article_content(
        outline=outline,
        source_texts=source_texts,
        style_description=settings["style_description"],
        additional_notes=settings.get("additional_notes", ""),
        language=settings.get("language", "pl"),
        model=settings.get("model", "claude"),
        target_length=settings.get("target_length", 1200),
    )


async def step_seo_meta(title: str, content: str, language: str, model: str) -> dict:
    return await generate_seo_meta(title, content, language, model)


async def step_tags(title: str, content: str, settings: dict) -> list[str]:
    if not settings.get("generate_tags", True):
        return []
    return await generate_tags(
        title, content,
        tags_min=settings.get("tags_min", 3),
        tags_max=settings.get("tags_max", 8),
        language=settings.get("language", "pl"),
        model=settings.get("model", "claude"),
    )


async def step_suggest_categories(title: str, content: str, wp_site: str, model: str, cats_min: int = 1, cats_max: int = 3) -> tuple[list[int], list[dict]]:
    categories = await get_categories(wp_site)
    suggested_ids = await suggest_categories(title, content, categories, model, cats_min=cats_min, cats_max=cats_max)
    return suggested_ids, categories


async def step_publish(
    wp_site: str,
    title: str,
    content: str,
    category_ids: list[int],
    tag_names: list[str],
    meta_title: str,
    meta_description: str,
    slug: str,
    featured_image_url: str | None,
    publish_status: str = "draft",
    scheduled_date: str = "",
) -> dict:
    tag_ids = []
    for tag_name in tag_names:
        tag_id = await create_or_get_tag(wp_site, tag_name)
        tag_ids.append(tag_id)

    featured_media_id = None
    if featured_image_url:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.get(featured_image_url)
            resp.raise_for_status()
            image_bytes = resp.content

        media = await upload_media(wp_site, image_bytes, f"{slug or 'featured'}.png")
        featured_media_id = media["id"]

    # Convert HTML to Gutenberg blocks
    gutenberg_content = html_to_gutenberg(content)

    # Detect SEO plugin
    seo_plugin = await detect_seo_plugin(wp_site)

    post_data = {
        "title": title,
        "content": gutenberg_content,
        "status": publish_status,
        "categories": category_ids,
        "tags": tag_ids,
        "slug": slug,
    }
    # Set date for both future (scheduling) and draft (planned date)
    if scheduled_date:
        post_data["date"] = scheduled_date
    if featured_media_id:
        post_data["featured_media"] = featured_media_id

    logger.info(f"  Publishing to WP: site={wp_site} status={publish_status} seo_plugin={seo_plugin} date={scheduled_date or 'now'}")
    logger.debug(f"  Post data keys: {list(post_data.keys())}")
    result = await create_post(wp_site, post_data)
    logger.info(f"  Published: id={result.get('id')} status={result.get('status')} link={result.get('link')}")

    # Set SEO meta after post creation (separate API calls for reliability)
    if meta_title or meta_description:
        post_id = result.get("id")
        if post_id:
            await set_seo_meta(wp_site, post_id, seo_plugin, meta_title, meta_description)

    return result


async def save_article(article_data: dict) -> int:
    db = await get_db()
    try:
        cursor = await db.execute(
            """INSERT INTO articles (title, content, outline, meta_title, meta_description, slug, tags, categories, wp_site, settings, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                article_data.get("title", ""),
                article_data.get("content", ""),
                json.dumps(article_data.get("outline", {})),
                article_data.get("meta_title", ""),
                article_data.get("meta_description", ""),
                article_data.get("slug", ""),
                json.dumps(article_data.get("tags", [])),
                json.dumps(article_data.get("categories", [])),
                article_data.get("wp_site", ""),
                json.dumps(article_data.get("settings", {})),
                "draft",
            ),
        )
        await db.commit()
        return cursor.lastrowid
    finally:
        await db.close()


async def update_article(article_id: int, updates: dict):
    db = await get_db()
    try:
        sets = []
        values = []
        for key in ["title", "content", "outline", "meta_title", "meta_description", "slug", "tags", "categories", "status", "wp_post_id"]:
            if key in updates:
                sets.append(f"{key} = ?")
                val = updates[key]
                if isinstance(val, (dict, list)):
                    val = json.dumps(val)
                values.append(val)
        if sets:
            sets.append("updated_at = CURRENT_TIMESTAMP")
            values.append(article_id)
            await db.execute(f"UPDATE articles SET {', '.join(sets)} WHERE id = ?", values)
            await db.commit()
    finally:
        await db.close()
