"""Variable management for document conversion with properties file support.

DEPRECATED: Properties file support is deprecated. Use YAML frontmatter instead.
This module will be removed in a future version.
"""
import logging
import warnings
from pathlib import Path
from typing import Dict, Optional, List, Any
from xml.etree import ElementTree as ET
import re

logger = logging.getLogger(__name__)

# Deprecation message
DEPRECATION_MESSAGE = (
    "Properties file support is deprecated. "
    "Please migrate to YAML frontmatter in your source files. "
    "Properties files will be removed in a future version."
)


def get_properties_path(document_path: Path) -> Path:
    """Get the properties file path for a document.

    Args:
        document_path: Path to the Markdown or DOCX file.

    Returns:
        Path to the corresponding _variables.properties file.
    """
    return document_path.parent / f"{document_path.stem}_variables.properties"


def parse_properties(content: str) -> Dict[str, str]:
    """Parse a properties file content into a dictionary.

    Handles:
    - Key=value pairs
    - Comments starting with # or !
    - Continuation lines with backslash
    - Unicode escapes
    - UTF-8 encoding

    Args:
        content: Properties file content as string.

    Returns:
        Dictionary of variable name to value.
    """
    variables = {}
    lines = content.split('\n')
    i = 0

    while i < len(lines):
        line = lines[i].strip()

        # Skip empty lines and comments
        if not line or line.startswith('#') or line.startswith('!'):
            i += 1
            continue

        # Handle continuation lines
        full_line = line
        while full_line.endswith('\\') and i + 1 < len(lines):
            full_line = full_line[:-1]  # Remove backslash
            i += 1
            full_line += lines[i].strip()

        # Parse key=value or key:value
        match = re.match(r'^([^=:]+)[=:](.*)$', full_line)
        if match:
            key = match.group(1).strip()
            value = match.group(2).strip()

            # Handle unicode escapes like \uXXXX
            value = decode_unicode_escapes(value)

            variables[key] = value

        i += 1

    return variables


def decode_unicode_escapes(s: str) -> str:
    """Decode unicode escape sequences in a string.

    Args:
        s: String potentially containing \\uXXXX escapes.

    Returns:
        String with unicode escapes decoded.
    """
    def replace_unicode(match):
        return chr(int(match.group(1), 16))

    return re.sub(r'\\u([0-9a-fA-F]{4})', replace_unicode, s)


def encode_unicode_escapes(s: str) -> str:
    """Encode non-ASCII characters as unicode escapes.

    Args:
        s: String to encode.

    Returns:
        String with non-ASCII chars as \\uXXXX.
    """
    result = []
    for char in s:
        if ord(char) > 127:
            result.append(f'\\u{ord(char):04x}')
        else:
            result.append(char)
    return ''.join(result)


def format_properties(variables: Dict[str, str], header_comment: Optional[str] = None) -> str:
    """Format a dictionary as properties file content.

    Args:
        variables: Dictionary of variable name to value.
        header_comment: Optional comment to add at the top.

    Returns:
        Properties file content as string.
    """
    lines = []

    if header_comment:
        for line in header_comment.split('\n'):
            lines.append(f"# {line}")
        lines.append("")

    for key, value in sorted(variables.items()):
        # Escape special characters in value
        escaped_value = value.replace('\\', '\\\\')
        lines.append(f"{key}={escaped_value}")

    return '\n'.join(lines) + '\n'


def load_properties_file(properties_path: Path) -> Dict[str, str]:
    """Load variables from a properties file.

    DEPRECATED: Use YAML frontmatter instead.

    Args:
        properties_path: Path to the properties file.

    Returns:
        Dictionary of variable name to value.
        Empty dict if file doesn't exist.
    """
    warnings.warn(DEPRECATION_MESSAGE, DeprecationWarning, stacklevel=2)
    logger.warning(DEPRECATION_MESSAGE)

    if not properties_path.exists():
        return {}

    content = properties_path.read_text(encoding='utf-8')
    return parse_properties(content)


def save_properties_file(
    properties_path: Path,
    variables: Dict[str, str],
    document_name: Optional[str] = None
) -> None:
    """Save variables to a properties file.

    DEPRECATED: Use YAML frontmatter instead.

    Args:
        properties_path: Path to the properties file.
        variables: Dictionary of variable name to value.
        document_name: Optional document name for header comment.
    """
    warnings.warn(DEPRECATION_MESSAGE, DeprecationWarning, stacklevel=2)
    logger.warning(DEPRECATION_MESSAGE)

    header = f"Variables for {document_name}" if document_name else "Document variables"
    content = format_properties(variables, header)
    properties_path.parent.mkdir(parents=True, exist_ok=True)
    properties_path.write_text(content, encoding='utf-8')


def load_template_variables(template_dir: Path) -> Dict[str, Dict[str, Any]]:
    """Load variable definitions from a template's variables.xml.

    Args:
        template_dir: Path to the template directory.

    Returns:
        Dictionary of variable name to variable info (default, description).
    """
    variables_path = template_dir / 'variables.xml'
    if not variables_path.exists():
        return {}

    tree = ET.parse(variables_path)
    root = tree.getroot()

    variables = {}
    for var_elem in root.findall('variable'):
        name = var_elem.get('name', '')
        if not name:
            continue

        var_info = {
            'name': name,
            'default': '',
            'description': ''
        }

        default_elem = var_elem.find('default')
        if default_elem is not None and default_elem.text:
            var_info['default'] = default_elem.text

        desc_elem = var_elem.find('description')
        if desc_elem is not None and desc_elem.text:
            var_info['description'] = desc_elem.text

        variables[name] = var_info

    return variables


def get_missing_variables(
    required: Dict[str, Dict[str, Any]],
    provided: Dict[str, str]
) -> List[Dict[str, Any]]:
    """Identify variables that are required but not provided.

    Args:
        required: Dictionary of required variables from template.
        provided: Dictionary of provided variable values.

    Returns:
        List of missing variable info dicts.
    """
    missing = []
    for name, info in required.items():
        if name not in provided:
            missing.append(info)
    return missing


def validate_variables(
    template_dir: Path,
    provided: Dict[str, str]
) -> Dict[str, Any]:
    """Validate provided variables against template requirements.

    Args:
        template_dir: Path to the template directory.
        provided: Dictionary of provided variable values.

    Returns:
        Dictionary with 'valid', 'missing', and 'extra' keys.
    """
    required = load_template_variables(template_dir)

    missing = get_missing_variables(required, provided)
    extra = [k for k in provided if k not in required]

    return {
        'valid': len(missing) == 0,
        'missing': missing,
        'extra': extra,
        'required': required
    }


def prompt_for_variable(var_info: Dict[str, Any]) -> str:
    """Prompt user for a variable value interactively.

    Args:
        var_info: Variable info dict with name, default, description.

    Returns:
        User-provided value.
    """
    name = var_info.get('name', 'unknown')
    default = var_info.get('default', '')
    description = var_info.get('description', '')

    prompt_text = f"  {name}"
    if description:
        prompt_text += f" ({description})"
    if default:
        prompt_text += f" [{default}]"
    prompt_text += ": "

    value = input(prompt_text).strip()
    return value if value else default


def prompt_all_missing(
    missing: List[Dict[str, Any]],
    existing: Dict[str, str]
) -> Dict[str, str]:
    """Prompt user for all missing variable values.

    Args:
        missing: List of missing variable info dicts.
        existing: Existing variable values to merge with.

    Returns:
        Complete dictionary of all variable values.
    """
    result = dict(existing)

    if missing:
        print("\nTemplate requires additional variables:")
        for var_info in missing:
            value = prompt_for_variable(var_info)
            result[var_info['name']] = value

    return result


def get_defaults_for_missing(
    missing: List[Dict[str, Any]],
    existing: Dict[str, str]
) -> Dict[str, str]:
    """Get default values for missing variables (non-interactive mode).

    Args:
        missing: List of missing variable info dicts.
        existing: Existing variable values to merge with.

    Returns:
        Complete dictionary with defaults for missing variables.
    """
    result = dict(existing)

    for var_info in missing:
        result[var_info['name']] = var_info.get('default', '')

    return result


def resolve_variables(
    template_dir: Path,
    properties_path: Path,
    interactive: bool = True,
    provided: Optional[Dict[str, str]] = None
) -> Dict[str, str]:
    """Resolve all variables for a conversion, prompting if needed.

    Args:
        template_dir: Path to the template directory.
        properties_path: Path to the properties file.
        interactive: Whether to prompt for missing variables.
        provided: Optional dictionary of already-provided variables (e.g., from frontmatter).

    Returns:
        Complete dictionary of all variable values.
    """
    # Load provided variables from properties file, merge with any already provided
    file_vars = load_properties_file(properties_path)
    if provided is None:
        provided = file_vars
    else:
        # Merge: provided (frontmatter) takes priority over file vars
        provided = {**file_vars, **provided}

    # Validate against template requirements
    validation = validate_variables(template_dir, provided)

    if validation['valid']:
        return provided

    # Handle missing variables
    missing = validation['missing']

    if interactive:
        result = prompt_all_missing(missing, provided)
        # Save updated variables back to properties file
        save_properties_file(
            properties_path,
            result,
            properties_path.stem.replace('_variables', '')
        )
        return result
    else:
        # Non-interactive: use defaults
        print("\nUsing default values for missing variables:")
        for var_info in missing:
            default = var_info.get('default', '')
            print(f"  {var_info['name']}: \"{default}\" (default)")
        return get_defaults_for_missing(missing, provided)
