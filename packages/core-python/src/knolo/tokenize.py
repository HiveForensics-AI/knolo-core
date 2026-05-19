from __future__ import annotations


def normalize(text: str) -> str:
    """Lowercase and trim text without the richer TypeScript normalization."""
    return text.lower().strip()


def tokenize(text: str) -> list[str]:
    """Split text on non-alphanumeric characters and lowercase each token."""
    tokens: list[str] = []
    current: list[str] = []
    for ch in text:
        if ch.isalnum():
            current.append(ch.lower())
        elif current:
            tokens.append("".join(current))
            current.clear()
    if current:
        tokens.append("".join(current))
    return tokens
