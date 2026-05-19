from __future__ import annotations


class KnoloError(Exception):
    """Base error for knolo runtime failures."""


class InvalidPackError(KnoloError):
    """Raised when a .knolo pack cannot be parsed or validated."""

