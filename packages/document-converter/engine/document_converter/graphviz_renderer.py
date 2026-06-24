"""Graphviz DOT diagram extraction and rendering."""
import json
import logging
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Supported Graphviz layout engines
LAYOUT_ENGINES = ['dot', 'neato', 'fdp', 'circo', 'twopi', 'sfdp']
DEFAULT_LAYOUT = 'dot'


def inject_graphviz_styling(
    dot_code: str,
    font_size: int = 14,
    font_family: str = "Source Sans Pro"
) -> str:
    """Inject consistent styling into Graphviz DOT code.

    Adds graph, node, and edge font attributes for consistent sizing.

    Args:
        dot_code: Original DOT code.
        font_size: Font size in points (default: 14).
        font_family: Font family name (default: "Source Sans Pro").

    Returns:
        DOT code with styling injected.
    """
    # Build style attributes
    style_attrs = f'''
    graph [fontsize={font_size}, fontname="{font_family}"];
    node [fontsize={font_size}, fontname="{font_family}"];
    edge [fontsize={font_size - 2}, fontname="{font_family}"];
'''

    # Find the opening brace of the graph/digraph
    brace_match = re.search(r'((?:di)?graph\s+\w*\s*)\{', dot_code, re.IGNORECASE)
    if brace_match:
        # Insert after the opening brace
        insert_pos = brace_match.end()
        return dot_code[:insert_pos] + style_attrs + dot_code[insert_pos:]
    else:
        # No graph declaration found, return as-is
        logger.warning("Could not find graph declaration in DOT code for style injection")
        return dot_code


@dataclass
class GraphvizDiagramInfo:
    """Information about a rendered Graphviz diagram.

    Attributes:
        path: Path to the rendered image file.
        code: Original DOT code.
        logical_width: Logical width in points (1/72 inch).
        logical_height: Logical height in points.
        units_per_inch: Conversion factor (72 for Graphviz points).
        layout_engine: Layout engine used for rendering.
    """
    path: Path
    code: str = ""
    logical_width: Optional[float] = None
    logical_height: Optional[float] = None
    units_per_inch: float = 72.0  # Graphviz uses points
    layout_engine: str = DEFAULT_LAYOUT


def is_graphviz_available() -> bool:
    """Check if Graphviz (dot command) is available.

    Returns:
        True if Graphviz is installed and accessible.
    """
    return shutil.which('dot') is not None


def extract_graphviz_blocks(markdown_content: str) -> List[str]:
    """Extract Graphviz DOT code blocks from markdown content.

    Supports both ```dot and ```graphviz fenced code blocks.

    Args:
        markdown_content: Markdown text containing Graphviz diagrams.

    Returns:
        List of DOT diagram code strings.
    """
    # Match ```dot or ```graphviz code blocks
    pattern = r'```(?:dot|graphviz)\n(.*?)```'
    blocks = re.findall(pattern, markdown_content, re.DOTALL)
    return [block.strip() for block in blocks]


def extract_layout_engine(dot_code: str) -> str:
    """Extract layout engine from DOT code if specified.

    Looks for layout attribute in graph declaration:
    - graph [layout=neato]
    - digraph G { layout=fdp; ... }

    Args:
        dot_code: DOT diagram source code.

    Returns:
        Layout engine name or 'dot' as default.
    """
    # Look for layout= in the code
    layout_match = re.search(r'layout\s*=\s*"?(\w+)"?', dot_code, re.IGNORECASE)
    if layout_match:
        engine = layout_match.group(1).lower()
        if engine in LAYOUT_ENGINES:
            return engine
    return DEFAULT_LAYOUT


def extract_graphviz_dimensions(dot_code: str, layout: str = DEFAULT_LAYOUT) -> Tuple[Optional[float], Optional[float]]:
    """Extract logical dimensions from Graphviz DOT source using JSON output.

    Uses the -Tjson output which provides precise bounding boxes after
    layout calculation but before rasterization.

    Args:
        dot_code: DOT diagram source code.
        layout: Layout engine to use (dot, neato, fdp, etc.).

    Returns:
        Tuple of (width, height) in points (1/72 inch), or (None, None) if extraction fails.
    """
    if not is_graphviz_available():
        return None, None

    try:
        result = subprocess.run(
            [layout, '-Tjson'],
            input=dot_code,
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode != 0:
            logger.warning(f"Graphviz JSON extraction failed: {result.stderr}")
            return None, None

        data = json.loads(result.stdout)
        bb = data.get('bb', '0,0,0,0')

        # bb format is "minx,miny,maxx,maxy"
        parts = bb.split(',')
        if len(parts) >= 4:
            width = float(parts[2]) - float(parts[0])
            height = float(parts[3]) - float(parts[1])
            return width, height

    except subprocess.TimeoutExpired:
        logger.warning("Graphviz JSON extraction timed out")
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse Graphviz JSON output: {e}")
    except Exception as e:
        logger.warning(f"Graphviz dimension extraction error: {e}")

    return None, None


def render_graphviz_diagram(
    dot_code: str,
    output_path: Path,
    format: str = "png",
    dpi: int = 96,
    layout: Optional[str] = None,
    extract_dimensions: bool = False
) -> Tuple[Path, Optional[float], Optional[float]]:
    """Render a single Graphviz DOT diagram to image.

    Args:
        dot_code: DOT diagram source code.
        output_path: Path where image should be saved (extension will be adjusted).
        format: Output format - 'png' or 'svg' (default: 'png').
        dpi: Resolution for PNG output (default: 96).
        layout: Layout engine to use (auto-detected from code if not specified).
        extract_dimensions: Whether to extract logical dimensions.

    Returns:
        Tuple of (path to generated image, logical_width, logical_height).
        Dimensions are in points (1/72 inch), None if extraction fails.

    Raises:
        RuntimeError: If Graphviz is not available or rendering fails.
    """
    if not is_graphviz_available():
        raise RuntimeError(
            "Graphviz is not installed. "
            "Please install it: brew install graphviz (macOS) or apt install graphviz (Linux)"
        )

    # Determine layout engine
    if layout is None:
        layout = extract_layout_engine(dot_code)

    # Adjust output path extension based on format
    if format == "svg":
        output_path = output_path.with_suffix('.svg')
    else:
        output_path = output_path.with_suffix('.png')

    # Extract dimensions if requested
    logical_width, logical_height = None, None
    if extract_dimensions:
        logical_width, logical_height = extract_graphviz_dimensions(dot_code, layout)

    # Build rendering command
    cmd = [layout, f'-T{format}', '-o', str(output_path)]

    if format == "png":
        cmd.extend([f'-Gdpi={dpi}'])

    # Run Graphviz
    result = subprocess.run(
        cmd,
        input=dot_code,
        capture_output=True,
        text=True,
        timeout=60
    )

    if result.returncode != 0:
        raise RuntimeError(f"Failed to render Graphviz diagram: {result.stderr}")

    if not output_path.exists():
        raise RuntimeError(f"Graphviz output file not created: {output_path}")

    return output_path, logical_width, logical_height


def render_all_graphviz_diagrams(
    markdown_content: str,
    temp_dir: Path,
    format: str = "png",
    dpi: int = 96,
    extract_dimensions: bool = False
) -> Dict[str, GraphvizDiagramInfo]:
    """Extract and render all Graphviz diagrams from markdown.

    Args:
        markdown_content: Markdown text containing Graphviz diagrams.
        temp_dir: Directory to store rendered images.
        format: Output format - 'png' or 'svg' (default: 'png').
        dpi: Resolution for PNG output (default: 96).
        extract_dimensions: Whether to extract logical dimensions for consistent sizing.

    Returns:
        Dictionary mapping original DOT code to GraphvizDiagramInfo objects.
    """
    if not is_graphviz_available():
        logger.warning("Graphviz is not installed. Skipping Graphviz diagrams.")
        return {}

    blocks = extract_graphviz_blocks(markdown_content)
    diagram_map = {}

    ext = 'svg' if format == 'svg' else 'png'
    for idx, dot_code in enumerate(blocks):
        try:
            layout = extract_layout_engine(dot_code)
            output_path = temp_dir / f"graphviz_{idx}.{ext}"

            rendered_path, logical_width, logical_height = render_graphviz_diagram(
                dot_code, output_path, format=format, dpi=dpi,
                layout=layout, extract_dimensions=extract_dimensions
            )

            diagram_map[dot_code] = GraphvizDiagramInfo(
                path=rendered_path,
                code=dot_code,
                logical_width=logical_width,
                logical_height=logical_height,
                units_per_inch=72.0,  # Graphviz uses points
                layout_engine=layout
            )
        except Exception as e:
            logger.error(f"Failed to render Graphviz diagram {idx}: {e}")
            # Continue with other diagrams

    return diagram_map


def replace_graphviz_with_images(
    markdown_content: str,
    diagram_map: Dict[str, GraphvizDiagramInfo],
    relative_to: Optional[Path] = None
) -> str:
    """Replace Graphviz code blocks with image references.

    Args:
        markdown_content: Original markdown content.
        diagram_map: Mapping of DOT code to GraphvizDiagramInfo objects.
        relative_to: Optional path to make image references relative to.

    Returns:
        Modified markdown with image references instead of Graphviz blocks.
    """
    # Build list of image references in order
    image_refs = []
    for dot_code, diagram_info in diagram_map.items():
        if relative_to:
            try:
                rel_path = diagram_info.path.relative_to(relative_to)
                image_ref = f"![Graphviz Diagram]({rel_path})"
            except ValueError:
                image_ref = f"![Graphviz Diagram]({diagram_info.path.name})"
        else:
            image_ref = f"![Graphviz Diagram]({diagram_info.path})"

        image_refs.append(image_ref)

    # Replace all graphviz blocks in order
    idx = 0

    def replacer(match):
        nonlocal idx
        if idx < len(image_refs):
            result = image_refs[idx]
            idx += 1
            return result
        return match.group(0)

    # Pattern to match any graphviz block
    pattern = r'```(?:dot|graphviz)\s*\n.*?```'
    modified = re.sub(pattern, replacer, markdown_content, flags=re.DOTALL)

    return modified


def has_graphviz_blocks(content: str, format: str = 'markdown') -> bool:
    """Check if content contains Graphviz diagram blocks.

    Args:
        content: Document content to check.
        format: Content format - 'markdown' or 'asciidoc'.

    Returns:
        True if Graphviz blocks are found.
    """
    if format == 'markdown':
        return bool(re.search(r'```(?:dot|graphviz)\n', content))
    elif format == 'asciidoc':
        return bool(re.search(r'\[(?:source,)?(?:dot|graphviz)\]', content, re.IGNORECASE))
    return False
