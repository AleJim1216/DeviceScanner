"""Load exactly one view/grouping backend on first analyze call."""

from api.config import ANALYZE_BACKEND


def preload() -> None:
    if ANALYZE_BACKEND == "gemini":
        from api.backends.gemini_vision import preload as impl
        impl()


def name_views_and_groups(images_bgr: list, claimed_views: list[str]) -> list[dict]:
    if ANALYZE_BACKEND == "local":
        from api.backends.local_view import name_views_and_groups as impl
    elif ANALYZE_BACKEND == "gemini":
        from api.backends.gemini_vision import name_views_and_groups as impl
    else:
        raise RuntimeError(f"Unknown ANALYZE_BACKEND: {ANALYZE_BACKEND}")
    return impl(images_bgr, claimed_views)


__all__ = ["name_views_and_groups", "preload"]
