from functools import wraps
from django.db import transaction


def atomic_mutation(view):
    """Rollback rejected responses as well as exceptions; return confirmed data."""
    @wraps(view)
    def wrapped(*args, **kwargs):
        if args and getattr(args[0], "method", "") in {"GET", "HEAD", "OPTIONS"}:
            return view(*args, **kwargs)
        with transaction.atomic():
            response = view(*args, **kwargs)
            if getattr(response, "status_code", 200) >= 400:
                transaction.set_rollback(True)
            return response
    return wrapped
