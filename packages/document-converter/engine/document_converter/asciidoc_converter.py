"""AsciiDoc document conversion logic.

Provides bidirectional conversion between AsciiDoc and DOCX formats,
including support for Mermaid and PlantUML diagrams.
"""
import logging
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pypandoc

from .mermaid_renderer import render_all_diagrams, DiagramFormat, resolve_diagram_format
from .svg_embedder import is_svg_embedding_available
from .plantuml_renderer import (
    has_plantuml_blocks,
    render_all_plantuml_diagrams,
    PlantUMLRenderError
)
from .utils import create_temp_dir, cleanup_temp_files
from .frontmatter_parser import (
    parse_frontmatter,
    extract_template_config,
    extract_variables,
    extract_conversion_options,
    extract_table_style,
    warn_unknown_keys,
)
from .system_variables import (
    resolve_system_variables,
    detect_toc_placeholder,
    SystemContext,
)

logger = logging.getLogger(__name__)


# Regex patterns for Mermaid blocks in AsciiDoc
MERMAID_ASCIIDOC_PATTERN = re.compile(
    r'\[(source,)?mermaid\]\s*\n----\s*\n(.*?)----',
    re.DOTALL
)


def check_pandoc_available() -> bool:
    """Check if pandoc is available.

    Returns:
        True if pandoc is installed and accessible.
    """
    try:
        result = subprocess.run(
            ['pandoc', '--version'],
            capture_output=True,
            timeout=10
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def detect_input_format(file_path: Path) -> Optional[str]:
    """Detect input format based on file extension.

    Args:
        file_path: Path to the input file.

    Returns:
        Format string ('asciidoc', 'markdown') or None if unknown.
    """
    ext = file_path.suffix.lower()

    if ext in ('.adoc', '.asciidoc', '.asc'):
        return 'asciidoc'
    elif ext in ('.md', '.markdown'):
        return 'markdown'
    else:
        return None


def extract_mermaid_blocks_adoc(content: str) -> List[str]:
    """Extract Mermaid diagram blocks from AsciiDoc content.

    Supports both [source,mermaid] and [mermaid] block syntaxes.

    Args:
        content: AsciiDoc content.

    Returns:
        List of Mermaid diagram code strings.
    """
    matches = MERMAID_ASCIIDOC_PATTERN.findall(content)
    # Each match is a tuple (source_prefix, diagram_code)
    return [match[1].strip() for match in matches]


def has_mermaid_blocks_adoc(content: str) -> bool:
    """Check if AsciiDoc content contains Mermaid blocks.

    Args:
        content: AsciiDoc content.

    Returns:
        True if Mermaid blocks are found.
    """
    return bool(MERMAID_ASCIIDOC_PATTERN.search(content))


def replace_mermaid_with_images_adoc(
    content: str,
    diagram_map: Dict[str, Path],
    relative_to: Optional[Path] = None
) -> str:
    """Replace Mermaid blocks in AsciiDoc with image references.

    Args:
        content: AsciiDoc content with Mermaid blocks.
        diagram_map: Mapping of Mermaid code to image paths.
        relative_to: Optional path to make image references relative to.

    Returns:
        Modified AsciiDoc with image macros instead of Mermaid blocks.
    """
    # Build list of image references in order
    image_refs = []
    for mermaid_code, image_path in diagram_map.items():
        if relative_to:
            try:
                rel_path = image_path.relative_to(relative_to)
                image_ref = f"image::{rel_path}[Diagram]"
            except ValueError:
                image_ref = f"image::{image_path.name}[Diagram]"
        else:
            image_ref = f"image::{image_path.name}[Diagram]"
        image_refs.append(image_ref)

    # Replace all mermaid blocks in order
    idx = 0

    def replacer(match):
        nonlocal idx
        if idx < len(image_refs):
            result = image_refs[idx]
            idx += 1
            return result
        return match.group(0)

    modified = MERMAID_ASCIIDOC_PATTERN.sub(replacer, content)
    return modified


def render_mermaid_diagrams_adoc(
    content: str,
    temp_dir: Path,
    width: int = 1200,
    scale: int = 2,
    format: str = "png"
) -> Tuple[str, Dict[str, Path]]:
    """Render Mermaid diagrams in AsciiDoc content.

    Args:
        content: AsciiDoc content with Mermaid blocks.
        temp_dir: Temporary directory for output images.
        width: Maximum width for diagrams in pixels.
        scale: Scale factor for diagram resolution.
        format: Output format - 'png' or 'svg' (default: 'png').

    Returns:
        Tuple of (modified content, diagram map).
    """
    if not has_mermaid_blocks_adoc(content):
        return content, {}

    # Extract blocks and render
    blocks = extract_mermaid_blocks_adoc(content)
    diagram_map = render_all_diagrams(content, temp_dir, width=width, scale=scale, format=format)

    # Replace blocks with images
    modified = replace_mermaid_with_images_adoc(content, diagram_map, relative_to=temp_dir)
    return modified, diagram_map


def convert_adoc_to_docx(
    input_path: str | Path,
    output_path: str | Path,
    template_path: Optional[str | Path] = None,
    template_name: Optional[str] = None,
    templates_dir: Optional[str | Path] = None,
    enable_toc: bool = True,
    toc_heading: str = "Table of Contents",
    diagram_width: int = 1200,
    diagram_scale: int = 2,
    diagram_format: str | DiagramFormat = "png",
    embed_svg_in_word: bool = False,
    debug: bool = False,
    variables: Optional[Dict[str, str]] = None
) -> None:
    """Convert AsciiDoc file to DOCX.

    Args:
        input_path: Path to input AsciiDoc file.
        output_path: Path to output DOCX file.
        template_path: Optional path to DOCX template for styling.
        template_name: Name of a template to use from templates directory.
        templates_dir: Directory containing templates.
        enable_toc: Whether to include a Table of Contents.
        toc_heading: Heading text for the TOC.
        diagram_width: Maximum width for diagrams in pixels.
        diagram_scale: Scale factor for diagram resolution.
        diagram_format: Output format for diagrams - 'png', 'svg', or 'auto' (default: 'png').
        embed_svg_in_word: Whether to embed SVG directly in Word (experimental, default: False).
        debug: Whether to save intermediate files for debugging.
        variables: Dictionary of variable names to values for template substitution.

    Raises:
        FileNotFoundError: If input file does not exist.
        RuntimeError: If pandoc is not available or conversion fails.
    """
    input_path = Path(input_path)
    output_path = Path(output_path)

    # Validate input file
    if not input_path.exists():
        raise FileNotFoundError(f"Input file does not exist: {input_path}")

    # Check pandoc availability
    if not check_pandoc_available():
        raise RuntimeError(
            "Pandoc is not installed. "
            "Please install it: brew install pandoc (macOS) or apt install pandoc (Linux)"
        )

    # Read AsciiDoc content
    adoc_content = input_path.read_text(encoding='utf-8')

    # Parse frontmatter (supports both YAML frontmatter and AsciiDoc native attributes)
    frontmatter, content_without_frontmatter = parse_frontmatter(adoc_content, format='asciidoc')

    # Check for deprecated properties file
    properties_file = input_path.with_suffix('.properties')
    if properties_file.exists():
        logger.warning(
            f"Deprecated: Properties file '{properties_file.name}' found. "
            "Please migrate to YAML frontmatter. Properties files will be removed in a future version."
        )

    # Extract configuration from frontmatter
    fm_template_config = extract_template_config(frontmatter)
    fm_conversion_options = extract_conversion_options(frontmatter)

    # Merge frontmatter settings with function parameters (CLI takes priority)
    # Template settings: CLI > frontmatter
    if template_name is None and fm_template_config.get('template'):
        template_name = fm_template_config['template']
    if templates_dir is None and fm_template_config.get('templates_dir'):
        templates_dir = fm_template_config['templates_dir']

    # Conversion options: CLI > frontmatter > defaults
    language = frontmatter.get('language', 'en')
    if enable_toc and 'enable_toc' in fm_conversion_options:
        enable_toc = fm_conversion_options['enable_toc']
    if toc_heading == "Table of Contents" and 'toc_heading' in fm_conversion_options:
        toc_heading = fm_conversion_options['toc_heading']
    if diagram_format == "png" and 'diagram_format' in fm_conversion_options:
        diagram_format = fm_conversion_options['diagram_format']
    if diagram_width == 1200 and 'diagram_width' in fm_conversion_options:
        diagram_width = fm_conversion_options['diagram_width']
    if diagram_scale == 2 and 'diagram_scale' in fm_conversion_options:
        diagram_scale = fm_conversion_options['diagram_scale']
    if not embed_svg_in_word and 'embed_svg_in_word' in fm_conversion_options:
        embed_svg_in_word = fm_conversion_options['embed_svg_in_word']
    if not debug and 'debug' in fm_conversion_options:
        debug = fm_conversion_options['debug']

    # Build system context for variable resolution
    # Use output filename (.docx) instead of input filename (.adoc/.md) for $fileName variable
    system_context = SystemContext(
        file_name=output_path.name,
        language=language,
        has_toc_placeholder=detect_toc_placeholder(content_without_frontmatter) is not None
    )

    # Extract template variables from frontmatter
    known_vars = list(frontmatter.keys())
    fm_variables = extract_variables(frontmatter, known_vars)

    # Warn about unknown keys
    warn_unknown_keys(frontmatter, known_vars)

    # Merge variables: CLI > frontmatter
    if variables is None:
        variables = {}
    merged_variables = {**fm_variables, **variables}

    # Resolve system variables in variable values
    for key, value in merged_variables.items():
        if isinstance(value, str):
            merged_variables[key] = resolve_system_variables(value, system_context)

    # Resolve system variables in content
    adoc_content = resolve_system_variables(content_without_frontmatter, system_context)

    # Create temporary directory for diagrams
    temp_dir = create_temp_dir()

    try:
        # Resolve diagram format
        if isinstance(diagram_format, str):
            diagram_format_enum = DiagramFormat(diagram_format)
        else:
            diagram_format_enum = diagram_format

        # Determine actual format based on output type
        output_suffix = output_path.suffix
        actual_format = resolve_diagram_format(output_suffix, diagram_format_enum)

        # For DOCX output with SVG, check if we need to fall back to PNG
        if output_suffix.lower() == '.docx' and actual_format == 'svg':
            if not embed_svg_in_word:
                # User wants SVG but not embedding in Word - fall back to PNG for compatibility
                actual_format = 'png'
            elif not is_svg_embedding_available():
                # User requested SVG embedding but python-docx-ng is not installed
                print("Warning: SVG embedding in Word requires python-docx-ng. "
                      "Install with: pip install python-docx-ng")
                print("Falling back to PNG format for diagrams.")
                actual_format = 'png'

        # Render Mermaid diagrams
        modified_content, diagram_map = render_mermaid_diagrams_adoc(
            adoc_content,
            temp_dir,
            width=diagram_width,
            scale=diagram_scale,
            format=actual_format
        )

        # Render PlantUML diagrams if present
        if has_plantuml_blocks(modified_content, format='asciidoc'):
            try:
                plantuml_result = render_all_plantuml_diagrams(
                    modified_content,
                    output_dir=temp_dir,
                    format='asciidoc',
                    image_format=actual_format,
                    fail_on_error=False
                )
                modified_content = plantuml_result['content']
                if plantuml_result.get('warnings'):
                    for warning in plantuml_result['warnings']:
                        print(f"PlantUML warning: {warning}")
            except PlantUMLRenderError as e:
                print(f"PlantUML rendering skipped: {e}")

        # Save modified content to temp file
        temp_adoc = temp_dir / "modified.adoc"
        temp_adoc.write_text(modified_content, encoding='utf-8')

        if debug:
            debug_path = output_path.parent / f"{output_path.stem}_debug.adoc"
            shutil.copy2(temp_adoc, debug_path)

        # Build pandoc arguments
        pandoc_args = ['--standalone']

        # Add resource path for images
        pandoc_args.append(f'--resource-path={temp_dir}:{input_path.parent}')

        # Add TOC if enabled
        if enable_toc:
            pandoc_args.append('--toc')
            pandoc_args.append(f'--toc-depth=3')

        # Use template as reference document if available
        if template_path:
            template_path = Path(template_path)
            if template_path.exists():
                pandoc_args.append(f'--reference-doc={template_path}')

        # Convert using pypandoc
        pypandoc.convert_file(
            str(temp_adoc),
            'docx',
            format='asciidoc',
            outputfile=str(output_path),
            extra_args=pandoc_args
        )

        # Validate output was created
        if not output_path.exists():
            raise RuntimeError(f"Failed to create output file: {output_path}")

    finally:
        cleanup_temp_files(temp_dir)


def extract_docx_to_adoc(
    input_path: str | Path,
    output_path: str | Path,
    extract_images: bool = True,
    images_dir: Optional[str | Path] = None
) -> None:
    """Extract content from DOCX to AsciiDoc format.

    Args:
        input_path: Path to input DOCX file.
        output_path: Path to output AsciiDoc file.
        extract_images: Whether to extract embedded images.
        images_dir: Directory for extracted images (default: same as output).

    Raises:
        FileNotFoundError: If input file does not exist.
        RuntimeError: If pandoc is not available or extraction fails.
    """
    input_path = Path(input_path)
    output_path = Path(output_path)

    # Validate input file
    if not input_path.exists():
        raise FileNotFoundError(f"Input file does not exist: {input_path}")

    # Check pandoc availability
    if not check_pandoc_available():
        raise RuntimeError(
            "Pandoc is not installed. "
            "Please install it: brew install pandoc (macOS) or apt install pandoc (Linux)"
        )

    # Determine images directory
    if images_dir is None:
        images_dir = output_path.parent / "images"
    else:
        images_dir = Path(images_dir)

    # Build pandoc arguments
    pandoc_args = ['--standalone']

    if extract_images:
        images_dir.mkdir(parents=True, exist_ok=True)
        pandoc_args.append(f'--extract-media={images_dir}')

    # Convert using pypandoc
    adoc_content = pypandoc.convert_file(
        str(input_path),
        'asciidoc',
        to='asciidoc',
        extra_args=pandoc_args
    )

    # Write output file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(adoc_content, encoding='utf-8')


def convert_to_docx(
    input_path: str | Path,
    output_path: str | Path,
    template_path: Optional[str | Path] = None,
    **kwargs
) -> None:
    """Convert document to DOCX with automatic format detection.

    Detects input format based on file extension and uses the appropriate
    converter (Markdown or AsciiDoc).

    Args:
        input_path: Path to input file (.md, .markdown, .adoc, .asciidoc, .asc).
        output_path: Path to output DOCX file.
        template_path: Optional path to DOCX template for styling.
        **kwargs: Additional arguments passed to the specific converter.

    Raises:
        FileNotFoundError: If input file does not exist.
        ValueError: If input format cannot be detected.
        RuntimeError: If conversion fails.
    """
    input_path = Path(input_path)

    # Detect format
    format_type = detect_input_format(input_path)

    if format_type is None:
        raise ValueError(
            f"Cannot detect format for file: {input_path}. "
            "Supported extensions: .md, .markdown, .adoc, .asciidoc, .asc"
        )

    if format_type == 'asciidoc':
        convert_adoc_to_docx(input_path, output_path, template_path=template_path, **kwargs)
    else:
        # Use the existing Markdown converter
        from .converter import convert_md_to_docx
        convert_md_to_docx(input_path, output_path, template_path=template_path, **kwargs)


def extract_from_docx(
    input_path: str | Path,
    output_path: str | Path,
    **kwargs
) -> None:
    """Extract content from DOCX with automatic format detection.

    Detects output format based on file extension and uses the appropriate
    extractor (Markdown or AsciiDoc).

    Args:
        input_path: Path to input DOCX file.
        output_path: Path to output file (.md, .markdown, .adoc, .asciidoc, .asc).
        **kwargs: Additional arguments passed to the specific extractor.

    Raises:
        FileNotFoundError: If input file does not exist.
        ValueError: If output format cannot be detected.
        RuntimeError: If extraction fails.
    """
    output_path = Path(output_path)

    # Detect format from output path
    format_type = detect_input_format(output_path)

    if format_type is None:
        raise ValueError(
            f"Cannot detect format for output file: {output_path}. "
            "Supported extensions: .md, .markdown, .adoc, .asciidoc, .asc"
        )

    if format_type == 'asciidoc':
        extract_docx_to_adoc(input_path, output_path, **kwargs)
    else:
        # Use the existing Markdown extractor
        from .docx_reader import extract_docx_to_markdown
        extract_docx_to_markdown(input_path, output_path, **kwargs)
