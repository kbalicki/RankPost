import httpx
from bs4 import BeautifulSoup
from readability import Document


async def scrape_url(url: str) -> dict:
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    async with httpx.AsyncClient(follow_redirects=True, timeout=30) as client:
        response = await client.get(url, headers=headers)
        response.raise_for_status()

    doc = Document(response.text)
    title = doc.title()
    html_content = doc.summary()

    soup = BeautifulSoup(html_content, "html.parser")

    for tag in soup(["script", "style", "nav", "footer", "aside"]):
        tag.decompose()

    text = soup.get_text(separator="\n", strip=True)
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    clean_text = "\n".join(lines)

    return {
        "url": url,
        "title": title,
        "text": clean_text[:15000],
    }


async def scrape_multiple(urls: list[str]) -> list[dict]:
    results = []
    for url in urls:
        try:
            result = await scrape_url(url)
            results.append(result)
        except Exception as e:
            results.append({"url": url, "title": "", "text": "", "error": str(e)})
    return results
