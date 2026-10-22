"""Plain-text generation with whichever AI key is saved (Claude preferred, else Gemini)."""
import anthropic

from . import gemini


def generate_text(cfg: dict, system: str, prompt: str) -> str:
    env = cfg["env"]
    if env["ANTHROPIC_API_KEY"]:
        resp = anthropic.Anthropic(api_key=env["ANTHROPIC_API_KEY"]).beta.messages.create(
            model="claude-opus-5-5",
            max_tokens=4000,
            system=system,
            output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": prompt}],
        )
        if resp.stop_reason == "refusal":
            raise RuntimeError("The AI declined to write this; try different wording")
        return "".join(b.text for b in resp.content if b.type == "text").strip()
    if env["GEMINI_API_KEY"]:
        return gemini.generate(env["GEMINI_API_KEY"], system, prompt, max_tokens=4096).strip()
    raise ValueError("Add a Gemini (free) or Claude key in Settings to write posts with AI")
