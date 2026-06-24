"""Mermaid diagram extraction and rendering."""
import json
import re
import subprocess
import yaml
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import List, Dict, Optional, Tuple, Any


class DiagramFormat(Enum):
    """Output format for rendered diagrams."""
    PNG = "png"
    SVG = "svg"
    AUTO = "auto"


@dataclass
class DiagramInfo:
    """Information about a rendered diagram.

    Attributes:
        path: Path to the rendered image file.
        title: Optional title/caption from diagram metadata.
        code: Original Mermaid code.
        logical_width: Logical width in source units (CSS pixels for Mermaid).
        logical_height: Logical height in source units.
        units_per_inch: Conversion factor to inches (96 for CSS pixels, 72 for points).
    """
    path: Path
    title: Optional[str] = None
    code: str = ""
    logical_width: Optional[float] = None
    logical_height: Optional[float] = None
    units_per_inch: float = 96.0  # CSS pixels default


def extract_svg_dimensions(svg_content: str) -> Tuple[Optional[float], Optional[float]]:
    """Extract logical dimensions from SVG viewBox or width/height attributes.

    Args:
        svg_content: SVG file content as string.

    Returns:
        Tuple of (width, height) in logical units, or (None, None) if not found.
    """
    # Try viewBox first (most reliable)
    viewbox_match = re.search(r'viewBox="([^"]+)"', svg_content)
    if viewbox_match:
        parts = viewbox_match.group(1).split()
        if len(parts) >= 4:
            try:
                return float(parts[2]), float(parts[3])
            except ValueError:
                pass

    # Fall back to width/height attributes
    width_match = re.search(r'<svg[^>]*\swidth="([0-9.]+)', svg_content)
    height_match = re.search(r'<svg[^>]*\sheight="([0-9.]+)', svg_content)

    width = float(width_match.group(1)) if width_match else None
    height = float(height_match.group(1)) if height_match else None

    return width, height


def generate_mermaid_config(
    font_size: int = 14,
    font_family: str = "Source Sans Pro, sans-serif",
    **kwargs: Any
) -> Dict[str, Any]:
    """Generate Mermaid configuration for consistent diagram rendering.

    Creates a configuration dictionary that can be written to a JSON file
    and passed to mmdc via the -c flag for consistent font sizing.

    Args:
        font_size: Base font size in pixels (default: 14).
        font_family: CSS font family string (default: "Source Sans Pro, sans-serif").
        **kwargs: Additional theme variables to override.

    Returns:
        Configuration dictionary for Mermaid CLI.
    """
    config = {
        "theme": "default",
        "themeVariables": {
            "fontSize": f"{font_size}px",
            "fontFamily": font_family,
            # Flowchart specific
            "nodeTextColor": "#333",
            # Sequence diagram specific
            "actorFontSize": f"{font_size}px",
            "messageFontSize": f"{font_size}px",
            "noteFontSize": f"{font_size - 2}px",
            # Class diagram specific
            "classFontSize": f"{font_size}px",
            # State diagram specific
            "stateFontSize": f"{font_size}px",
            # ER diagram specific
            "entityFontSize": f"{font_size}px",
        }
    }

    # Apply any additional overrides
    if kwargs:
        config["themeVariables"].update(kwargs)

    return config


def write_mermaid_config(config: Dict[str, Any], output_path: Path) -> Path:
    """Write Mermaid configuration to a JSON file.

    Args:
        config: Configuration dictionary.
        output_path: Directory where config file should be written.

    Returns:
        Path to the created config file.
    """
    config_path = output_path / "mermaid-config.json"
    config_path.write_text(json.dumps(config, indent=2))
    return config_path


def resolve_diagram_format(output_suffix: str, format: DiagramFormat) -> str:
    """Resolve the actual diagram format based on output type and requested format.

    Args:
        output_suffix: The output file suffix (e.g., '.docx', '.md', '.html')
        format: The requested diagram format.

    Returns:
        The resolved format string ('png' or 'svg').
    """
    if format == DiagramFormat.AUTO:
        # Use SVG for web/text formats, PNG for DOCX (compatibility)
        if output_suffix.lower() in ('.docx', '.pdf'):
            return 'png'
        else:
            return 'svg'
    return format.value


def extract_mermaid_blocks(markdown_content: str) -> List[str]:
    """Extract Mermaid code blocks from markdown content.

    Args:
        markdown_content: Markdown text containing Mermaid diagrams.

    Returns:
        List of Mermaid diagram code strings.
    """
    pattern = r'```mermaid\n(.*?)```'
    blocks = re.findall(pattern, markdown_content, re.DOTALL)
    return [block.strip() for block in blocks]


def extract_diagram_title(mermaid_code: str) -> Tuple[Optional[str], str]:
    """Extract title from Mermaid diagram's YAML frontmatter.

    Mermaid supports YAML frontmatter at the beginning of the diagram:
    ```
    ---
    title: "My Diagram Title"
    ---
    flowchart LR
        A --> B
    ```

    Args:
        mermaid_code: The Mermaid diagram code.

    Returns:
        Tuple of (title, code_without_frontmatter).
        If no frontmatter, returns (None, original_code).
    """
    mermaid_code = mermaid_code.strip()

    # Check for YAML frontmatter (starts with ---)
    if not mermaid_code.startswith('---'):
        return (None, mermaid_code)

    # Find the closing ---
    lines = mermaid_code.split('\n')
    frontmatter_end = -1

    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == '---':
            frontmatter_end = i
            break

    if frontmatter_end == -1:
        return (None, mermaid_code)

    # Extract frontmatter YAML
    frontmatter_lines = lines[1:frontmatter_end]
    frontmatter_str = '\n'.join(frontmatter_lines)

    # Parse YAML
    try:
        frontmatter = yaml.safe_load(frontmatter_str)
        if frontmatter and isinstance(frontmatter, dict):
            title = frontmatter.get('title')
            # Return code without frontmatter for rendering
            code_without_fm = '\n'.join(lines[frontmatter_end + 1:]).strip()
            return (title, code_without_fm)
    except yaml.YAMLError:
        pass

    return (None, mermaid_code)


def render_diagram(
    mermaid_code: str,
    output_path: Path,
    width: int = 1200,
    scale: int = 2,
    format: str = "png",
    extract_dimensions: bool = False,
    config_path: Optional[Path] = None
) -> Tuple[Path, Optional[float], Optional[float]]:
    """Render a single Mermaid diagram to image.

    Args:
        mermaid_code: Mermaid diagram code.
        output_path: Path where image should be saved (extension will be adjusted).
        width: Maximum width in pixels (default: 1200 for page fitting).
        scale: Scale factor for higher resolution (default: 2 for better quality).
        format: Output format - 'png' or 'svg' (default: 'png').
        extract_dimensions: Whether to extract logical dimensions from SVG.
        config_path: Optional path to Mermaid config JSON file for consistent styling.

    Returns:
        Tuple of (path to generated image, logical_width, logical_height).
        Dimensions are None if extract_dimensions is False or extraction fails.

    Raises:
        RuntimeError: If rendering fails.
    """
    # Adjust output path extension based on format
    if format == "svg":
        output_path = output_path.with_suffix('.svg')
    else:
        output_path = output_path.with_suffix('.png')

    # Create temporary .mmd file
    temp_mmd = output_path.with_suffix('.mmd')
    temp_mmd.write_text(mermaid_code)

    logical_width, logical_height = None, None
    temp_svg_path = None

    try:
        # If we need dimensions and output is PNG, first render SVG to extract dimensions
        if extract_dimensions and format == "png":
            # Use _temp.svg suffix (mmdc requires .svg extension)
            temp_svg_path = output_path.with_name(output_path.stem + '_temp.svg')
            svg_cmd = [
                'mmdc',
                '-i', str(temp_mmd),
                '-o', str(temp_svg_path),
                '-b', 'transparent',
            ]
            # Add config if provided
            if config_path and config_path.exists():
                svg_cmd.extend(['-c', str(config_path)])
            svg_result = subprocess.run(svg_cmd, capture_output=True, text=True)
            if svg_result.returncode == 0 and temp_svg_path.exists():
                svg_content = temp_svg_path.read_text()
                logical_width, logical_height = extract_svg_dimensions(svg_content)

        # Build mmdc command for final output
        # -w: width to fit diagrams on page
        # -s: scale for higher resolution
        # -b: transparent background
        cmd = [
            'mmdc',
            '-i', str(temp_mmd),
            '-o', str(output_path),
            '-b', 'transparent',
            '-w', str(width),
        ]

        # Add config if provided (for consistent font sizing)
        if config_path and config_path.exists():
            cmd.extend(['-c', str(config_path)])

        # Scale only applies to PNG (raster) output
        if format == "png":
            cmd.extend(['-s', str(scale)])

        result = subprocess.run(cmd, capture_output=True, text=True)

        # Check if rendering succeeded
        if result.returncode != 0 or not output_path.exists():
            raise RuntimeError(
                f"Failed to render Mermaid diagram: {result.stderr}"
            )

        # Extract dimensions from SVG output if requested
        if extract_dimensions and format == "svg":
            svg_content = output_path.read_text()
            logical_width, logical_height = extract_svg_dimensions(svg_content)

        return output_path, logical_width, logical_height
    finally:
        # Clean up temporary files
        if temp_mmd.exists():
            temp_mmd.unlink()
        if temp_svg_path and temp_svg_path.exists():
            temp_svg_path.unlink()


def render_all_diagrams(
    markdown_content: str,
    temp_dir: Path,
    width: int = 1200,
    scale: int = 2,
    format: str = "png",
    extract_dimensions: bool = False,
    mermaid_config: Optional[Dict[str, Any]] = None
) -> Dict[str, DiagramInfo]:
    """Extract and render all Mermaid diagrams from markdown.

    Args:
        markdown_content: Markdown text containing Mermaid diagrams.
        temp_dir: Directory to store rendered images.
        width: Maximum width in pixels for diagrams (default: 1200).
        scale: Scale factor for higher resolution (default: 2).
        format: Output format - 'png' or 'svg' (default: 'png').
        extract_dimensions: Whether to extract logical dimensions for consistent sizing.
        mermaid_config: Optional Mermaid configuration dict for consistent styling.
            If provided, will be written to a config file and passed to mmdc.

    Returns:
        Dictionary mapping original Mermaid code to DiagramInfo objects.
        DiagramInfo contains the rendered path, optional title, and logical dimensions.
    """
    blocks = extract_mermaid_blocks(markdown_content)
    diagram_map = {}

    # Write Mermaid config if provided
    config_path = None
    if mermaid_config:
        config_path = write_mermaid_config(mermaid_config, temp_dir)

    ext = 'svg' if format == 'svg' else 'png'
    for idx, mermaid_code in enumerate(blocks):
        # Extract title from diagram's YAML frontmatter
        title, code_for_render = extract_diagram_title(mermaid_code)

        output_path = temp_dir / f"diagram_{idx}.{ext}"
        rendered_path, logical_width, logical_height = render_diagram(
            code_for_render, output_path, width=width, scale=scale, format=format,
            extract_dimensions=extract_dimensions, config_path=config_path
        )

        # Map original code (with frontmatter) to DiagramInfo
        diagram_map[mermaid_code] = DiagramInfo(
            path=rendered_path,
            title=title,
            code=mermaid_code,
            logical_width=logical_width,
            logical_height=logical_height,
            units_per_inch=96.0  # Mermaid uses CSS pixels
        )

    return diagram_map
