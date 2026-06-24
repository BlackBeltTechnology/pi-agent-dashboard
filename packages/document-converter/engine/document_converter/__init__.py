"""Document Converter: Convert markdown and AsciiDoc with diagrams to DOCX."""

from .converter import convert_md_to_docx
from .mermaid_renderer import DiagramFormat, DiagramInfo, resolve_diagram_format, extract_diagram_title
from .svg_embedder import (
    is_svg_embedding_available,
    check_svg_embedding_requirements,
    convert_svg_to_png,
)
from .utils import (
    check_dependencies,
    check_all_dependencies,
    get_missing_dependencies,
    print_dependency_status,
)
from .table_formatter import format_tables, format_table, fix_table_styles_for_pdf
from .cover_page import add_cover_page, extract_title_and_description, demote_headings
from .toc_generator import add_toc

# New DOCX-to-Markdown extraction
from .docx_reader import convert_docx_to_md, extract_content

# AsciiDoc conversion
from .asciidoc_converter import (
    convert_adoc_to_docx,
    extract_docx_to_adoc,
    convert_to_docx,
    extract_from_docx,
    detect_input_format,
    check_pandoc_available,
)

# PlantUML support
from .plantuml_renderer import (
    has_plantuml_blocks,
    render_all_plantuml_diagrams,
    PlantUMLRenderError,
)
from .plantuml_server import (
    PlantUMLServer,
    PlantUMLServerError,
    get_server,
    check_docker_available,
)

# PDF conversion
from .pdf_converter import (
    convert_docx_to_pdf,
    convert_md_to_pdf,
    convert_adoc_to_pdf,
    convert_to_pdf,
    batch_convert_to_pdf,
    PDFConversionError,
    PDFOptions,
    BatchConversionResult,
    find_local_libreoffice,
)
from .pdf_server import (
    PDFServer,
    PDFServerError,
    get_server as get_pdf_server,
)

# Round-trip editing
from .round_trip import merge_md_to_docx

# Template management
from .template_extractor import (
    create_template,
    analyze_document_for_variables,
    DocumentAnalysis,
    VariableCandidate,
)
from .template_manager import (
    list_templates,
    load_template,
    replace_placeholders_in_document,
    resolve_templates_dir,
)

# Style extraction
from .style_extractor import extract_styles, extract_table_styles

# Text box extraction
from .textbox_extractor import (
    extract_textboxes_from_docx,
    replace_text_in_textbox,
)

# Variable management
from .variable_manager import (
    load_properties_file,
    save_properties_file,
    resolve_variables,
    validate_variables,
)

# Manifest management
from .manifest_manager import (
    save_manifest,
    load_manifest,
    resolve_template_name,
    save_manifest_to_both_locations,
)

# Frontmatter parsing
from .frontmatter_parser import (
    parse_yaml_frontmatter,
    parse_asciidoc_attributes,
    parse_frontmatter,
    extract_template_config,
    extract_variables,
    extract_conversion_options,
    extract_table_style,
    extract_toc_style,
    extract_image_style,
    get_known_option_keys,
    warn_unknown_keys,
    merge_with_defaults,
)

# System variables
from .system_variables import (
    resolve_system_variables,
    get_formatted_date,
    detect_toc_placeholder,
    SystemContext,
    DATE_FORMATS,
)

# Table style configuration
from .table_formatter import (
    TableStyleConfig,
    parse_table_style_block,
    apply_column_widths,
    DEFAULT_TABLE_STYLE,
)

# Table style extraction from DOCX
from .docx_reader import (
    extract_table_style as extract_docx_table_style,
    extract_table_styles as extract_all_docx_table_styles,
    extract_per_table_styles,
    calculate_column_widths,
)

# TOC style configuration
from .toc_style import (
    TocStyleConfig,
    TocLevelStyle,
    extract_toc_style,
    get_tab_leader_char,
    DEFAULT_TOC_STYLE,
)

# Image style configuration
from .image_style import (
    ImageStyleConfig,
    parse_dimension,
    calculate_dimensions,
    parse_inline_image_style,
    parse_image_style_block,
    extract_image_style,
    DEFAULT_IMAGE_STYLE,
)

# Spacing configuration
from .spacing_config import (
    SpacingConfig,
    ElementSpacing,
    extract_spacing_config,
    load_template_spacing,
    load_spacing_from_styles_xml,
    DEFAULT_SPACING,
)
from .spacing_applier import apply_spacing_to_document

# Diagram sizing
from .diagram_sizing import (
    SizingConfig,
    SizingMode,
    DiagramDimensions,
    calculate_diagram_dimensions,
    parse_sizing_config,
)
from .diagram_resizer import (
    build_diagram_size_map,
    apply_diagram_sizes,
)

# Logo management
from .logo_manager import (
    LogoConfig,
    is_logo_placeholder,
    extract_logo_from_alt_or_caption,
    remove_logo_placeholder_from_text,
    parse_logos_frontmatter,
    resolve_logo_path,
    list_template_logos,
)

# Field update (TOC generation)
from .field_updater import (
    update_docx_fields,
    update_fields_if_available,
    is_field_update_available,
    is_gotenberg_available,
    FieldUpdateError,
)

__version__ = "0.5.0"
__all__ = [
    # MD to DOCX conversion
    "convert_md_to_docx",
    # Diagram format
    "DiagramFormat",
    "resolve_diagram_format",
    # SVG embedding
    "is_svg_embedding_available",
    "check_svg_embedding_requirements",
    "convert_svg_to_png",
    # AsciiDoc conversion
    "convert_adoc_to_docx",
    "extract_docx_to_adoc",
    "convert_to_docx",
    "extract_from_docx",
    "detect_input_format",
    "check_pandoc_available",
    # PlantUML support
    "has_plantuml_blocks",
    "render_all_plantuml_diagrams",
    "PlantUMLRenderError",
    "PlantUMLServer",
    "PlantUMLServerError",
    "get_server",
    "check_docker_available",
    # PDF conversion
    "convert_docx_to_pdf",
    "convert_md_to_pdf",
    "convert_adoc_to_pdf",
    "convert_to_pdf",
    "batch_convert_to_pdf",
    "PDFConversionError",
    "PDFOptions",
    "BatchConversionResult",
    "PDFServer",
    "PDFServerError",
    "get_pdf_server",
    "find_local_libreoffice",
    # DOCX to MD extraction
    "convert_docx_to_md",
    "extract_content",
    # Round-trip editing
    "merge_md_to_docx",
    # Template management
    "create_template",
    "analyze_document_for_variables",
    "DocumentAnalysis",
    "VariableCandidate",
    "list_templates",
    "load_template",
    "replace_placeholders_in_document",
    "resolve_templates_dir",
    # Style extraction
    "extract_styles",
    "extract_table_styles",
    # Variable management
    "load_properties_file",
    "save_properties_file",
    "resolve_variables",
    "validate_variables",
    # Manifest management
    "save_manifest",
    "load_manifest",
    "resolve_template_name",
    "save_manifest_to_both_locations",
    # Utilities
    "check_dependencies",
    "check_all_dependencies",
    "get_missing_dependencies",
    "print_dependency_status",
    # Table formatting
    "format_tables",
    "format_table",
    "fix_table_styles_for_pdf",
    # Cover page
    "add_cover_page",
    "extract_title_and_description",
    "demote_headings",
    # TOC
    "add_toc",
    # Frontmatter parsing
    "parse_yaml_frontmatter",
    "parse_asciidoc_attributes",
    "parse_frontmatter",
    "extract_template_config",
    "extract_variables",
    "extract_conversion_options",
    "extract_table_style",
    "extract_toc_style",
    "extract_image_style",
    "get_known_option_keys",
    "warn_unknown_keys",
    "merge_with_defaults",
    # System variables
    "resolve_system_variables",
    "get_formatted_date",
    "detect_toc_placeholder",
    "SystemContext",
    "DATE_FORMATS",
    # Table style configuration
    "TableStyleConfig",
    "parse_table_style_block",
    "apply_column_widths",
    "DEFAULT_TABLE_STYLE",
    # Table style extraction from DOCX
    "extract_docx_table_style",
    "extract_all_docx_table_styles",
    "extract_per_table_styles",
    "calculate_column_widths",
    # TOC style configuration
    "TocStyleConfig",
    "TocLevelStyle",
    "extract_toc_style",
    "get_tab_leader_char",
    "DEFAULT_TOC_STYLE",
    # Image style configuration
    "ImageStyleConfig",
    "parse_dimension",
    "calculate_dimensions",
    "parse_inline_image_style",
    "parse_image_style_block",
    "extract_image_style",
    "DEFAULT_IMAGE_STYLE",
    # Spacing configuration
    "SpacingConfig",
    "ElementSpacing",
    "extract_spacing_config",
    "load_template_spacing",
    "load_spacing_from_styles_xml",
    "apply_spacing_to_document",
    "DEFAULT_SPACING",
    # Diagram sizing
    "SizingConfig",
    "SizingMode",
    "DiagramDimensions",
    "calculate_diagram_dimensions",
    "parse_sizing_config",
    "build_diagram_size_map",
    "apply_diagram_sizes",
    # Logo management
    "LogoConfig",
    "is_logo_placeholder",
    "extract_logo_from_alt_or_caption",
    "remove_logo_placeholder_from_text",
    "parse_logos_frontmatter",
    "resolve_logo_path",
    "list_template_logos",
    # Field update (TOC generation)
    "update_docx_fields",
    "update_fields_if_available",
    "is_field_update_available",
    "is_gotenberg_available",
    "FieldUpdateError",
]
