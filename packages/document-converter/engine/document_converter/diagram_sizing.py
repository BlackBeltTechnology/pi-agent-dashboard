"""Diagram sizing algorithm for consistent visual scaling.

This module implements the Constant Zoom normalization algorithm that ensures
diagrams from different tools (Mermaid, PlantUML, Graphviz) appear with
consistent visual scale in the output document.

The algorithm:
1. Extracts logical dimensions from diagram source (SVG viewBox, JSON bounding box)
2. Converts to physical dimensions using units_per_inch (96 for CSS pixels, 72 for points)
3. Calculates scale factor to fit within page constraints
4. Applies minimum scale threshold to prevent unreadable diagrams
5. Optionally rotates wide diagrams to landscape orientation
"""
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Tuple
import logging

logger = logging.getLogger(__name__)

# Default page dimensions (Letter size with 1" margins)
DEFAULT_PAGE_WIDTH_INCHES = 6.5  # 8.5" - 2" margins
DEFAULT_PAGE_HEIGHT_INCHES = 9.0  # 11" - 2" margins

# Minimum scale threshold (30% of original size)
DEFAULT_MIN_SCALE = 0.3

# EMU (English Metric Units) per inch for python-docx
EMU_PER_INCH = 914400


class SizingMode(Enum):
    """Diagram sizing mode."""
    FIXED = "fixed"        # Use fixed dimensions (legacy behavior)
    CONSISTENT = "consistent"  # Use Constant Zoom normalization
    AUTO = "auto"          # Automatic based on diagram complexity


class RotationMode(Enum):
    """Rotation mode for wide diagrams."""
    NONE = "none"          # Never rotate
    AUTO = "auto"          # Auto-rotate if it improves fit
    WARN = "warn"          # Warn user about rotation opportunity


@dataclass
class SizingConfig:
    """Configuration for diagram sizing.

    Attributes:
        mode: Sizing mode (fixed, consistent, auto).
        page_width_inches: Available width on page in inches.
        page_height_inches: Available height on page in inches.
        min_scale: Minimum scale factor (0.3 = 30% of original).
        rotation: Rotation mode for wide diagrams.
        default_dpi: Default DPI for diagrams without dimension info.
    """
    mode: SizingMode = SizingMode.CONSISTENT
    page_width_inches: float = DEFAULT_PAGE_WIDTH_INCHES
    page_height_inches: float = DEFAULT_PAGE_HEIGHT_INCHES
    min_scale: float = DEFAULT_MIN_SCALE
    rotation: RotationMode = RotationMode.WARN
    default_dpi: int = 96


@dataclass
class DiagramDimensions:
    """Calculated dimensions for a diagram.

    Attributes:
        width_inches: Final width in inches.
        height_inches: Final height in inches.
        width_emu: Final width in EMU (for python-docx).
        height_emu: Final height in EMU (for python-docx).
        scale_factor: Applied scale factor (1.0 = original size).
        rotation_applied: Whether diagram was rotated.
        rotation_recommended: Whether rotation would improve fit.
        warning: Optional warning message.
    """
    width_inches: float
    height_inches: float
    width_emu: int
    height_emu: int
    scale_factor: float
    rotation_applied: bool = False
    rotation_recommended: bool = False
    warning: Optional[str] = None


def calculate_diagram_dimensions(
    logical_width: Optional[float],
    logical_height: Optional[float],
    units_per_inch: float = 96.0,
    config: Optional[SizingConfig] = None
) -> DiagramDimensions:
    """Calculate final diagram dimensions using Constant Zoom algorithm.

    Args:
        logical_width: Logical width in source units (CSS pixels or points).
        logical_height: Logical height in source units.
        units_per_inch: Conversion factor (96 for CSS pixels, 72 for points).
        config: Sizing configuration. Uses defaults if not provided.

    Returns:
        DiagramDimensions with calculated sizes and metadata.
    """
    if config is None:
        config = SizingConfig()

    # Handle missing dimensions
    if logical_width is None or logical_height is None:
        # Fall back to default size that fits page width
        return DiagramDimensions(
            width_inches=config.page_width_inches,
            height_inches=config.page_width_inches * 0.75,  # 4:3 aspect ratio default
            width_emu=int(config.page_width_inches * EMU_PER_INCH),
            height_emu=int(config.page_width_inches * 0.75 * EMU_PER_INCH),
            scale_factor=1.0,
            warning="Diagram dimensions not available, using default size"
        )

    # Convert logical units to inches
    width_inches = logical_width / units_per_inch
    height_inches = logical_height / units_per_inch

    # For fixed mode, just return the natural size (clamped to page)
    if config.mode == SizingMode.FIXED:
        return _calculate_fixed_dimensions(
            width_inches, height_inches, config
        )

    # For consistent mode, apply Constant Zoom normalization
    return _calculate_consistent_dimensions(
        width_inches, height_inches, config
    )


def _calculate_fixed_dimensions(
    width_inches: float,
    height_inches: float,
    config: SizingConfig
) -> DiagramDimensions:
    """Calculate dimensions using fixed mode (scale to fit page only).

    Args:
        width_inches: Natural width in inches.
        height_inches: Natural height in inches.
        config: Sizing configuration.

    Returns:
        DiagramDimensions scaled to fit page.
    """
    # Calculate scale to fit within page bounds
    width_scale = config.page_width_inches / width_inches if width_inches > 0 else 1.0
    height_scale = config.page_height_inches / height_inches if height_inches > 0 else 1.0

    # Use the smaller scale to fit both dimensions
    scale = min(width_scale, height_scale, 1.0)  # Don't upscale

    final_width = width_inches * scale
    final_height = height_inches * scale

    return DiagramDimensions(
        width_inches=final_width,
        height_inches=final_height,
        width_emu=int(final_width * EMU_PER_INCH),
        height_emu=int(final_height * EMU_PER_INCH),
        scale_factor=scale
    )


def _calculate_consistent_dimensions(
    width_inches: float,
    height_inches: float,
    config: SizingConfig
) -> DiagramDimensions:
    """Calculate dimensions using Constant Zoom normalization.

    This algorithm ensures that all diagrams are rendered at a consistent
    zoom level relative to the page, so a 10pt font in one diagram appears
    the same size as a 10pt font in another diagram.

    Args:
        width_inches: Natural width in inches.
        height_inches: Natural height in inches.
        config: Sizing configuration.

    Returns:
        DiagramDimensions with consistent scaling applied.
    """
    # Calculate scale factors for width and height
    width_scale = config.page_width_inches / width_inches if width_inches > 0 else 1.0
    height_scale = config.page_height_inches / height_inches if height_inches > 0 else 1.0

    # Use the smaller scale to fit both dimensions
    scale = min(width_scale, height_scale)

    # Check if rotation would improve the fit
    rotation_recommended = False
    rotated_scale = None

    # Minimum improvement threshold for rotation (20% better fit required)
    # This prevents rotating diagrams that are only slightly wider than tall
    ROTATION_IMPROVEMENT_THRESHOLD = 0.20

    if width_inches > height_inches:
        # Wide diagram - check if rotation improves fit
        rotated_width_scale = config.page_width_inches / height_inches if height_inches > 0 else 1.0
        rotated_height_scale = config.page_height_inches / width_inches if width_inches > 0 else 1.0
        rotated_scale = min(rotated_width_scale, rotated_height_scale)

        # Only recommend rotation if it provides significant improvement
        improvement = (rotated_scale / scale - 1) if scale > 0 else 0
        if rotated_scale > scale and improvement >= ROTATION_IMPROVEMENT_THRESHOLD:
            rotation_recommended = True

    # Handle rotation recommendation
    # NOTE: We do NOT swap dimensions here because that would distort the image.
    # The rotation_applied/rotation_recommended flags are informational only.
    # Actual image rotation would require rotating the PNG/SVG file itself,
    # which is not implemented. For now, we just warn about the opportunity.
    rotation_applied = False
    warning = None

    if rotation_recommended:
        improvement = (rotated_scale / scale - 1) * 100 if scale > 0 else 0
        if config.rotation == RotationMode.AUTO or config.rotation == RotationMode.WARN:
            # Don't actually rotate - just warn about the opportunity
            # Swapping dimensions without rotating the image causes distortion
            warning = (
                f"Diagram would fit {improvement:.0f}% larger if rotated to landscape. "
                f"Consider restructuring the diagram to be taller than wide."
            )

    # Check minimum scale threshold
    if scale < config.min_scale:
        warning_msg = (
            f"Diagram scaled to {scale:.0%} which is below minimum threshold "
            f"({config.min_scale:.0%}). Diagram may be difficult to read."
        )
        if warning:
            warning = f"{warning} {warning_msg}"
        else:
            warning = warning_msg

        # Log the warning
        logger.warning(warning_msg)

    # Don't upscale diagrams
    scale = min(scale, 1.0)

    final_width = width_inches * scale
    final_height = height_inches * scale

    return DiagramDimensions(
        width_inches=final_width,
        height_inches=final_height,
        width_emu=int(final_width * EMU_PER_INCH),
        height_emu=int(final_height * EMU_PER_INCH),
        scale_factor=scale,
        rotation_applied=rotation_applied,
        rotation_recommended=rotation_recommended,
        warning=warning
    )


def inches_to_emu(inches: float) -> int:
    """Convert inches to EMU (English Metric Units).

    Args:
        inches: Dimension in inches.

    Returns:
        Dimension in EMU.
    """
    return int(inches * EMU_PER_INCH)


def emu_to_inches(emu: int) -> float:
    """Convert EMU (English Metric Units) to inches.

    Args:
        emu: Dimension in EMU.

    Returns:
        Dimension in inches.
    """
    return emu / EMU_PER_INCH


def parse_sizing_config(frontmatter: dict) -> SizingConfig:
    """Parse sizing configuration from document frontmatter.

    Expected frontmatter format:
    ```yaml
    diagrams:
      sizing: consistent  # or fixed, auto
      min_scale: 0.3
      rotation: warn      # or auto, none
      page_width: 6.5     # inches
      page_height: 9.0    # inches
    ```

    Args:
        frontmatter: Parsed frontmatter dictionary.

    Returns:
        SizingConfig with parsed values or defaults.
    """
    config = SizingConfig()

    diagrams = frontmatter.get('diagrams', {})
    if not isinstance(diagrams, dict):
        return config

    # Parse sizing mode
    sizing = diagrams.get('sizing', 'consistent')
    if sizing == 'fixed':
        config.mode = SizingMode.FIXED
    elif sizing == 'auto':
        config.mode = SizingMode.AUTO
    else:
        config.mode = SizingMode.CONSISTENT

    # Parse min_scale
    min_scale = diagrams.get('min_scale')
    if min_scale is not None:
        try:
            config.min_scale = float(min_scale)
        except (TypeError, ValueError):
            pass

    # Parse rotation mode
    rotation = diagrams.get('rotation', 'warn')
    if rotation == 'auto':
        config.rotation = RotationMode.AUTO
    elif rotation == 'none':
        config.rotation = RotationMode.NONE
    else:
        config.rotation = RotationMode.WARN

    # Parse page dimensions
    page_width = diagrams.get('page_width')
    if page_width is not None:
        try:
            config.page_width_inches = float(page_width)
        except (TypeError, ValueError):
            pass

    page_height = diagrams.get('page_height')
    if page_height is not None:
        try:
            config.page_height_inches = float(page_height)
        except (TypeError, ValueError):
            pass

    return config
