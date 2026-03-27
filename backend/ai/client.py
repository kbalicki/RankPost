import asyncio
import time
import logging
import anthropic
import openai
from backend.database import get_setting

logger = logging.getLogger("rankpost")


async def generate_text(prompt: str, system: str = "", model: str = "claude-cli", max_tokens: int = 4096) -> str:
    _t = time.time()
    prompt_preview = prompt[:80].replace('\n', ' ')
    logger.debug(f"    AI call: model={model} max_tokens={max_tokens} prompt='{prompt_preview}...'")

    if model == "claude-cli":
        result = await _generate_claude_cli(prompt, system, max_tokens)
        logger.debug(f"    AI done: {len(result)} chars in {time.time()-_t:.1f}s")
        return result

    elif model.startswith("claude"):
        api_key = await get_setting("anthropic_api_key")
        if not api_key:
            raise ValueError("Klucz Anthropic API nie jest ustawiony. Przejdz do Ustawien.")
        model_id = "claude-sonnet-4-20250514"
        client = anthropic.Anthropic(api_key=api_key)
        messages = [{"role": "user", "content": prompt}]
        kwargs = {"model": model_id, "max_tokens": max_tokens, "messages": messages}
        if system:
            kwargs["system"] = system
        response = await asyncio.to_thread(client.messages.create, **kwargs)
        result = response.content[0].text
        logger.debug(f"    AI done: {len(result)} chars in {time.time()-_t:.1f}s (claude-api)")
        return result

    elif model.startswith("gpt"):
        api_key = await get_setting("openai_api_key")
        if not api_key:
            raise ValueError("Klucz OpenAI API nie jest ustawiony. Przejdz do Ustawien.")
        model_id = "gpt-4o"
        client = openai.OpenAI(api_key=api_key)
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        response = await asyncio.to_thread(
            client.chat.completions.create, model=model_id, messages=messages, max_tokens=max_tokens
        )
        result = response.choices[0].message.content
        logger.debug(f"    AI done: {len(result)} chars in {time.time()-_t:.1f}s (gpt)")
        return result

    raise ValueError(f"Nieznany model: {model}")


async def _generate_claude_cli(prompt: str, system: str, max_tokens: int) -> str:
    full_prompt = prompt
    if system:
        full_prompt = f"{system}\n\n---\n\n{prompt}"

    process = await asyncio.create_subprocess_exec(
        "claude", "-p", full_prompt, "--output-format", "text",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=300)

    if process.returncode != 0:
        error_msg = stderr.decode().strip() if stderr else "Unknown error"
        raise ValueError(f"Claude CLI error: {error_msg}")

    return stdout.decode().strip()


async def generate_image(prompt: str) -> str:
    api_key = await get_setting("openai_api_key")
    if not api_key:
        raise ValueError("Klucz OpenAI API nie jest ustawiony. Przejdz do Ustawien.")
    client = openai.OpenAI(api_key=api_key)
    response = await asyncio.to_thread(
        client.images.generate,
        model="dall-e-3",
        prompt=prompt,
        size="1792x1024",
        quality="standard",
        n=1,
    )
    return response.data[0].url
