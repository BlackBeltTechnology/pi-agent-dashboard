"""Image style configuration module.

Provides dataclasses and functions for configuring image positioning and sizing.
"""
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class ImageStyleConfig:
    """Configuration for image styling.

    Attributes:
        position: Image position (left, center, right, stretch).
        width: Width specification (pixels, percentage, or 'original').
        height: Height specification (pixels, percentage, or 'original').
        wrap_distance: Distance for text wrapping in points.
        alt: Alternative text for the image.
        caption: Caption text for the image.
    """
    position: str = "center"  # left, center, right, stretch
    width: Optional[str] = None  # e.g., "400px", "80%", "original"
    height: Optional[str] = None  # e.g., "300px", "60%", "original"
    wrap_distance: int = 12  # Points
    alt: Optional[str] = None
    caption: Optional[str] = None

    @classmethod
    def from_dict(cls, style_dict: Dict[str, Any]) -> 'ImageStyleConfig':
        """Create ImageStyleConfig from a dictionary.

        Args:
            style_dict: Dictionary with style properties.

        Returns:
            ImageStyleConfig with values from dict.
        """
        return cls(
            position=style_dict.get('position', 'center'),
            width=style_dict.get('width'),
            height=style_dict.get('height'),
            wrap_distance=style_dict.get('wrap_distance', 12),
            alt=style_dict.get('alt'),
            caption=style_dict.get('caption'),
        )

    def merge(self, override: 'ImageStyleConfig') -> 'ImageStyleConfig':
        """Merge this config with an override config.

        Args:
            override: ImageStyleConfig with override values.

        Returns:
            New ImageStyleConfig with merged values.
        """
        default = ImageStyleConfig()
        return ImageStyleConfig(
            position=override.position if override.position != default.position else self.position,
            width=override.width if override.width is not None else self.width,
            height=override.height if override.height is not None else self.height,
            wrap_distance=override.wrap_distance if override.wrap_distance != default.wrap_distance else self.wrap_distance,
            alt=override.alt if override.alt is not None else self.alt,
            caption=override.caption if override.caption is not None else self.caption,
        )


# Default image style configuration
DEFAULT_IMAGE_STYLE = ImageStyleConfig()


def parse_dimension(value: str, container_width: int = 0, original_dim: int = 0) -> Optional[int]:
    """Parse a dimension specification into pixels.

    Args:
        value: Dimension string (e.g., "400px", "80%", "original").
        container_width: Container width for percentage calculations.
        original_dim: Original dimension for 'original' keyword.

    Returns:
        Dimension in pixels, or None if invalid.
    """
    if value is None:
        return None

    value = str(value).strip().lower()

    if value == 'original':
        return original_dim if original_dim > 0 else None

    # Percentage
    if value.endswith('%'):
        try:
            percent = float(value[:-1])
            if container_width > 0:
                return int(container_width * percent / 100)
        except ValueError:
            pass
        return None

    # Pixels
    if value.endswith('px'):
        try:
            return int(value[:-2])
        except ValueError:
            pass
        return None

    # Plain number (assume pixels)
    try:
        return int(float(value))
    except ValueError:
        pass

    return None


def calculate_dimensions(
    original_width: int,
    original_height: int,
    target_width: Optional[int],
    target_height: Optional[int]
) -> Tuple[int, int]:
    """Calculate final dimensions preserving aspect ratio.

    Args:
        original_width: Original image width.
        original_height: Original image height.
        target_width: Target width (or None for auto).
        target_height: Target height (or None for auto).

    Returns:
        Tuple of (width, height) in pixels.
    """
    if original_width <= 0 or original_height <= 0:
        return (target_width or 0, target_height or 0)

    aspect_ratio = original_width / original_height

    # Both specified - use as-is
    if target_width and target_height:
        return (target_width, target_height)

    # Only width specified - calculate height
    if target_width:
        return (target_width, int(target_width / aspect_ratio))

    # Only height specified - calculate width
    if target_height:
        return (int(target_height * aspect_ratio), target_height)

    # Neither specified - use original
    return (original_width, original_height)


def parse_inline_image_style(img_ref: str) -> Optional[ImageStyleConfig]:
    """Parse inline image style from markdown image syntax.

    Supports syntax like: ![alt](path){position=center width=400px}

    Args:
        img_ref: The image reference string.

    Returns:
        ImageStyleConfig if style attributes found, None otherwise.
    """
    # Look for style block at end: {key=value key=value}
    match = re.search(r'\{([^}]+)\}\s*$', img_ref)
    if not match:
        return None

    style_str = match.group(1)
    style_dict: Dict[str, Any] = {}

    # Parse key=value pairs
    for pair in re.findall(r'(\w+)=([^\s}]+)', style_str):
        key, value = pair
        style_dict[key] = value

    if style_dict:
        return ImageStyleConfig.from_dict(style_dict)
    return None


def parse_image_style_block(content: str) -> List[Tuple[ImageStyleConfig, int]]:
    """Parse image-style code blocks from content.

    Finds HTML comments in format: <!-- image-style: key=value, key=value -->

    Args:
        content: The document content to parse.

    Returns:
        List of tuples (ImageStyleConfig, position) for each style block found.
    """
    blocks = []

    # Pattern to match image-style comments
    pattern = r'<!--\s*image-style:\s*(.+?)\s*-->'

    for match in re.finditer(pattern, content):
        style_str = match.group(1)
        position = match.start()

        # Parse key=value pairs
        style_dict: Dict[str, Any] = {}
        for pair in re.findall(r'(\w+)=([^,\s]+)', style_str):
            key, value = pair
            # Convert types
            if value.lower() == 'true':
                style_dict[key] = True
            elif value.lower() == 'false':
                style_dict[key] = False
            elif value.isdigit():
                style_dict[key] = int(value)
            else:
                style_dict[key] = value

        config = ImageStyleConfig.from_dict(style_dict)
        blocks.append((config, position))

    return blocks


def extract_image_style(frontmatter: Dict[str, Any]) -> Optional[ImageStyleConfig]:
    """Extract image style configuration from frontmatter.

    Args:
        frontmatter: Parsed frontmatter dictionary.

    Returns:
        ImageStyleConfig if image_style is present, None otherwise.
    """
    image_style_dict = frontmatter.get('image_style')
    if image_style_dict and isinstance(image_style_dict, dict):
        return ImageStyleConfig.from_dict(image_style_dict)
    return None
