from __future__ import annotations


class KnoloError(Exception):
    """Base error for knolo runtime failures."""


class InvalidPackError(KnoloError):
    """Raised when a .knolo pack cannot be parsed or validated."""


class InvalidKnowledgeImageError(KnoloError):
    """Raised when a V5 Knowledge Image cannot be parsed or verified."""


class KarRunError(KnoloError):
    """Raised when a KAR session cannot be opened."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
