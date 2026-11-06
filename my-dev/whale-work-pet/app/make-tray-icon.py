"""Render the tray icon for the whale-work pet.

The tray needs a raster image; this draws the same geometry as `icon.svg`
(rounded blue tile, white fluke, cyan spout) at the sizes Windows asks for.
Run it after changing the icon: `python app/make-tray-icon.py`.
"""

from PIL import Image, ImageDraw

SCALE = 4
SIZES = (16, 20, 24, 32, 40, 48, 64)


def render(size: int) -> Image.Image:
    """Draw one square icon at `size` pixels on a transparent background."""
    canvas = size * SCALE
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    def s(value: float) -> int:
        """Scale a design-space value (0–64) to canvas pixels."""
        return round(value / 64 * canvas)

    draw.rounded_rectangle(
        (s(4), s(4), s(60), s(60)), radius=s(15), fill=(37, 71, 200, 255)
    )
    # Fluke: two lobes meeting at the base, matching the SVG path.
    draw.polygon(
        [
            (s(32), s(50)),
            (s(15.5), s(27.5)),
            (s(28.2), s(26.2)),
            (s(32), s(32.2)),
            (s(35.8), s(26.2)),
            (s(48.5), s(27.5)),
        ],
        fill=(243, 247, 255, 255),
    )
    draw.ellipse((s(29.4), s(13.4), s(34.6), s(18.6)), fill=(143, 208, 255, 255))
    draw.arc(
        (s(10), s(46), s(54), s(60)),
        start=200,
        end=340,
        fill=(143, 208, 255, 220),
        width=max(1, s(2.4)),
    )
    return image.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    largest = render(max(SIZES))
    largest.save(
        "app/tray.ico",
        sizes=[(size, size) for size in SIZES],
    )
    render(32).save("app/tray.png")
    print("wrote app/tray.ico and app/tray.png")
