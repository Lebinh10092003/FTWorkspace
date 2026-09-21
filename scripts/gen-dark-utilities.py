"""Generates the dark-theme utility remap for src/index.css.

Tailwind utilities are scanned out of the app source, so only classes the app
actually uses get a dark counterpart. Neutral utilities move onto the dark
surface/ink scale; coloured tints become low-saturation washes of the same hue
over the dark surface, and coloured *text* moves up the scale so it stays
readable. Solid colour buttons (bg-blue-600 and friends) are left untouched.
"""
import re
import pathlib
import collections

NL = chr(10)
BS = chr(92)
SRC = pathlib.Path("src")

HUE500 = {
    "red": "oklch(63.7% .237 25.331)", "orange": "oklch(70.5% .213 47.604)",
    "amber": "oklch(76.9% .188 70.08)", "yellow": "oklch(79.5% .184 86.047)",
    "lime": "oklch(76.8% .233 130.85)", "green": "oklch(72.3% .219 149.579)",
    "emerald": "oklch(69.6% .17 162.48)", "teal": "oklch(70.4% .14 182.503)",
    "cyan": "oklch(71.5% .143 215.221)", "sky": "oklch(68.5% .169 237.323)",
    "blue": "oklch(62.3% .214 259.815)", "indigo": "oklch(58.5% .233 277.117)",
    "violet": "oklch(60.6% .25 292.717)", "purple": "oklch(62.7% .265 303.9)",
    "fuchsia": "oklch(66.7% .295 322.15)", "pink": "oklch(65.6% .241 354.308)",
    "rose": "oklch(64.5% .246 16.439)",
}
HUE400 = {
    "red": "oklch(70.4% .191 22.216)", "orange": "oklch(75% .183 55.934)",
    "amber": "oklch(82.8% .189 84.429)", "yellow": "oklch(85.2% .199 91.936)",
    "lime": "oklch(84.1% .238 128.85)", "green": "oklch(79.2% .209 151.711)",
    "emerald": "oklch(76.5% .177 163.223)", "teal": "oklch(77.7% .152 181.912)",
    "cyan": "oklch(78.9% .154 211.53)", "sky": "oklch(74.6% .16 232.661)",
    "blue": "oklch(70.7% .165 254.624)", "indigo": "oklch(67.3% .182 276.935)",
    "violet": "oklch(70.2% .183 293.541)", "purple": "oklch(71.4% .203 305.504)",
    "fuchsia": "oklch(74% .238 322.16)", "pink": "oklch(71.8% .202 349.761)",
    "rose": "oklch(71.2% .194 13.428)",
}
HUE300 = {
    "red": "oklch(80.8% .114 19.571)", "orange": "oklch(83.7% .128 66.29)",
    "amber": "oklch(87.9% .169 91.605)", "yellow": "oklch(90.5% .182 98.111)",
    "lime": "oklch(89.7% .196 126.665)", "green": "oklch(87.1% .15 154.449)",
    "emerald": "oklch(84.5% .143 164.978)", "teal": "oklch(85.5% .138 181.071)",
    "cyan": "oklch(86.5% .127 207.078)", "sky": "oklch(82.8% .111 230.318)",
    "blue": "oklch(80.9% .105 251.813)", "indigo": "oklch(78.5% .115 274.713)",
    "violet": "oklch(81.1% .111 293.571)", "purple": "oklch(82.7% .119 306.383)",
    "fuchsia": "oklch(83.3% .145 321.434)", "pink": "oklch(82.3% .12 346.018)",
    "rose": "oklch(81% .117 11.638)",
}

NEUTRALS = ("slate", "gray", "zinc", "neutral", "stone")

TOKEN = re.compile(
    r"(?:[A-Za-z][-A-Za-z0-9]*:){0,2}"
    r"(?:bg|text|border|divide|placeholder|fill|stroke|decoration|outline|accent|caret)"
    r"-(?:[a-z]+(?:-[0-9]+)?(?:/[0-9]+)?|" + re.escape("[") + r"#[0-9a-fA-F]{3,8}" + re.escape("]") + r")"
)

VARIANT_SEL = {
    "hover": ":hover", "focus": ":focus", "focus-visible": ":focus-visible",
    "active": ":active", "disabled": ":disabled", "checked": ":checked",
    "focus-within": ":focus-within", "even": ":nth-child(2n)", "odd": ":nth-child(odd)",
    "last": ":last-child", "first": ":first-child",
    "group-hover": ":is(:where(.group):hover *)",
}
PROP = {
    "bg": "background-color", "text": "color", "border": "border-color",
    "placeholder": "color", "fill": "fill", "stroke": "stroke",
    "divide": "border-color", "accent": "accent-color", "caret": "caret-color",
    "decoration": "text-decoration-color", "outline": "outline-color",
}
SURFACE = "var(--ftd-surface)"


def mix(color, pct, base):
    return "color-mix(in oklab, " + color + " " + str(pct) + "%, " + base + ")"


def neutral_value(prop, shade, alpha):
    """Dark replacement for a slate/gray utility, or None to leave it alone."""
    if prop == "bg":
        table = {
            "white": "var(--ftd-surface)", "50": "var(--ftd-surface-2)",
            "100": "var(--ftd-surface-3)", "200": "var(--ftd-surface-4)",
            "300": "#34445f", "400": "#3e506e",
        }
        # 600..950 are already dark (scrims, tooltips, dark chips): leave them.
        if shade not in table:
            return None
        if alpha and int(alpha) < 40:
            return None  # glass panels that sit on colour, not on the canvas
        base = table[shade]
        return mix(base, int(alpha), "transparent") if alpha else base
    if prop in ("text", "placeholder", "fill", "stroke", "decoration"):
        table = {
            "950": "var(--ftd-text)", "900": "var(--ftd-text)", "800": "var(--ftd-text)",
            "700": "var(--ftd-text-2)", "600": "#b4c5da", "500": "var(--ftd-text-3)",
            "400": "var(--ftd-text-4)", "300": "var(--ftd-text-5)", "200": "var(--ftd-text-5)",
        }
        if shade not in table:
            return None  # white / 50 / 100 already read on dark
        base = table[shade]
        return mix(base, int(alpha), "transparent") if alpha else base
    if prop in ("border", "divide", "outline"):
        table = {
            "50": "var(--ftd-border-soft)", "100": "var(--ftd-border-soft)",
            "200": "var(--ftd-border)", "300": "var(--ftd-border-strong)",
            "400": "var(--ftd-border-strong)", "700": "#3a4b69", "800": "#31405b",
            "white": "var(--ftd-border-strong)",
        }
        if shade not in table:
            return None
        if alpha and shade == "white":
            return None  # white hairlines are drawn on colour, not on the canvas
        base = table[shade]
        return mix(base, int(alpha), "transparent") if alpha else base
    return None


def hue_value(prop, hue, shade, alpha):
    if prop == "bg":
        pct = {"50": 10, "100": 17, "200": 26}.get(shade)
        if pct is None:
            return None  # solid colour buttons keep their colour
        base = mix(HUE500[hue], pct, SURFACE)
        return mix(base, int(alpha), "transparent") if alpha else base
    if prop in ("text", "placeholder", "fill", "stroke", "decoration"):
        # Light mode uses 600-800 as "the coloured ink". Jumping straight to the
        # 300s makes headings glow, so the darker inks land on 400 and only the
        # deepest shades go lighter, which keeps the hierarchy without the glare.
        table = {
            "500": HUE400[hue], "600": HUE400[hue], "700": HUE400[hue],
            "800": HUE300[hue], "900": HUE300[hue],
            "950": mix(HUE300[hue], 78, "white"),
        }
        if shade not in table:
            return None  # 50..400 are already light enough
        base = table[shade]
        return mix(base, int(alpha), "transparent") if alpha else base
    if prop in ("border", "divide", "outline"):
        pct = {"50": 16, "100": 22, "200": 30, "300": 42}.get(shade)
        if pct is None:
            return None
        base = mix(HUE500[hue], pct, SURFACE)
        return mix(base, int(alpha), "transparent") if alpha else base
    return None


def parse_hex(value):
    value = value.lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if len(value) == 8:
        value = value[:6]
    if len(value) != 6:
        return None
    return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))


def luminance(rgb):
    def channel(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def to_hsl(rgb):
    r, g, b = rgb
    high, low = max(rgb), min(rgb)
    light = (high + low) / 2
    if high == low:
        return 0.0, 0.0, light
    delta = high - low
    sat = delta / (2 - high - low) if light > 0.5 else delta / (high + low)
    if high == r:
        hue = ((g - b) / delta) % 6
    elif high == g:
        hue = (b - r) / delta + 2
    else:
        hue = (r - g) / delta + 4
    return hue * 60, sat, light


def hsl_css(hue, sat, light):
    return "hsl(" + str(round(hue)) + " " + str(round(sat * 100)) + "% " + str(round(light * 100)) + "%)"


def arbitrary_value(prop, hex_value):
    """Dark counterpart of an arbitrary hex utility, keeping its hue.

    The brand palette is built from deep navies used as heading ink and from
    near-white paper tones. Both invert; saturated mid-tones (buttons, badges)
    are already legible on dark and are left alone.
    """
    rgb = parse_hex(hex_value)
    if rgb is None:
        return None
    lum = luminance(rgb)
    hue, sat, light = to_hsl(rgb)
    if prop in ("text", "placeholder", "fill", "stroke", "decoration"):
        if lum >= 0.3:
            return None                       # already light enough on dark
        return hsl_css(hue, min(sat, 0.55), 0.82 if light < 0.45 else 0.78)
    if prop == "bg":
        if lum > 0.72:
            # A tinted pale colour is a banded header (the schedule grid's green
            # thead); a neutral off-white is page stock. Keep them distinct.
            chroma = max(rgb) - min(rgb)
            return "var(--ftd-surface-3)" if chroma >= 0.05 else "var(--ftd-surface)"
        return None                           # brand fills keep their colour
    if prop in ("border", "divide", "outline"):
        if lum > 0.72:
            return "var(--ftd-border)"
        if lum < 0.18:
            return "var(--ftd-border-strong)"
        return None
    return None


def escape(cls):
    return (cls.replace(":", BS + ":").replace("/", BS + "/")
               .replace("[", BS + "[").replace("]", BS + "]")
               .replace("#", BS + "#"))


# A dark ink colour is flipped to a light one because it normally sits on a page
# surface that went dark. When the very same element also paints itself a light
# fill that we deliberately leave alone -- the orange "Tải mã QR" button, say --
# flipping the ink would put pale text on a pale button. Collect those
# same-element pairs and exclude them. An exclusion is harmless when the two
# classes only ever appear in opposite branches of a ternary, because then they
# never land on one element together.
CLASS_CHUNK = re.compile(r'"([^"\n]{0,800})"|`([^`]{0,1200})`|\'([^\'\n]{0,800})\'', re.S)
# Only fills this generator leaves alone AND that stay pale count here. Hue
# 50-200 and pale hexes are rewritten into dark washes, so ink over them must
# still flip.
LIGHT_FILL = re.compile(
    r"(?<![-\w])bg-(?:\[(#[0-9a-fA-F]{3,8})\]|(?:" + "|".join(HUE500) + r")-(?:300|400))")
DARK_INK = re.compile(
    r"(?<![-\w])text-(?:\[#[0-9a-fA-F]{3,8}\]"
    r"|(?:" + "|".join(HUE500) + r")-(?:500|600|700|800|900|950)"
    r"|(?:" + "|".join(NEUTRALS) + r")-(?:600|700|800|900|950))")


def fill_stays_light(match):
    """True when this background keeps a pale colour in dark mode."""
    hex_value = match.group(1)
    if hex_value is None:
        return True                      # hue 300/400 are pale fills we keep
    rgb = parse_hex(hex_value)
    # Above 0.72 the generator turns the fill into a dark surface, so the ink
    # over it has to flip after all; below 0.35 the fill is dark to begin with.
    return rgb is not None and 0.35 <= luminance(rgb) <= 0.72


def ink_exclusions(paths):
    pairs = collections.defaultdict(set)
    for path in paths:
        for chunk in CLASS_CHUNK.finditer(path.read_text(encoding="utf-8")):
            cls = (chunk.group(1) or chunk.group(2) or chunk.group(3) or "")
            if "text-" not in cls or "bg-" not in cls:
                continue
            cls = cls.replace(NL, " ")
            fills = {m.group(0) for m in LIGHT_FILL.finditer(cls) if fill_stays_light(m)}
            if not fills:
                continue
            for ink in {m.group(0) for m in DARK_INK.finditer(cls)}:
                pairs[ink] |= fills
    return pairs


def main():
    paths = list(SRC.rglob("*.tsx")) + list(SRC.rglob("*.ts"))
    used = set()
    for path in paths:
        for match in TOKEN.finditer(path.read_text(encoding="utf-8")):
            used.add(match.group(0))
    exclusions = ink_exclusions(paths)

    def guard(prop, utility, sel):
        if prop not in ("text", "fill", "stroke", "decoration"):
            return sel
        fills = exclusions.get(utility)
        if not fills:
            return sel
        return sel + "".join(":not(." + escape(f) + ")" for f in sorted(fills))

    rules = collections.OrderedDict()
    for token in sorted(used):
        parts = token.split(":")
        utility, variants = parts[-1], parts[:-1]
        if any(v not in VARIANT_SEL for v in variants):
            continue
        arbitrary = re.fullmatch(
            r"(bg|text|border|divide|placeholder|fill|stroke|decoration|outline)"
            r"-\[(#[0-9a-fA-F]{3,8})\]", utility)
        if arbitrary:
            prop, hex_value = arbitrary.groups()
            value = arbitrary_value(prop, hex_value)
            if not value:
                continue
            sel = guard(prop, utility, "." + escape(token) + "".join(VARIANT_SEL[v] for v in variants))
            if prop == "divide":
                sel += " > :not(:last-child)"
            if prop == "placeholder":
                sel += "::placeholder"
            rules.setdefault((prop, sel), value)
            continue
        match = re.fullmatch(
            r"(bg|text|border|divide|placeholder|fill|stroke|decoration|outline|accent|caret)"
            r"-([a-z]+)(?:-([0-9]+))?(?:/([0-9]+))?", utility)
        if not match:
            continue
        prop, name, shade, alpha = match.groups()
        if prop not in PROP:
            continue
        if name == "white" and shade is None:
            value = neutral_value(prop, "white", alpha)
        elif name in NEUTRALS and shade:
            value = neutral_value(prop, shade, alpha)
        elif name in HUE500 and shade:
            value = hue_value(prop, name, shade, alpha)
        else:
            continue
        if not value:
            continue
        sel = guard(prop, utility, "." + escape(token) + "".join(VARIANT_SEL[v] for v in variants))
        if prop == "divide":
            sel += " > :not(:last-child)"
        if prop == "placeholder":
            sel += "::placeholder"
        rules.setdefault((prop, sel), value)

    out = []
    for (prop, sel), value in rules.items():
        out.append("body.workspace-theme-dark " + sel + " { " + PROP[prop] + ": " + value + "; }")
    print(NL.join(out))


main()
