"""PlantUML diagram rendering.

This module handles extraction and rendering of PlantUML diagrams
from Markdown and AsciiDoc content.
"""
import base64
import re
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import urllib.request
import urllib.error

from .plantuml_server import get_server, PlantUMLServerError


class PlantUMLRenderError(Exception):
    """Exception raised for PlantUML rendering errors."""
    pass


@dataclass
class PlantUMLDiagramInfo:
    """Information about a rendered PlantUML diagram.

    Attributes:
        path: Path to the rendered image file.
        code: Original PlantUML code.
        logical_width: Logical width in points (1/72 inch).
        logical_height: Logical height in points.
        units_per_inch: Conversion factor (72 for PlantUML points).
    """
    path: Path
    code: str = ""
    logical_width: Optional[float] = None
    logical_height: Optional[float] = None
    units_per_inch: float = 72.0  # PlantUML uses points


# Regex patterns for PlantUML block extraction
PLANTUML_MARKDOWN_PATTERN = re.compile(
    r'```plantuml\s*\n(.*?)```',
    re.DOTALL
)

PLANTUML_ASCIIDOC_PATTERN = re.compile(
    r'\[(source,)?plantuml\]\s*\n----\s*\n(.*?)----',
    re.DOTALL
)


def inject_plantuml_styling(
    plantuml_code: str,
    font_size: int = 14,
    font_family: str = "Source Sans Pro"
) -> str:
    """Inject consistent styling into PlantUML code.

    Adds skinparam settings at the beginning of the diagram to ensure
    consistent font sizing across all PlantUML diagrams.

    Args:
        plantuml_code: Original PlantUML code.
        font_size: Font size in points (default: 14).
        font_family: Font family name (default: "Source Sans Pro").

    Returns:
        PlantUML code with styling injected.
    """
    # Build skinparam block
    skinparams = f"""
skinparam defaultFontSize {font_size}
skinparam defaultFontName {font_family}
skinparam noteFontSize {font_size - 2}
skinparam classFontSize {font_size}
skinparam classAttributeFontSize {font_size - 1}
skinparam actorFontSize {font_size}
skinparam sequenceMessageFontSize {font_size}
skinparam sequenceActorFontSize {font_size}
skinparam stateFontSize {font_size}
"""

    # Find where to insert skinparams
    # After @startuml but before the actual diagram content
    startuml_match = re.search(r'@start\w+', plantuml_code)
    if startuml_match:
        # Insert after @startuml line
        end_pos = startuml_match.end()
        # Check if there's a newline after @startuml
        if end_pos < len(plantuml_code) and plantuml_code[end_pos] == '\n':
            end_pos += 1
        return plantuml_code[:end_pos] + skinparams + plantuml_code[end_pos:]
    else:
        # No @start directive found, prepend skinparams
        return skinparams.strip() + '\n' + plantuml_code


def extract_svg_dimensions(svg_content: str) -> Tuple[Optional[float], Optional[float]]:
    """Extract logical dimensions from PlantUML SVG output.

    PlantUML SVGs typically include width/height in the root element.
    The viewBox provides the logical coordinate system in points.

    Args:
        svg_content: SVG file content as string.

    Returns:
        Tuple of (width, height) in points (1/72 inch), or (None, None) if not found.
    """
    # Try viewBox first (most reliable for logical dimensions)
    viewbox_match = re.search(r'viewBox="([^"]+)"', svg_content)
    if viewbox_match:
        parts = viewbox_match.group(1).split()
        if len(parts) >= 4:
            try:
                return float(parts[2]), float(parts[3])
            except ValueError:
                pass

    # Fall back to width/height attributes (PlantUML often uses these)
    # PlantUML may use units like "123px" or just numbers
    width_match = re.search(r'<svg[^>]*\swidth="([0-9.]+)(?:px)?"', svg_content)
    height_match = re.search(r'<svg[^>]*\sheight="([0-9.]+)(?:px)?"', svg_content)

    width = float(width_match.group(1)) if width_match else None
    height = float(height_match.group(1)) if height_match else None

    return width, height


def extract_plantuml_blocks(content: str) -> List[str]:
    """Extract PlantUML diagram blocks from Markdown content.

    Args:
        content: Markdown content.

    Returns:
        List of PlantUML diagram code strings.
    """
    matches = PLANTUML_MARKDOWN_PATTERN.findall(content)
    return [match.strip() for match in matches]


def extract_plantuml_blocks_adoc(content: str) -> List[str]:
    """Extract PlantUML diagram blocks from AsciiDoc content.

    Supports both [source,plantuml] and [plantuml] block syntaxes.

    Args:
        content: AsciiDoc content.

    Returns:
        List of PlantUML diagram code strings.
    """
    matches = PLANTUML_ASCIIDOC_PATTERN.findall(content)
    # Each match is a tuple (source_prefix, diagram_code)
    return [match[1].strip() for match in matches]


def _encode_plantuml(plantuml_code: str) -> str:
    """Encode PlantUML code for the PlantUML server URL.

    Uses the PlantUML text encoding format:
    1. UTF-8 encode
    2. Deflate compress
    3. Custom base64-like encoding

    Args:
        plantuml_code: PlantUML diagram code.

    Returns:
        Encoded string for use in PlantUML server URL.
    """
    # PlantUML uses a custom encoding
    # First, compress the text
    compressed = zlib.compress(plantuml_code.encode('utf-8'), 9)[2:-4]

    # PlantUML's custom base64 alphabet
    alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_"

    result = []
    for i in range(0, len(compressed), 3):
        chunk = compressed[i:i+3]
        if len(chunk) == 3:
            b1, b2, b3 = chunk
            result.append(alphabet[b1 >> 2])
            result.append(alphabet[((b1 & 0x3) << 4) | (b2 >> 4)])
            result.append(alphabet[((b2 & 0xF) << 2) | (b3 >> 6)])
            result.append(alphabet[b3 & 0x3F])
        elif len(chunk) == 2:
            b1, b2 = chunk
            result.append(alphabet[b1 >> 2])
            result.append(alphabet[((b1 & 0x3) << 4) | (b2 >> 4)])
            result.append(alphabet[(b2 & 0xF) << 2])
        elif len(chunk) == 1:
            b1 = chunk[0]
            result.append(alphabet[b1 >> 2])
            result.append(alphabet[(b1 & 0x3) << 4])

    return ''.join(result)


def render_plantuml_diagram(
    plantuml_code: str,
    format: str = "png",
    extract_dimensions: bool = False
) -> Tuple[bytes, Optional[float], Optional[float]]:
    """Render a PlantUML diagram to image bytes.

    Args:
        plantuml_code: PlantUML diagram code.
        format: Output format - 'png' or 'svg' (default: 'png').
        extract_dimensions: Whether to extract logical dimensions from SVG.

    Returns:
        Tuple of (image data as bytes, logical_width, logical_height).
        Dimensions are in points (1/72 inch), None if extraction fails or disabled.

    Raises:
        PlantUMLRenderError: If rendering fails.
    """
    server = get_server()

    # Get or start server
    base_url = server.get_base_url()
    if not base_url:
        try:
            base_url = server.ensure_running()
        except (PlantUMLServerError, Exception) as e:
            raise PlantUMLRenderError(f"Failed to start PlantUML server: {e}")

    # Encode the diagram
    encoded = _encode_plantuml(plantuml_code)

    logical_width, logical_height = None, None

    # If extracting dimensions and format is PNG, first fetch SVG for dimensions
    if extract_dimensions and format == "png":
        svg_url = f"{base_url}/svg/{encoded}"
        try:
            with urllib.request.urlopen(svg_url, timeout=30) as response:
                svg_content = response.read().decode('utf-8')
                logical_width, logical_height = extract_svg_dimensions(svg_content)
        except (urllib.error.URLError, urllib.error.HTTPError):
            pass  # Continue without dimensions

    # Use appropriate endpoint based on format
    endpoint = "svg" if format == "svg" else "png"
    url = f"{base_url}/{endpoint}/{encoded}"

    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            image_data = response.read()

            # Extract dimensions from SVG output if requested
            if extract_dimensions and format == "svg":
                svg_content = image_data.decode('utf-8')
                logical_width, logical_height = extract_svg_dimensions(svg_content)

            return image_data, logical_width, logical_height
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        raise PlantUMLRenderError(f"Failed to render diagram: {e}")


def replace_plantuml_with_images(
    content: str,
    output_dir: Path,
    image_prefix: str = "plantuml_diagram",
    format: str = "png",
    extract_dimensions: bool = False
) -> Tuple[str, List[PlantUMLDiagramInfo]]:
    """Replace PlantUML blocks in Markdown with image references.

    Args:
        content: Markdown content with PlantUML blocks.
        output_dir: Directory to save rendered images.
        image_prefix: Prefix for image filenames.
        format: Output format - 'png' or 'svg' (default: 'png').
        extract_dimensions: Whether to extract logical dimensions for consistent sizing.

    Returns:
        Tuple of (modified content, list of PlantUMLDiagramInfo objects).
    """
    blocks = extract_plantuml_blocks(content)
    if not blocks:
        return content, []

    diagrams = []
    result = content
    ext = "svg" if format == "svg" else "png"

    for i, block in enumerate(blocks):
        try:
            image_data, logical_width, logical_height = render_plantuml_diagram(
                block, format=format, extract_dimensions=extract_dimensions
            )
            image_path = output_dir / f"{image_prefix}_{i}.{ext}"
            image_path.write_bytes(image_data)

            diagram_info = PlantUMLDiagramInfo(
                path=image_path,
                code=block,
                logical_width=logical_width,
                logical_height=logical_height,
                units_per_inch=72.0
            )
            diagrams.append(diagram_info)

            # Replace the block with an image reference
            old_block = f"```plantuml\n{block}\n```"
            new_ref = f"![PlantUML Diagram]({image_path.name})"
            result = result.replace(old_block, new_ref, 1)
        except PlantUMLRenderError:
            # Keep the original block if rendering fails
            pass

    return result, diagrams


def replace_plantuml_with_images_adoc(
    content: str,
    output_dir: Path,
    image_prefix: str = "plantuml_diagram",
    format: str = "png",
    extract_dimensions: bool = False
) -> Tuple[str, List[PlantUMLDiagramInfo]]:
    """Replace PlantUML blocks in AsciiDoc with image references.

    Args:
        content: AsciiDoc content with PlantUML blocks.
        output_dir: Directory to save rendered images.
        image_prefix: Prefix for image filenames.
        format: Output format - 'png' or 'svg' (default: 'png').
        extract_dimensions: Whether to extract logical dimensions for consistent sizing.

    Returns:
        Tuple of (modified content, list of PlantUMLDiagramInfo objects).
    """
    diagrams = []
    result = content
    ext = "svg" if format == "svg" else "png"

    def replace_block(match):
        nonlocal diagrams
        source_prefix = match.group(1) or ""
        block = match.group(2).strip()

        try:
            image_data, logical_width, logical_height = render_plantuml_diagram(
                block, format=format, extract_dimensions=extract_dimensions
            )
            image_path = output_dir / f"{image_prefix}_{len(diagrams)}.{ext}"
            image_path.write_bytes(image_data)

            diagram_info = PlantUMLDiagramInfo(
                path=image_path,
                code=block,
                logical_width=logical_width,
                logical_height=logical_height,
                units_per_inch=72.0
            )
            diagrams.append(diagram_info)

            # Return AsciiDoc image macro
            return f"image::{image_path.name}[PlantUML Diagram]"
        except PlantUMLRenderError:
            # Keep the original block if rendering fails
            return match.group(0)

    result = PLANTUML_ASCIIDOC_PATTERN.sub(replace_block, content)
    return result, diagrams


def render_all_plantuml_diagrams(
    content: str,
    output_dir: Path,
    format: str = 'markdown',
    image_format: str = 'png',
    image_prefix: str = "plantuml_diagram",
    fail_on_error: bool = True,
    extract_dimensions: bool = False
) -> Dict:
    """Render all PlantUML diagrams in a document.

    Args:
        content: Document content.
        output_dir: Directory to save rendered images.
        format: Content format ('markdown' or 'asciidoc').
        image_format: Image output format - 'png' or 'svg' (default: 'png').
        image_prefix: Prefix for image filenames.
        fail_on_error: If True, raise exception on error. If False, continue with warnings.
        extract_dimensions: Whether to extract logical dimensions for consistent sizing.

    Returns:
        Dictionary with 'content', 'diagrams' (list of PlantUMLDiagramInfo),
        'images' (legacy, list of Paths), and optionally 'warnings'.
    """
    result = {
        'content': content,
        'diagrams': [],
        'images': [],  # Legacy: list of paths for backward compatibility
        'warnings': []
    }

    # Ensure output directory exists
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Try to ensure server is running
    server = get_server()
    try:
        server.ensure_running()
    except (PlantUMLServerError, Exception) as e:
        warning = f"PlantUML server not available: {e}"
        if fail_on_error:
            raise PlantUMLRenderError(warning)
        result['warnings'].append(warning)
        return result

    # Replace diagrams based on format
    try:
        if format.lower() == 'asciidoc':
            new_content, diagrams = replace_plantuml_with_images_adoc(
                content, output_dir, image_prefix, format=image_format,
                extract_dimensions=extract_dimensions
            )
        else:
            new_content, diagrams = replace_plantuml_with_images(
                content, output_dir, image_prefix, format=image_format,
                extract_dimensions=extract_dimensions
            )

        result['content'] = new_content
        result['diagrams'] = diagrams
        result['images'] = [d.path for d in diagrams]  # Legacy compatibility

    except Exception as e:
        warning = f"Failed to render PlantUML diagrams: {e}"
        if fail_on_error:
            raise PlantUMLRenderError(warning)
        result['warnings'].append(warning)

    return result


def has_plantuml_blocks(content: str, format: str = 'markdown') -> bool:
    """Check if content contains PlantUML blocks.

    Args:
        content: Document content.
        format: Content format ('markdown' or 'asciidoc').

    Returns:
        True if PlantUML blocks are found.
    """
    if format.lower() == 'asciidoc':
        return bool(PLANTUML_ASCIIDOC_PATTERN.search(content))
    else:
        return bool(PLANTUML_MARKDOWN_PATTERN.search(content))
