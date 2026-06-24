"""Frontmatter parser module for extracting metadata from Markdown and AsciiDoc files.

This module provides functions to parse YAML frontmatter from Markdown files
and native attributes from AsciiDoc files, extracting template configuration,
variables, and conversion options.
"""
import logging
import re
from typing import Any, Dict, List, Set, Tuple

import yaml

logger = logging.getLogger(__name__)

# Known option keys for frontmatter
KNOWN_OPTION_KEYS: Set[str] = {
    # Template configuration
    'template',
    'templates_dir',

    # Document metadata
    'language',
    'document_name',
    'document_title',

    # Cover page options
    'enable_cover_page',

    # TOC options
    'enable_toc',
    'toc_heading',
    'toc_style',

    # Diagram options
    'diagram_format',
    'diagram_width',
    'diagram_scale',
    'embed_svg_in_word',
    'diagrams',  # New: diagram sizing configuration section

    # Code block rendering options
    'code_style',  # Code syntax highlighting configuration
    'tree_style',  # ASCII tree rendering configuration

    # Font options
    'font_name',
    'embed_fonts',

    # Styling options
    'table_style',
    'table_profiles',  # Column width profiles for different table types
    'image_style',
    'logos',

    # Debug options
    'debug',
}

# Conversion option keys (subset of known keys)
CONVERSION_OPTION_KEYS: Set[str] = {
    'enable_toc',
    'enable_cover_page',
    'toc_heading',
    'diagram_format',
    'diagram_width',
    'diagram_scale',
    'embed_svg_in_word',
    'font_name',
    'embed_fonts',
    'debug',
}

# Template configuration keys
TEMPLATE_CONFIG_KEYS: Set[str] = {
    'template',
    'templates_dir',
}


def parse_yaml_frontmatter(content: str) -> Tuple[Dict[str, Any], str]:
    """Parse YAML frontmatter from Markdown content.

    Args:
        content: The full Markdown file content.

    Returns:
        A tuple of (metadata dict, remaining content without frontmatter).
        If no frontmatter is found or parsing fails, returns ({}, original content).
    """
    if not content.startswith('---'):
        return {}, content

    # Find the closing delimiter
    lines = content.split('\n')
    end_index = None

    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == '---':
            end_index = i
            break

    if end_index is None:
        # No closing delimiter found
        return {}, content

    # Extract YAML content
    yaml_content = '\n'.join(lines[1:end_index])
    remaining_content = '\n'.join(lines[end_index + 1:])

    try:
        metadata = yaml.safe_load(yaml_content)
        if metadata is None:
            metadata = {}
        return metadata, remaining_content
    except yaml.YAMLError as e:
        logger.warning(f"Warning: Failed to parse YAML frontmatter: {e}")
        return {}, content


def parse_asciidoc_attributes(content: str) -> Tuple[Dict[str, Any], str]:
    """Parse native AsciiDoc attributes from content.

    Parses attributes in the format `:key: value` at the beginning of the file.
    Stops parsing at the first non-attribute, non-blank line.

    Args:
        content: The full AsciiDoc file content.

    Returns:
        A tuple of (metadata dict, remaining content without attributes).
    """
    lines = content.split('\n')
    metadata: Dict[str, Any] = {}
    attribute_end_index = 0

    # Regex pattern for AsciiDoc attributes
    attr_pattern = re.compile(r'^:([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$')

    for i, line in enumerate(lines):
        stripped = line.strip()

        # Empty lines are allowed between attributes
        if not stripped:
            attribute_end_index = i + 1
            continue

        match = attr_pattern.match(stripped)
        if match:
            key = match.group(1)
            value = match.group(2).strip()

            # Convert boolean-like values
            value = _convert_asciidoc_value(value)

            metadata[key] = value
            attribute_end_index = i + 1
        else:
            # First non-attribute line - stop parsing
            break

    remaining_content = '\n'.join(lines[attribute_end_index:])
    return metadata, remaining_content


def _convert_asciidoc_value(value: str) -> Any:
    """Convert AsciiDoc attribute value to appropriate Python type.

    Args:
        value: The string value from an AsciiDoc attribute.

    Returns:
        The converted value (bool, int, float, or original string).
    """
    lower_value = value.lower()

    # Boolean conversion
    if lower_value in ('true', 'yes'):
        return True
    if lower_value in ('false', 'no'):
        return False

    # Integer conversion
    try:
        return int(value)
    except ValueError:
        pass

    # Float conversion
    try:
        return float(value)
    except ValueError:
        pass

    return value


def parse_frontmatter(content: str, format: str = 'markdown') -> Tuple[Dict[str, Any], str]:
    """Parse frontmatter from content based on format.

    Automatically detects YAML frontmatter (starting with ---) even in AsciiDoc files.

    Args:
        content: The full file content.
        format: The file format ('markdown' or 'asciidoc').

    Returns:
        A tuple of (metadata dict, remaining content without frontmatter).
    """
    # YAML frontmatter takes precedence (even in AsciiDoc files)
    if content.startswith('---'):
        return parse_yaml_frontmatter(content)

    # For AsciiDoc, try native attributes
    if format.lower() in ('asciidoc', 'adoc'):
        return parse_asciidoc_attributes(content)

    # For Markdown without YAML frontmatter, return empty
    return {}, content


def extract_template_config(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract template configuration from metadata.

    Args:
        metadata: The parsed frontmatter metadata.

    Returns:
        Dictionary containing only template configuration keys.
    """
    return {k: v for k, v in metadata.items() if k in TEMPLATE_CONFIG_KEYS}


def extract_variables(metadata: Dict[str, Any], known_vars: List[str] = None) -> Dict[str, str]:
    """Extract template variables from metadata.

    Extracts variables from:
    1. The nested 'variables' section (preferred)
    2. Top-level keys that are in known_vars and not system option keys

    Args:
        metadata: The parsed frontmatter metadata.
        known_vars: Optional list of known template variable names.

    Returns:
        Dictionary of variable name to value mappings.
    """
    result = {}

    # First, extract from nested 'variables' section (preferred method)
    variables_section = metadata.get('variables', {})
    if isinstance(variables_section, dict):
        for key, value in variables_section.items():
            if value is not None:
                result[key] = str(value) if not isinstance(value, str) else value

    # Then, extract top-level keys (for backward compatibility)
    known_set = set(known_vars) if known_vars else set()
    for key, value in metadata.items():
        # Skip system option keys and special sections
        if key in KNOWN_OPTION_KEYS or key in ('variables', 'logos', 'table_style', 'table_profiles', 'toc', 'images'):
            continue
        # Only include if it's a known variable (when known_vars provided)
        if known_vars is None or key in known_set:
            if key not in result:  # Don't override variables section
                result[key] = str(value) if not isinstance(value, str) else value

    return result


def extract_conversion_options(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract conversion options from metadata.

    Args:
        metadata: The parsed frontmatter metadata.

    Returns:
        Dictionary containing only conversion option keys.
    """
    return {k: v for k, v in metadata.items() if k in CONVERSION_OPTION_KEYS}


def extract_table_style(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract table style configuration from metadata.

    Args:
        metadata: The parsed frontmatter metadata.

    Returns:
        Dictionary containing table style options, or empty dict if not present.
    """
    return metadata.get('table_style', {})


def extract_table_profiles(metadata: Dict[str, Any]) -> Dict[str, Dict[str, float]]:
    """Extract table column width profiles from metadata.

    Table profiles define column width multipliers for different table types,
    identified by their header columns. When a table's headers match a profile,
    the corresponding column widths are applied.

    Example frontmatter:
        table_profiles:
          attributes:
            columns: ["Név", "Típus", "Leírás", "Kötelező"]
            widths: [1.0, 0.7, 2.5, 0.5]
          operations:
            columns: ["Művelet", "Leírás", "Állapotátmenet"]
            widths: [1.0, 2.0, 1.5]

    Args:
        metadata: The parsed frontmatter metadata.

    Returns:
        Dictionary mapping profile names to column width dicts.
        Each profile is a dict mapping column header text to width multiplier.
    """
    profiles_raw = metadata.get('table_profiles', {})
    profiles: Dict[str, Dict[str, float]] = {}

    if not isinstance(profiles_raw, dict):
        return profiles

    for profile_name, profile_data in profiles_raw.items():
        if not isinstance(profile_data, dict):
            continue

        columns = profile_data.get('columns', [])
        widths = profile_data.get('widths', [])

        if not columns or not widths or len(columns) != len(widths):
            logger.warning(f"Invalid table profile '{profile_name}': columns and widths must match")
            continue

        # Build column -> width mapping
        profile_widths: Dict[str, float] = {}
        for col, width in zip(columns, widths):
            try:
                profile_widths[str(col)] = float(width)
            except (ValueError, TypeError):
                logger.warning(f"Invalid width value in profile '{profile_name}': {width}")
                continue

        if profile_widths:
            profiles[profile_name] = profile_widths

    return profiles


def extract_toc_style(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract TOC style configuration from metadata.

    Args:
        metadata: The parsed frontmatter metadata.

    Returns:
        Dictionary containing TOC style options, or empty dict if not present.
    """
    return metadata.get('toc_style', {})


def extract_image_style(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract image style configuration from metadata.

    Args:
        metadata: The parsed frontmatter metadata.

    Returns:
        Dictionary containing image style options, or empty dict if not present.
    """
    return metadata.get('image_style', {})


def get_known_option_keys() -> Set[str]:
    """Get the set of known option keys.

    Returns:
        Set of all known frontmatter option keys.
    """
    return KNOWN_OPTION_KEYS.copy()


def warn_unknown_keys(metadata: Dict[str, Any], known_vars: List[str]) -> None:
    """Log warnings for unknown keys in metadata.

    Args:
        metadata: The parsed frontmatter metadata.
        known_vars: List of known template variable names.
    """
    known_set = KNOWN_OPTION_KEYS | set(known_vars)

    for key in metadata.keys():
        if key not in known_set:
            logger.warning(f"Unknown frontmatter key: '{key}'")


def merge_with_defaults(frontmatter: Dict[str, Any], defaults: Dict[str, Any]) -> Dict[str, Any]:
    """Merge frontmatter values with defaults.

    Frontmatter values take priority over defaults. Nested dictionaries
    are merged recursively.

    Args:
        frontmatter: The parsed frontmatter metadata.
        defaults: Default values to use for missing keys.

    Returns:
        Merged dictionary with frontmatter taking priority.
    """
    result = defaults.copy()

    for key, value in frontmatter.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            # Recursive merge for nested dicts
            result[key] = _merge_dicts(result[key], value)
        else:
            result[key] = value

    return result


def _merge_dicts(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merge two dictionaries.

    Args:
        base: The base dictionary (defaults).
        override: The override dictionary (takes priority).

    Returns:
        Merged dictionary.
    """
    result = base.copy()

    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _merge_dicts(result[key], value)
        else:
            result[key] = value

    return result


def extract_code_style(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract code block styling configuration from metadata.

    Parses the 'code_style' section in frontmatter which controls how code
    blocks are rendered as syntax-highlighted images using Pygments.

    Expected frontmatter format:
    ```yaml
    code_style:
      enabled: true       # Enable code block rendering (default: true)
      theme: default      # Pygments theme name (default: "default")
      font_name: Menlo    # Monospace font for code (platform-specific default)
      font_size: 12       # Font size in points (default: 12)
      line_numbers: false # Show line numbers (default: false)
    ```

    Args:
        metadata: The parsed frontmatter metadata.

    Returns:
        Dictionary containing code style configuration options.
    """
    code_style = metadata.get('code_style', {})
    if not isinstance(code_style, dict):
        return {}

    result: Dict[str, Any] = {}

    # Extract enabled flag
    enabled = code_style.get('enabled')
    if enabled is not None:
        result['enabled'] = bool(enabled)

    # Extract theme
    theme = code_style.get('theme')
    if theme is not None:
        result['theme'] = str(theme)

    # Extract font_name
    font_name = code_style.get('font_name')
    if font_name is not None:
        result['font_name'] = str(font_name)

    # Extract font_size
    font_size = code_style.get('font_size')
    if font_size is not None:
        try:
            result['font_size'] = int(font_size)
        except (TypeError, ValueError):
            logger.warning(f"Invalid font_size value: {font_size}")

    # Extract line_numbers
    line_numbers = code_style.get('line_numbers')
    if line_numbers is not None:
        result['line_numbers'] = bool(line_numbers)

    return result


def extract_tree_style(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract ASCII tree styling configuration from metadata.

    Parses the 'tree_style' section in frontmatter which controls how ASCII
    trees are detected and rendered as images using Pillow.

    Expected frontmatter format:
    ```yaml
    tree_style:
      enabled: true       # Enable tree rendering (default: true)
      auto_detect: true   # Auto-detect trees in unmarked code blocks (default: true)
      font_name: Menlo    # Monospace font for trees (platform-specific default)
      font_size: 12       # Font size in points (default: 12)
    ```

    Args:
        metadata: The parsed frontmatter metadata.

    Returns:
        Dictionary containing tree style configuration options.
    """
    tree_style = metadata.get('tree_style', {})
    if not isinstance(tree_style, dict):
        return {}

    result: Dict[str, Any] = {}

    # Extract enabled flag
    enabled = tree_style.get('enabled')
    if enabled is not None:
        result['enabled'] = bool(enabled)

    # Extract auto_detect
    auto_detect = tree_style.get('auto_detect')
    if auto_detect is not None:
        result['auto_detect'] = bool(auto_detect)

    # Extract font_name
    font_name = tree_style.get('font_name')
    if font_name is not None:
        result['font_name'] = str(font_name)

    # Extract font_size
    font_size = tree_style.get('font_size')
    if font_size is not None:
        try:
            result['font_size'] = int(font_size)
        except (TypeError, ValueError):
            logger.warning(f"Invalid font_size value: {font_size}")

    return result


def extract_diagram_config(metadata: Dict[str, Any]) -> Dict[str, Any]:
    """Extract diagram sizing configuration from metadata.

    Parses the 'diagrams' section in frontmatter which controls how diagrams
    are sized for consistent visual scaling across different diagram tools
    (Mermaid, PlantUML, Graphviz).

    Expected frontmatter format:
    ```yaml
    diagrams:
      sizing: consistent  # or fixed, auto
      min_scale: 0.3      # minimum scale factor (30%)
      rotation: warn      # or auto, none
      page_width: 6.5     # available width in inches
      page_height: 9.0    # available height in inches
      mermaid:
        font_size: 14     # standardized font size
      plantuml:
        font_size: 14
      graphviz:
        font_size: 14
    ```

    Args:
        metadata: The parsed frontmatter metadata.

    Returns:
        Dictionary containing diagram configuration options.
        Keys:
        - sizing: 'consistent', 'fixed', or 'auto'
        - min_scale: float (0.0-1.0)
        - rotation: 'warn', 'auto', or 'none'
        - page_width: float (inches)
        - page_height: float (inches)
        - mermaid: dict with tool-specific config
        - plantuml: dict with tool-specific config
        - graphviz: dict with tool-specific config
    """
    diagrams = metadata.get('diagrams', {})
    if not isinstance(diagrams, dict):
        return {}

    result: Dict[str, Any] = {}

    # Extract sizing mode
    sizing = diagrams.get('sizing')
    if sizing in ('consistent', 'fixed', 'auto'):
        result['sizing'] = sizing

    # Extract min_scale
    min_scale = diagrams.get('min_scale')
    if min_scale is not None:
        try:
            result['min_scale'] = float(min_scale)
        except (TypeError, ValueError):
            logger.warning(f"Invalid min_scale value: {min_scale}")

    # Extract rotation mode
    rotation = diagrams.get('rotation')
    if rotation in ('warn', 'auto', 'none'):
        result['rotation'] = rotation

    # Extract page dimensions
    for dim_key in ('page_width', 'page_height'):
        dim_value = diagrams.get(dim_key)
        if dim_value is not None:
            try:
                result[dim_key] = float(dim_value)
            except (TypeError, ValueError):
                logger.warning(f"Invalid {dim_key} value: {dim_value}")

    # Extract tool-specific configurations
    for tool in ('mermaid', 'plantuml', 'graphviz'):
        tool_config = diagrams.get(tool)
        if isinstance(tool_config, dict):
            tool_result = {}
            # Extract font_size
            font_size = tool_config.get('font_size')
            if font_size is not None:
                try:
                    tool_result['font_size'] = int(font_size)
                except (TypeError, ValueError):
                    logger.warning(f"Invalid font_size for {tool}: {font_size}")
            # Extract other tool-specific options as-is
            for key, value in tool_config.items():
                if key != 'font_size':
                    tool_result[key] = value
            if tool_result:
                result[tool] = tool_result

    return result
