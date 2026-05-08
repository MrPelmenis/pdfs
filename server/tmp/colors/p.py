import math
import random


def hsl_to_rgb(h, s, l):
    """Convert HSL (h: 0-360, s: 0-100, l: 0-100) to RGB (0-255 each)."""
    s /= 100
    l /= 100
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = l - c / 2

    if   0   <= h < 60:  r, g, b = c, x, 0
    elif 60  <= h < 120: r, g, b = x, c, 0
    elif 120 <= h < 180: r, g, b = 0, c, x
    elif 180 <= h < 240: r, g, b = 0, x, c
    elif 240 <= h < 300: r, g, b = x, 0, c
    else:                r, g, b = c, 0, x

    return (round((r + m) * 255),
            round((g + m) * 255),
            round((b + m) * 255))


def perceptual_lightness(hue):
    """
    Human eyes perceive warm hues (reds, oranges, yellows) as naturally
    brighter. This compensates by slightly darkening warm hues and
    brightening cool ones — making all colors feel equally weighted.
    """
    return 60 + 8 * math.sin(math.radians(hue))


def is_ugly_hue(hue):
    """
    Skip hue ranges that look sickly or unpleasant on screens:
      50-80°   — muddy yellows / yellow-greens
      165-195° — cold blue-greens (seafoam)
    """
    hue = hue % 360
    return (50 <= hue <= 80) or (165 <= hue <= 195)


def generate_colors(n=10):
    """
    Golden ratio hue stepping with perceptual corrections:
    - Golden angle (137.508°) spaces hues maximally apart
    - Saturation at 68% — vivid but not neon
    - Lightness adapts per hue for visual balance
    - Ugly hue ranges are skipped automatically
    """
    GOLDEN_ANGLE = 137.508
    SATURATION   = 68

    hue = random.uniform(0, 360)
    colors = []

    while len(colors) < n:
        hue = (hue + GOLDEN_ANGLE) % 360
        if is_ugly_hue(hue):
            continue
        lightness = perceptual_lightness(hue)
        r, g, b   = hsl_to_rgb(hue, SATURATION, lightness)
        colors.append((r, g, b, hue))

    return colors


def fg_color(r, g, b):
    """Pick black or white text based on perceived luminance."""
    luminance = 0.299 * r + 0.587 * g + 0.114 * b
    return "\033[38;2;0;0;0m" if luminance > 145 else "\033[38;2;255;255;255m"


def print_swatch(r, g, b, hue, index):
    bg    = f"\033[48;2;{r};{g};{b}m"
    fg    = fg_color(r, g, b)
    reset = "\033[0m"
    dot   = f"\033[38;2;{r};{g};{b}m●{reset}"
    hex_code = f"#{r:02X}{g:02X}{b:02X}"

    swatch = f"{bg}{fg}   {hex_code}   {reset}"
    label  = f"{dot}  {hex_code}  rgb({r:3}, {g:3}, {b:3})  hue {hue:5.1f}°"

    print(f"  {index+1:2}.  {swatch}   {label}")


if __name__ == "__main__":
    print()
    print("  Eye-pleasing palette — golden ratio + perceptual corrections")
    print("  " + "─" * 60)
    print()

    colors = generate_colors(10)
    for i, (r, g, b, hue) in enumerate(colors):
        print_swatch(r, g, b, hue, i)

    print()
    print("  Run again for a different starting hue.")
    print()
