"""Main document conversion logic."""
import logging
from pathlib import Path
from typing import Any, Dict, Optional
import os
import re
import shutil

from .mermaid_renderer import (
    render_all_diagrams,
    DiagramFormat,
    resolve_diagram_format,
    generate_mermaid_config
)
from .svg_embedder import is_svg_embedding_available
from .plantuml_renderer import (
    has_plantuml_blocks,
    render_all_plantuml_diagrams,
    PlantUMLRenderError
)
from .graphviz_renderer import (
    has_graphviz_blocks,
    render_all_graphviz_diagrams,
    replace_graphviz_with_images
)
from .code_renderer import (
    CodeStyleConfig,
    extract_code_blocks,
    render_all_code_blocks
)
from .tree_renderer import (
    TreeStyleConfig,
    extract_tree_blocks,
    render_all_tree_blocks
)
from .diagram_sizing import (
    SizingConfig,
    SizingMode,
    RotationMode,
    calculate_diagram_dimensions,
    parse_sizing_config
)
from .diagram_resizer import build_diagram_size_map, apply_diagram_sizes
from .utils import validate_file, check_dependencies, create_temp_dir, cleanup_temp_files
from .template_manager import apply_template, load_template
from .font_manager import get_available_fonts, cleanup_extracted_fonts, embed_template_fonts
from .table_formatter import (
    format_tables, fix_table_styles_for_pdf, TableStyleConfig,
    parse_table_style_block, DEFAULT_TABLE_STYLE, apply_table_profiles
)
from .cover_page import extract_title_and_description, add_cover_page, demote_headings, copy_template_cover_page, normalize_heading_levels
from .toc_generator import add_toc, add_static_toc
from .toc_style import TocConfig, TocMode, TocStyleConfig, extract_toc_config
from .textbox_extractor import replace_text_in_textbox
from .frontmatter_parser import (
    parse_frontmatter,
    extract_template_config,
    extract_variables,
    extract_conversion_options,
    extract_table_style,
    extract_table_profiles,
    extract_diagram_config,
    extract_code_style,
    extract_tree_style,
    warn_unknown_keys,
    merge_with_defaults,
)
from .system_variables import (
    resolve_system_variables,
    get_system_variables,
    detect_toc_placeholder,
    SystemContext,
)
from .pandoc_styles import fix_style_references
from .logo_manager import (
    parse_logos_frontmatter,
    extract_logos_from_markdown,
    merge_logo_configs,
    replace_logo_placeholders_in_docx,
)
from .field_updater import update_fields_if_available, FieldUpdateError
from .spacing_config import SpacingConfig, extract_spacing_config, load_template_spacing
from .spacing_applier import apply_spacing_to_document

logger = logging.getLogger(__name__)


def normalize_markdown(md_content: str) -> str:
    """Normalize markdown for better pandoc/DOCX conversion.

    Handles:
    - Bullet point normalization (* to -)
    - Proper spacing around lists
    - Proper spacing around headers
    - Nested list formatting

    Args:
        md_content: Original markdown content.

    Returns:
        Normalized markdown content with proper spacing.
    """
    lines = md_content.split('\n')
    result = []

    # Regex patterns for list items
    bullet_pattern = r'^[-*]\s+'
    numbered_pattern = r'^\d+\.\s+'
    indented_bullet_pattern = r'^(\s+)[-*]\s+'
    indented_numbered_pattern = r'^(\s+)\d+\.\s+'
    any_list_pattern = r'^[-*]\s+|^\d+\.\s+|^\s+[-*]\s+|^\s+\d+\.\s+'

    for i, line in enumerate(lines):
        # Normalize bullet points: convert "* " or "*   " to "- "
        if re.match(r'^\*\s+', line):
            line = re.sub(r'^\*\s+', '- ', line)

        # Normalize nested bullets with multiple spaces
        if re.match(r'^(\s+)\*\s+', line):
            line = re.sub(r'^(\s+)\*\s+', r'\1- ', line)

        # Check if current line is any type of list item
        is_list_item = bool(re.match(any_list_pattern, line))

        # Check if current line is a top-level list item (bullet or numbered)
        is_top_level_list = bool(re.match(bullet_pattern, line) or re.match(numbered_pattern, line))

        # Add blank line before top-level list if previous line is not blank and not a list item
        if is_top_level_list and i > 0:
            prev_line = lines[i-1].strip()
            is_prev_list_item = bool(re.match(any_list_pattern, lines[i-1]))
            if prev_line and not is_prev_list_item:
                # Check if we already have a blank line in result
                if result and result[-1].strip():
                    result.append('')

        # Add blank line after list ends (when non-list, non-blank line follows list item)
        if result and not is_list_item and line.strip():
            last_line = result[-1] if result else ''
            if re.match(any_list_pattern, last_line):
                result.append('')

        # Add blank line before headers if previous line is not blank
        if re.match(r'^#{1,6}\s', line) and i > 0:
            if result and result[-1].strip():
                result.append('')

        result.append(line)

    return '\n'.join(result)


def copy_static_images(markdown_content: str, source_dir: Path, temp_dir: Path) -> None:
    """Copy static images referenced in markdown from source directory to temp directory.

    This handles relative image paths like `![alt](assets/image.png)` by copying
    the referenced images to the temp directory so pandoc can find them.

    Args:
        markdown_content: Markdown content to scan for image references.
        source_dir: Source directory where the markdown file is located.
        temp_dir: Temporary directory where images should be copied.
    """
    # Find all image references in markdown
    for img_match in re.finditer(r'!\[.*?\]\(([^)]+)\)', markdown_content):
        img_path = img_match.group(1)

        # Skip URLs
        if img_path.startswith(('http://', 'https://', 'data:')):
            continue

        # Skip already processed mermaid diagrams (diagram_X.png or just filename.png in temp)
        if img_path.startswith('diagram_') or not '/' in img_path:
            continue

        # Resolve the image path relative to source directory
        src_img = source_dir / img_path
        if src_img.exists():
            # Create subdirectory in temp if needed
            dest_img = temp_dir / img_path
            dest_img.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_img, dest_img)


def save_debug_markdown(markdown_content: str, output_path: Path) -> Path:
    """Save processed markdown for debugging purposes.

    Args:
        markdown_content: Processed markdown content.
        output_path: Path to the output DOCX file.

    Returns:
        Path to the saved debug file.
    """
    debug_path = output_path.parent / f"{output_path.stem}_debug.md"
    debug_path.write_text(markdown_content, encoding='utf-8')
    return debug_path


def replace_mermaid_with_images(markdown_content: str, diagram_map: Dict[str, Any], relative_to: Optional[Path] = None) -> str:
    """Replace Mermaid code blocks with image references.

    Args:
        markdown_content: Original markdown content.
        diagram_map: Mapping of Mermaid code to DiagramInfo objects (or legacy Path objects).
        relative_to: Optional path to make image references relative to. If None, uses absolute paths.

    Returns:
        Modified markdown with image references instead of Mermaid blocks.
        If diagram has a title in metadata, adds it as a figure caption below the image.
    """
    import re
    from .mermaid_renderer import DiagramInfo

    # Build list of image references in order
    image_refs = []
    for mermaid_code, diagram_info in diagram_map.items():
        # Handle both DiagramInfo objects and legacy Path objects
        if isinstance(diagram_info, DiagramInfo):
            image_path = diagram_info.path
            title = diagram_info.title
        else:
            # Legacy Path object
            image_path = diagram_info
            title = None

        # Use title as alt text if available, otherwise use generic "Diagram"
        alt_text = title if title else "Diagram"

        if relative_to:
            try:
                rel_path = image_path.relative_to(relative_to)
                image_ref = f"![{alt_text}]({rel_path})"
            except ValueError:
                image_ref = f"![{alt_text}]({image_path.name})"
        else:
            image_ref = f"![{alt_text}]({image_path})"

        # Note: We no longer add a separate caption since the title is now in the alt text
        # This prevents duplicate figure labels in the output

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

    # Pattern to match any mermaid block
    pattern = r'```mermaid\s*\n.*?```'
    modified = re.sub(pattern, replacer, markdown_content, flags=re.DOTALL)

    return modified


def convert_md_to_docx(
    input_path: str | Path,
    output_path: str | Path,
    config: Optional[Dict] = None,
    template_path: Optional[str | Path] = None,
    template_name: Optional[str] = None,
    templates_dir: Optional[str | Path] = None,
    document_name: Optional[str] = None,
    document_title: Optional[str] = None,
    font_name: str = "Source Sans Pro",
    fonts_dir: Optional[str | Path] = None,
    diagram_width: int = 1200,
    diagram_scale: int = 2,
    diagram_format: str | DiagramFormat = "png",
    embed_svg_in_word: bool = False,
    enable_cover_page: bool = True,
    enable_toc: bool = True,
    toc_heading: str = "Tartalomjegyzék",
    debug: bool = False,
    variables: Optional[Dict[str, str]] = None,
    embed_fonts: bool = True,
    update_fields: Optional[bool] = None,
    enable_code_render: bool = True,
    enable_tree_render: bool = True,
    code_theme: Optional[str] = None,
    code_line_numbers: bool = False
) -> None:
    """Convert markdown file with Mermaid diagrams to DOCX.

    Args:
        input_path: Path to input markdown file.
        output_path: Path to output DOCX file.
        config: Optional configuration dictionary (reserved for future use).
        template_path: Path to DOCX template file. If None, uses default template.
        template_name: Name of a template to use from templates directory.
        templates_dir: Directory containing templates (default: ./templates).
        document_name: Text to replace <document name> placeholder in template.
        document_title: Text to replace <document title> placeholder in template.
        font_name: Default font name for the document (default: "Source Sans Pro").
        fonts_dir: Path to directory containing font files. If None, uses default fonts directory.
        diagram_width: Maximum width for diagrams in pixels (default: 1200 for page fitting).
        diagram_scale: Scale factor for diagram resolution (default: 2 for high quality).
        diagram_format: Output format for diagrams - 'png', 'svg', or 'auto' (default: 'png').
            'auto' uses SVG for HTML/Markdown, PNG for DOCX.
        embed_svg_in_word: Whether to embed SVG directly in Word (experimental, default: False).
            Only applies when diagram_format is 'svg' and output is DOCX.
            Requires Word 2016+ for proper rendering.
        enable_cover_page: Whether to create a cover page from H1 title (default: True).
        enable_toc: Whether to add a Table of Contents (default: True).
        toc_heading: Heading text for the TOC (default: "Tartalomjegyzék").
        debug: Whether to save processed markdown for debugging (default: False).
        variables: Dictionary of variable names to values for template substitution.
        embed_fonts: Whether to embed fonts into the DOCX file (default: True).
            Searches template fonts directory, default fonts, and system fonts.
        update_fields: Whether to update field codes (TOC, page numbers, etc.) after
            generation. If None (default), automatically enabled when TOC is enabled.
            Requires LibreOffice to be installed. If LibreOffice is not available,
            the document is created with unpopulated fields that can be updated
            manually in Word (Ctrl+A, F9).
        enable_code_render: Whether to render code blocks as syntax-highlighted images
            (default: True). Uses Pygments for highlighting.
        enable_tree_render: Whether to render ASCII trees as images (default: True).
            Auto-detects trees with 5+ lines of box-drawing characters.
        code_theme: Pygments theme for code highlighting (default: "default").
            CLI override for frontmatter code_style.theme.
        code_line_numbers: Whether to show line numbers in code blocks (default: False).
            CLI override for frontmatter code_style.line_numbers.

    Raises:
        FileNotFoundError: If input file does not exist.
        RuntimeError: If dependencies are missing or conversion fails.
    """
    input_path = Path(input_path)
    output_path = Path(output_path)

    # Validate input file
    if not validate_file(input_path):
        raise FileNotFoundError(f"Input file does not exist or is not readable: {input_path}")

    # Check dependencies
    if not check_dependencies():
        raise RuntimeError(
            "Mermaid CLI (mmdc) is not installed. "
            "Please install it with: npm install -g @mermaid-js/mermaid-cli"
        )

    # Set up paths
    from .template_manager import load_template, resolve_templates_dir

    # Default templates directory (relative to cwd or absolute)
    resolved_templates_dir = resolve_templates_dir(templates_dir)

    # Handle named template from templates directory
    template_info = None
    if template_name:
        try:
            template_info = load_template(template_name, templates_dir)
            template_path = template_info['template_docx']
        except FileNotFoundError:
            print(f"Warning: Template '{template_name}' not found, using default template")
            template_path = None

    # Use default template if not provided
    if template_path is None:
        # Try to load 'default' template from templates directory
        default_template = resolved_templates_dir / "default" / "template.docx"
        if default_template.exists():
            template_path = default_template
        else:
            raise FileNotFoundError(
                f"Default template not found at {default_template}. "
                "Please ensure templates/default/template.docx exists."
            )
    else:
        template_path = Path(template_path)

    # Use default fonts directory if not provided
    if fonts_dir is None:
        # Try fonts from default template directory
        default_fonts = resolved_templates_dir / "default" / "fonts"
        if default_fonts.exists():
            fonts_dir = default_fonts
        else:
            fonts_dir = None  # No fonts directory available
    else:
        fonts_dir = Path(fonts_dir)

    # Source directory for resolving relative image paths
    source_dir = input_path.parent

    # Read markdown content
    markdown_content = input_path.read_text(encoding='utf-8')

    # Parse frontmatter and extract remaining content
    frontmatter, content_without_frontmatter = parse_frontmatter(markdown_content, format='markdown')

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
    fm_table_style = extract_table_style(frontmatter)
    fm_table_profiles = extract_table_profiles(frontmatter)
    fm_diagram_config = extract_diagram_config(frontmatter)
    fm_code_style = extract_code_style(frontmatter)
    fm_tree_style = extract_tree_style(frontmatter)

    # Merge frontmatter settings with function parameters (CLI takes priority)
    # Template settings: CLI > frontmatter
    if template_name is None and fm_template_config.get('template'):
        template_name = fm_template_config['template']
    if templates_dir is None and fm_template_config.get('templates_dir'):
        templates_dir = fm_template_config['templates_dir']

    # Reload template_info if template_name was set from frontmatter
    # (The initial check at line 330 ran before frontmatter was parsed)
    if template_name and template_info is None:
        try:
            template_info = load_template(template_name, resolved_templates_dir)
            template_path = Path(template_info['template_docx'])
        except FileNotFoundError:
            logger.warning(f"Template '{template_name}' not found in frontmatter, using default template")
            # template_path already set to default above

    # Conversion options: CLI > frontmatter > defaults
    # Only override if CLI value is the default
    language = frontmatter.get('language', 'en')
    if enable_cover_page and 'enable_cover_page' in fm_conversion_options:
        enable_cover_page = fm_conversion_options['enable_cover_page']
    if enable_toc and 'enable_toc' in fm_conversion_options:
        enable_toc = fm_conversion_options['enable_toc']
    if toc_heading == "Tartalomjegyzék" and 'toc_heading' in fm_conversion_options:
        toc_heading = fm_conversion_options['toc_heading']

    # Extract TOC configuration from frontmatter
    # Supports: toc.mode (static/dynamic), toc.max_level, toc.heading, toc.styles
    toc_config = extract_toc_config(frontmatter)

    # Override TOC config with frontmatter values
    if not toc_config.enabled:
        enable_toc = False
    if toc_config.heading != "Tartalomjegyzék":
        toc_heading = toc_config.heading
    if diagram_format == "png" and 'diagram_format' in fm_conversion_options:
        diagram_format = fm_conversion_options['diagram_format']
    if diagram_width == 1200 and 'diagram_width' in fm_conversion_options:
        diagram_width = fm_conversion_options['diagram_width']
    if diagram_scale == 2 and 'diagram_scale' in fm_conversion_options:
        diagram_scale = fm_conversion_options['diagram_scale']
    if not embed_svg_in_word and 'embed_svg_in_word' in fm_conversion_options:
        embed_svg_in_word = fm_conversion_options['embed_svg_in_word']
    if font_name == "Source Sans Pro" and 'font_name' in fm_conversion_options:
        font_name = fm_conversion_options['font_name']
    if embed_fonts and 'embed_fonts' in fm_conversion_options:
        embed_fonts = fm_conversion_options['embed_fonts']
    if not debug and 'debug' in fm_conversion_options:
        debug = fm_conversion_options['debug']

    # Document metadata from frontmatter
    if document_name is None:
        document_name = frontmatter.get('document_name')
    if document_title is None:
        document_title = frontmatter.get('document_title')

    # Build system context for variable resolution
    # Use output filename (.docx) instead of input filename (.md) for $fileName variable
    system_context = SystemContext(
        file_name=output_path.name,
        language=language,
        has_toc_placeholder=detect_toc_placeholder(content_without_frontmatter) is not None
    )

    # Extract template variables from frontmatter
    # Pass None to extract all variables from the 'variables' section
    fm_variables = extract_variables(frontmatter)

    # Merge variables: CLI > frontmatter
    if variables is None:
        variables = {}
    merged_variables = {**fm_variables, **variables}

    # Add system variables to merged_variables for template substitution
    # System variables use $ prefix (e.g., $date, $fileName)
    system_vars = get_system_variables(system_context)
    merged_variables.update(system_vars)

    # Resolve system variables in variable values (for nested references)
    for key, value in merged_variables.items():
        if isinstance(value, str):
            merged_variables[key] = resolve_system_variables(value, system_context)

    # Resolve system variables in content (but not {{$toc}} - handled separately)
    markdown_content = resolve_system_variables(content_without_frontmatter, system_context)

    # Normalize markdown formatting for better DOCX conversion
    markdown_content = normalize_markdown(markdown_content)

    # Check if template has its own cover page
    template_has_cover_page = template_info and template_info.get('has_cover_page', False)

    # Extract cover page info before modifying markdown
    cover_title, cover_description, should_create_cover = '', '', False
    if enable_cover_page and not template_has_cover_page:
        # Only auto-generate cover page if template doesn't have one
        cover_title, cover_description, should_create_cover = extract_title_and_description(markdown_content)
        if should_create_cover:
            # Demote headings (H2->H1, H3->H2, etc.) since H1 goes to cover page
            markdown_content = demote_headings(markdown_content)

    # Normalize heading levels if no H1 exists and demote_headings was not applied
    # This promotes all headings so the minimum level becomes H1
    # (e.g., if markdown only has H2+, H2->H1, H3->H2, etc.)
    if not should_create_cover:
        markdown_content = normalize_heading_levels(markdown_content)

    # Create temporary directory
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

        # Parse diagram sizing configuration
        sizing_config = parse_sizing_config(frontmatter)
        use_consistent_sizing = sizing_config.mode == SizingMode.CONSISTENT

        # Generate Mermaid config for consistent styling if enabled
        mermaid_config = None
        if use_consistent_sizing and fm_diagram_config:
            mermaid_opts = fm_diagram_config.get('mermaid', {})
            mermaid_font_size = mermaid_opts.get('font_size', 14)
            mermaid_config = generate_mermaid_config(font_size=mermaid_font_size)

        # Render Mermaid diagrams with size constraints for page fitting
        diagram_map = render_all_diagrams(
            markdown_content,
            temp_dir,
            width=diagram_width,
            scale=diagram_scale,
            format=actual_format,
            extract_dimensions=use_consistent_sizing,
            mermaid_config=mermaid_config
        )

        # Log sizing warnings if any diagrams have them
        if use_consistent_sizing:
            for mermaid_code, diagram_info in diagram_map.items():
                if diagram_info.logical_width and diagram_info.logical_height:
                    dims = calculate_diagram_dimensions(
                        diagram_info.logical_width,
                        diagram_info.logical_height,
                        diagram_info.units_per_inch,
                        sizing_config
                    )
                    if dims.warning:
                        logger.warning(f"Mermaid diagram: {dims.warning}")

        # Replace Mermaid blocks with image references (relative to temp_dir)
        modified_markdown = replace_mermaid_with_images(markdown_content, diagram_map, relative_to=temp_dir)

        # Track diagram info for sizing (collected from all diagram types)
        plantuml_diagrams = []
        graphviz_map = {}

        # Render PlantUML diagrams if present
        if has_plantuml_blocks(modified_markdown, format='markdown'):
            try:
                plantuml_result = render_all_plantuml_diagrams(
                    modified_markdown,
                    output_dir=temp_dir,
                    format='markdown',
                    image_format=actual_format,
                    fail_on_error=False,  # Continue even if PlantUML server unavailable
                    extract_dimensions=use_consistent_sizing
                )
                modified_markdown = plantuml_result['content']
                plantuml_diagrams = plantuml_result.get('diagrams', [])

                # Log sizing warnings for PlantUML diagrams
                if use_consistent_sizing:
                    for diagram_info in plantuml_diagrams:
                        if diagram_info.logical_width and diagram_info.logical_height:
                            dims = calculate_diagram_dimensions(
                                diagram_info.logical_width,
                                diagram_info.logical_height,
                                diagram_info.units_per_inch,
                                sizing_config
                            )
                            if dims.warning:
                                logger.warning(f"PlantUML diagram: {dims.warning}")

                if plantuml_result.get('warnings'):
                    for warning in plantuml_result['warnings']:
                        print(f"PlantUML warning: {warning}")
            except PlantUMLRenderError as e:
                print(f"PlantUML rendering skipped: {e}")

        # Render Graphviz diagrams if present
        if has_graphviz_blocks(modified_markdown, format='markdown'):
            graphviz_map = render_all_graphviz_diagrams(
                modified_markdown,
                temp_dir,
                format=actual_format,
                extract_dimensions=use_consistent_sizing
            )

            # Log sizing warnings for Graphviz diagrams
            if use_consistent_sizing:
                for dot_code, diagram_info in graphviz_map.items():
                    if diagram_info.logical_width and diagram_info.logical_height:
                        dims = calculate_diagram_dimensions(
                            diagram_info.logical_width,
                            diagram_info.logical_height,
                            diagram_info.units_per_inch,
                            sizing_config
                        )
                        if dims.warning:
                            logger.warning(f"Graphviz diagram: {dims.warning}")

            # Replace Graphviz blocks with image references
            modified_markdown = replace_graphviz_with_images(
                modified_markdown, graphviz_map, relative_to=temp_dir
            )

        # Render code blocks as syntax-highlighted images
        # Build config from frontmatter, then apply CLI overrides
        code_style_config = CodeStyleConfig.from_dict(fm_code_style) if fm_code_style else CodeStyleConfig()
        # CLI overrides
        if not enable_code_render:
            code_style_config.enabled = False
        if code_theme is not None:
            code_style_config.theme = code_theme
        if code_line_numbers:
            code_style_config.line_numbers = True

        if code_style_config.enabled:
            code_blocks = extract_code_blocks(modified_markdown)
            if code_blocks:
                code_image_map = render_all_code_blocks(
                    modified_markdown,
                    temp_dir,
                    config=code_style_config
                )
                # Replace code blocks with image references
                for original_text, image_path in code_image_map.items():
                    try:
                        rel_path = image_path.relative_to(temp_dir)
                        image_ref = f"![Code]({rel_path})"
                    except ValueError:
                        image_ref = f"![Code]({image_path.name})"
                    modified_markdown = modified_markdown.replace(original_text, image_ref)
                if code_image_map:
                    logger.info(f"Rendered {len(code_image_map)} code block(s) as images")

        # Render ASCII tree blocks as images
        # Build config from frontmatter, then apply CLI overrides
        tree_style_config = TreeStyleConfig.from_dict(fm_tree_style) if fm_tree_style else TreeStyleConfig()
        # CLI override
        if not enable_tree_render:
            tree_style_config.enabled = False

        if tree_style_config.enabled:
            tree_blocks = extract_tree_blocks(modified_markdown, tree_style_config)
            if tree_blocks:
                tree_image_map = render_all_tree_blocks(
                    modified_markdown,
                    temp_dir,
                    config=tree_style_config
                )
                # Replace tree blocks with image references
                for original_text, image_path in tree_image_map.items():
                    try:
                        rel_path = image_path.relative_to(temp_dir)
                        image_ref = f"![Tree]({rel_path})"
                    except ValueError:
                        image_ref = f"![Tree]({image_path.name})"
                    modified_markdown = modified_markdown.replace(original_text, image_ref)
                if tree_image_map:
                    logger.info(f"Rendered {len(tree_image_map)} tree block(s) as images")

        # Copy static images from source directory to temp directory
        copy_static_images(modified_markdown, source_dir, temp_dir)

        # Save debug output if requested
        if debug:
            save_debug_markdown(modified_markdown, output_path)

        # Prepare font-related arguments
        font_args = []
        available_fonts = []

        if fonts_dir and fonts_dir.exists():
            available_fonts = get_available_fonts(fonts_dir)
            if available_fonts:
                # Add font directory to resource path
                font_args.append(f'--resource-path={temp_dir}:{fonts_dir}')

        # Convert to DOCX using pypandoc for better formatting
        try:
            import pypandoc
            # Write modified markdown to temp file for pypandoc
            temp_md = temp_dir / "modified.md"
            temp_md.write_text(modified_markdown, encoding='utf-8')

            # Build pypandoc arguments
            pandoc_args = ['--standalone']

            # Add resource path
            if font_args:
                pandoc_args.extend(font_args)
            else:
                pandoc_args.append(f'--resource-path={temp_dir}')

            # Set default font if specified
            if font_name:
                pandoc_args.append(f'--variable=mainfont:{font_name}')

            # Use template as reference document if available
            if template_path.exists():
                pandoc_args.append(f'--reference-doc={template_path}')

            pypandoc.convert_file(
                str(temp_md),
                'docx',
                outputfile=str(output_path),
                extra_args=pandoc_args
            )
        except (ImportError, OSError) as e:
            # Fallback to md-to-docx if pypandoc is not available
            from md_to_docx import md_to_docx
            md_to_docx(modified_markdown, str(output_path))

        # Validate output was created
        if not output_path.exists():
            raise RuntimeError(f"Failed to create output file: {output_path}")

        # Fix missing Pandoc style definitions that cause Word corruption errors
        fix_style_references(output_path)

        # Apply consistent diagram sizing if enabled
        if use_consistent_sizing:
            # Build size map from all diagram types
            diagram_size_map = build_diagram_size_map(
                mermaid_diagrams=diagram_map,
                plantuml_diagrams=plantuml_diagrams,
                graphviz_diagrams=graphviz_map,
                sizing_config=sizing_config
            )
            if diagram_size_map:
                resized = apply_diagram_sizes(output_path, diagram_size_map)
                if resized:
                    logger.info(f"Applied consistent sizing to {resized} diagram(s)")

        # Format tables with borders, striped rows, and styled headers
        format_tables(output_path)

        # Apply table column width profiles from frontmatter
        if fm_table_profiles:
            applied = apply_table_profiles(output_path, fm_table_profiles)
            if applied:
                logger.info(f"Applied column width profiles to {applied} table(s)")

        # Fix invalid table styles that cause PDF rendering issues in LibreOffice
        fix_table_styles_for_pdf(output_path)

        # Copy template's cover page if it has one (this preserves textboxes)
        if template_has_cover_page:
            copy_template_cover_page(output_path, template_path)

        # Add TOC (insert after cover page if template has one)
        # When template has a cover page, TOC should always go AFTER the cover page
        # The {{$toc}} placeholder can be used for explicit positioning within content
        if enable_toc:
            # Always place TOC after cover page when template has one
            # This prevents TOC from appearing on the cover page
            if toc_config.mode == TocMode.STATIC:
                # Use static TOC which generates actual hyperlinked entries
                # This works correctly for PDF conversion without Word field updates
                add_static_toc(
                    output_path,
                    toc_heading=toc_heading,
                    max_level=toc_config.style.max_level,
                    add_page_break=True,
                    after_cover_page=template_has_cover_page,
                    style_config=toc_config.style
                )
            else:
                # Use dynamic TOC (Word field code)
                # Requires Word/LibreOffice to update field when opened
                add_toc(
                    output_path,
                    toc_heading=toc_heading,
                    add_page_break=True,
                    after_cover_page=template_has_cover_page,
                    style_config=toc_config.style
                )

        # Add auto-generated cover page (only if template doesn't have one)
        # Only title on cover page - content stays in body after TOC
        if should_create_cover and cover_title:
            add_cover_page(output_path, cover_title)

        # Apply template (replace placeholders in header/footer)
        if template_path.exists() and (document_name or document_title):
            apply_template(
                output_path,
                template_path,
                document_name=document_name,
                document_title=document_title
            )

        # Apply variable substitutions using XML-based approach
        # This handles fragmented text (placeholders split across multiple runs)
        # which is common in Word documents due to spell-checking, formatting, etc.
        if merged_variables:
            # Build replacements dictionary with both {{var}} and <var> syntax
            textbox_replacements = {}
            for var_name, value in merged_variables.items():
                # Replace both syntaxes with the actual value
                textbox_replacements[f'{{{{{var_name}}}}}'] = value  # {{var}}
                textbox_replacements[f'<{var_name}>'] = value  # <var> (legacy)
            if textbox_replacements:
                # replace_text_in_textbox handles document.xml, headers, footers, and textboxes
                # It also handles fragmented text across multiple <w:t> elements
                replace_text_in_textbox(output_path, output_path, textbox_replacements)

        # Replace logo placeholders with actual images
        # Parse logos from frontmatter and markdown image syntax
        # Supports both:
        #   1. Frontmatter: logos: { company: "images/logo.png" }
        #   2. Markdown: ![{{logo:company}}](images/logo.png)
        frontmatter_logos = parse_logos_frontmatter(frontmatter)
        markdown_logos = extract_logos_from_markdown(content_without_frontmatter)
        logos_config = merge_logo_configs(frontmatter_logos, markdown_logos)
        if logos_config:
            template_dir = Path(template_info['path']) if template_info and template_info.get('path') else None
            replaced = replace_logo_placeholders_in_docx(
                output_path,
                logos_config,
                source_path=input_path,
                template_path=template_dir,
                project_root=Path.cwd()
            )
            if replaced:
                logger.info(f"Replaced {replaced} logo placeholder(s)")

        # Apply spacing configuration to headings and diagrams
        # Load template spacing config if available
        template_spacing = None
        if template_info and template_info.get('path'):
            template_spacing = load_template_spacing(Path(template_info['path']))

        # Extract spacing from frontmatter (merges with defaults)
        frontmatter_spacing = extract_spacing_config(frontmatter)

        # Merge: defaults -> template -> frontmatter (frontmatter takes priority)
        if template_spacing:
            spacing_config = template_spacing.merge(frontmatter_spacing)
        else:
            spacing_config = frontmatter_spacing

        # Apply spacing to document
        apply_spacing_to_document(output_path, spacing_config)

        # Embed fonts into the DOCX file
        if embed_fonts:
            # Determine template fonts directory
            template_fonts_dir = None
            if template_info and template_info.get('path'):
                template_fonts_dir = Path(template_info['path']) / 'fonts'

            # Default fonts directory
            default_fonts_dir = resolved_templates_dir / 'default' / 'fonts'

            # Embed fonts
            embed_template_fonts(
                output_path,
                template_fonts_dir=template_fonts_dir,
                default_fonts_dir=default_fonts_dir,
                include_system=True
            )

        # Update field codes (TOC, page numbers, etc.) if requested
        # Default: auto-enable when TOC is enabled
        should_update_fields = update_fields if update_fields is not None else enable_toc
        if should_update_fields:
            fields_updated = update_fields_if_available(output_path)
            if fields_updated:
                logger.info("Field codes (TOC, page numbers) updated successfully")
            elif enable_toc:
                logger.warning(
                    "Could not update field codes automatically. "
                    "LibreOffice is required for TOC generation. "
                    "Please update fields manually in Word (Ctrl+A, F9) or install LibreOffice."
                )

    finally:
        # Clean up temporary files
        cleanup_temp_files(temp_dir)

        # Clean up extracted fonts
        if fonts_dir and fonts_dir.exists():
            cleanup_extracted_fonts(fonts_dir)
