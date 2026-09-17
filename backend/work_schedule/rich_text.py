"""Small helpers for the bold/italic state stored on work-item titles.

The browser and Google Sheets both address rich-text positions with UTF-16
offsets. Keeping the persisted representation in that coordinate system lets
the two sync directions round-trip formatting without converting character
indexes differently on either side.
"""


FORMAT_KEYS = ("bold", "italic")


def utf16_length(value):
    return len(str(value or "").encode("utf-16-le")) // 2


def _bool_value(value):
    if isinstance(value, bool):
        return value
    if value in (0, 1):
        return bool(value)
    return None


def normalize_format_runs(value, text_length=None):
    """Return a bounded, JSON-safe list of title format transitions.

    ``None`` is preserved as ``None`` so callers can distinguish legacy rows
    whose formatting was never captured from an explicit unformatted title
    represented by ``[]``.
    """
    if value is None:
        return None
    if not isinstance(value, list):
        return []
    maximum = None if text_length is None else max(0, int(text_length))
    by_start = {}
    for raw_run in value:
        if not isinstance(raw_run, dict):
            continue
        try:
            start_index = int(raw_run.get("startIndex", 0))
        except (TypeError, ValueError):
            continue
        if start_index < 0 or (maximum is not None and start_index > maximum):
            continue
        fmt = {}
        for key in FORMAT_KEYS:
            if key not in raw_run:
                continue
            parsed = _bool_value(raw_run.get(key))
            if parsed is not None:
                fmt[key] = parsed
        if not fmt:
            continue
        by_start.setdefault(start_index, {}).update(fmt)
    return [
        {"startIndex": start_index, **by_start[start_index]}
        for start_index in sorted(by_start)
    ]


def format_state_at(runs, index=0, initial=None):
    state = {key: bool((initial or {}).get(key, False)) for key in FORMAT_KEYS}
    for run in normalize_format_runs(runs) or []:
        if run["startIndex"] > index:
            break
        for key in FORMAT_KEYS:
            if key in run:
                state[key] = bool(run[key])
    return state


def slice_format_runs(runs, start_index, end_index, initial=None):
    """Slice global runs into a title-relative run list."""
    start_index = max(0, int(start_index))
    end_index = max(start_index, int(end_index))
    if start_index >= end_index:
        return []
    source = normalize_format_runs(runs) or []
    state = format_state_at(source, start_index, initial)
    sliced = []
    if state["bold"] or state["italic"]:
        sliced.append({"startIndex": 0, **state})
    for run in source:
        if run["startIndex"] <= start_index:
            continue
        if run["startIndex"] >= end_index:
            break
        state = {**state, **{key: bool(run[key]) for key in FORMAT_KEYS if key in run}}
        next_run = {"startIndex": run["startIndex"] - start_index, **state}
        if sliced and sliced[-1]["startIndex"] == next_run["startIndex"]:
            sliced[-1] = next_run
        else:
            sliced.append(next_run)
    return normalize_format_runs(sliced, end_index - start_index) or []
