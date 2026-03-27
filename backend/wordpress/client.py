import base64
import httpx
from backend.database import get_wp_site_by_name


def _auth_header(user: str, app_password: str) -> str:
    token = base64.b64encode(f"{user}:{app_password}".encode()).decode()
    return f"Basic {token}"


async def _get_site_config(site_name: str) -> dict:
    site = await get_wp_site_by_name(site_name)
    if not site:
        raise ValueError(f"Serwis WP '{site_name}' nie jest skonfigurowany. Przejdz do Ustawien.")
    return site


async def get_categories(site_name: str) -> list[dict]:
    cfg = await _get_site_config(site_name)
    url = f"{cfg['url'].rstrip('/')}/wp-json/wp/v2/categories"
    headers = {"Authorization": _auth_header(cfg["user"], cfg["app_password"])}
    all_categories = []
    page = 1
    async with httpx.AsyncClient(timeout=30) as client:
        while page <= 50:  # safety limit
            resp = await client.get(url, headers=headers, params={"per_page": 100, "page": page})
            resp.raise_for_status()
            data = resp.json()
            if not data:
                break
            all_categories.extend([{"id": c["id"], "name": c["name"], "slug": c["slug"]} for c in data])
            total_pages = int(resp.headers.get("X-WP-TotalPages", 1))
            if page >= total_pages:
                break
            page += 1
    return all_categories


async def get_tags(site_name: str) -> list[dict]:
    cfg = await _get_site_config(site_name)
    url = f"{cfg['url'].rstrip('/')}/wp-json/wp/v2/tags"
    headers = {"Authorization": _auth_header(cfg["user"], cfg["app_password"])}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers=headers, params={"per_page": 100})
        resp.raise_for_status()
    return [{"id": t["id"], "name": t["name"], "slug": t["slug"]} for t in resp.json()]


async def create_or_get_tag(site_name: str, tag_name: str) -> int:
    cfg = await _get_site_config(site_name)
    headers = {
        "Authorization": _auth_header(cfg["user"], cfg["app_password"]),
        "Content-Type": "application/json",
    }
    base = cfg["url"].rstrip("/")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(f"{base}/wp-json/wp/v2/tags", headers=headers, params={"search": tag_name})
        resp.raise_for_status()
        for tag in resp.json():
            if tag["name"].lower() == tag_name.lower():
                return tag["id"]
        resp = await client.post(f"{base}/wp-json/wp/v2/tags", headers=headers, json={"name": tag_name})
        resp.raise_for_status()
        return resp.json()["id"]


async def upload_media(site_name: str, image_bytes: bytes, filename: str) -> dict:
    cfg = await _get_site_config(site_name)
    url = f"{cfg['url'].rstrip('/')}/wp-json/wp/v2/media"
    headers = {
        "Authorization": _auth_header(cfg["user"], cfg["app_password"]),
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Type": "image/png",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers=headers, content=image_bytes)
        resp.raise_for_status()
    data = resp.json()
    return {"id": data["id"], "url": data.get("source_url", "")}


async def get_posts(site_name: str, per_page: int = 50) -> list[dict]:
    cfg = await _get_site_config(site_name)
    url = f"{cfg['url'].rstrip('/')}/wp-json/wp/v2/posts"
    headers = {"Authorization": _auth_header(cfg["user"], cfg["app_password"])}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(url, headers=headers, params={"per_page": per_page, "status": "publish"})
        resp.raise_for_status()
    return [{"id": p["id"], "title": p["title"]["rendered"], "link": p["link"]} for p in resp.json()]


async def detect_seo_plugin(site_name: str) -> str | None:
    """Detect which SEO plugin is active by checking REST API namespaces."""
    import logging
    logger = logging.getLogger("rankpost")
    cfg = await _get_site_config(site_name)
    base = cfg["url"].rstrip("/")
    headers = {"Authorization": _auth_header(cfg["user"], cfg["app_password"])}
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            resp = await client.get(f"{base}/wp-json/", headers=headers)
            if resp.status_code != 200:
                return None
            namespaces = resp.json().get("namespaces", [])
            for ns in namespaces:
                if ns.startswith("yoast"):
                    logger.info(f"  SEO plugin detected: yoast (namespace: {ns})")
                    return "yoast"
                if ns.startswith("rankmath"):
                    logger.info(f"  SEO plugin detected: rankmath (namespace: {ns})")
                    return "rankmath"
                if ns.startswith("aioseo"):
                    logger.info(f"  SEO plugin detected: aioseo (namespace: {ns})")
                    return "aioseo"
        except Exception as e:
            logger.warning(f"  SEO plugin detection failed: {e}")
    return None


async def set_seo_meta(site_name: str, post_id: int, seo_plugin: str | None, meta_title: str, meta_description: str):
    """Set SEO meta title/description via the appropriate plugin API or fallback."""
    import logging
    logger = logging.getLogger("rankpost")

    if not meta_title and not meta_description:
        return

    cfg = await _get_site_config(site_name)
    base = cfg["url"].rstrip("/")
    headers = {
        "Authorization": _auth_header(cfg["user"], cfg["app_password"]),
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) RankPost/1.0",
    }

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        # Method 1: Try plugin-specific API
        if seo_plugin == "rankmath":
            meta = {}
            if meta_title:
                meta["rank_math_title"] = meta_title
            if meta_description:
                meta["rank_math_description"] = meta_description
            try:
                resp = await client.post(
                    f"{base}/wp-json/rankmath/v1/updateMeta",
                    headers=headers,
                    json={"objectID": post_id, "objectType": "post", "meta": meta},
                )
                if resp.status_code == 200:
                    logger.info(f"  RankMath SEO meta set via API for post {post_id}")
                    return
                logger.warning(f"  RankMath API returned {resp.status_code}, trying fallback")
            except Exception as e:
                logger.warning(f"  RankMath API failed: {e}, trying fallback")

        # Method 2: Try via standard WP meta (works if plugin registers fields in REST API)
        meta_fields = {}
        if seo_plugin == "yoast":
            if meta_title:
                meta_fields["yoast_wpseo_title"] = meta_title
            if meta_description:
                meta_fields["yoast_wpseo_metadesc"] = meta_description
        elif seo_plugin == "rankmath":
            if meta_title:
                meta_fields["rank_math_title"] = meta_title
            if meta_description:
                meta_fields["rank_math_description"] = meta_description
        elif seo_plugin == "aioseo":
            if meta_title:
                meta_fields["_aioseo_title"] = meta_title
            if meta_description:
                meta_fields["_aioseo_description"] = meta_description

        if meta_fields:
            try:
                resp = await client.post(
                    f"{base}/wp-json/wp/v2/posts/{post_id}",
                    headers=headers,
                    json={"meta": meta_fields},
                )
                logger.info(f"  SEO meta set via WP meta for post {post_id} ({seo_plugin}): {resp.status_code}")
            except Exception as e:
                logger.warning(f"  WP meta update failed: {e}")

        # Method 3: Always set excerpt as SEO description fallback
        # (RankMath/Yoast use excerpt as fallback description if no meta set)
        if meta_description:
            try:
                resp = await client.post(
                    f"{base}/wp-json/wp/v2/posts/{post_id}",
                    headers=headers,
                    json={"excerpt": meta_description},
                )
                logger.info(f"  Excerpt set as SEO description fallback for post {post_id}: {resp.status_code}")
            except Exception as e:
                logger.warning(f"  Excerpt update failed: {e}")


async def create_post(site_name: str, post_data: dict) -> dict:
    cfg = await _get_site_config(site_name)
    url = f"{cfg['url'].rstrip('/')}/wp-json/wp/v2/posts"
    headers = {
        "Authorization": _auth_header(cfg["user"], cfg["app_password"]),
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers=headers, json=post_data)
        resp.raise_for_status()
    data = resp.json()
    return {"id": data["id"], "link": data.get("link", ""), "status": data.get("status", "")}
