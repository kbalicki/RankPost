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
