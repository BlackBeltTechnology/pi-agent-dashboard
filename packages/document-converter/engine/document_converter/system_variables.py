"""System variables module for resolving runtime variables in documents.

This module provides functionality to resolve system variables like {{$date}},
{{$fileName}}, {{$year}}, {{$month}}, {{$day}}, and {{$toc}} in document content
and template variable values.
"""
import re
from dataclasses import dataclass, field
from datetime import date
from typing import Callable, Dict, Optional

# Month names for different languages
MONTH_NAMES: Dict[str, list] = {
    'en': ['January', 'February', 'March', 'April', 'May', 'June',
           'July', 'August', 'September', 'October', 'November', 'December'],
    'hu': ['januar', 'februar', 'marcius', 'aprilis', 'majus', 'junius',
           'julius', 'augusztus', 'szeptember', 'oktober', 'november', 'december'],
    'de': ['Januar', 'Februar', 'Marz', 'April', 'Mai', 'Juni',
           'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
    'fr': ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
           'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'],
}


def _format_date_en(d: date) -> str:
    """Format date in English style: January 22, 2026."""
    month_name = MONTH_NAMES['en'][d.month - 1]
    return f"{month_name} {d.day}, {d.year}"


def _format_date_hu(d: date) -> str:
    """Format date in Hungarian style: 2026. januar 22."""
    month_name = MONTH_NAMES['hu'][d.month - 1]
    return f"{d.year}. {month_name} {d.day}."


def _format_date_de(d: date) -> str:
    """Format date in German style: 22. Januar 2026."""
    month_name = MONTH_NAMES['de'][d.month - 1]
    return f"{d.day}. {month_name} {d.year}"


def _format_date_fr(d: date) -> str:
    """Format date in French style: 22 janvier 2026."""
    month_name = MONTH_NAMES['fr'][d.month - 1]
    return f"{d.day} {month_name} {d.year}"


# Date format functions per language
DATE_FORMATS: Dict[str, Callable[[date], str]] = {
    'en': _format_date_en,
    'hu': _format_date_hu,
    'de': _format_date_de,
    'fr': _format_date_fr,
}


@dataclass
class SystemContext:
    """Context for resolving system variables.

    Attributes:
        file_name: The output file name (e.g., 'document.docx').
                   Note: This should be the output filename, not the input filename,
                   so that {{$fileName}} resolves to the final document name.
        language: The language code for date formatting (e.g., 'en', 'hu').
        has_toc_placeholder: Whether the document contains a {{$toc}} placeholder.
    """
    file_name: str
    language: str = 'en'
    has_toc_placeholder: bool = False


def get_formatted_date(language: str) -> str:
    """Get today's date formatted for the specified language.

    Args:
        language: ISO 639-1 language code (e.g., 'en', 'hu', 'de', 'fr').

    Returns:
        Formatted date string according to the language conventions.
        Falls back to English format for unknown languages.
    """
    formatter = DATE_FORMATS.get(language, DATE_FORMATS['en'])
    return formatter(date.today())


def detect_toc_placeholder(content: str) -> Optional[int]:
    """Detect the position of {{$toc}} placeholder in content.

    Args:
        content: The document content to search.

    Returns:
        The character position of the first {{$toc}} placeholder,
        or None if not found.
    """
    match = re.search(r'\{\{\$toc\}\}', content)
    if match:
        return match.start()
    return None


def get_system_variables(context: SystemContext) -> dict:
    """Get system variables as a dictionary.

    Returns a dictionary mapping system variable names (without $) to their values.
    This is useful for adding system variables to template replacements.

    Args:
        context: SystemContext with file name and language.

    Returns:
        Dictionary mapping variable names to values.
    """
    today = date.today()

    return {
        '$date': get_formatted_date(context.language),
        '$fileName': context.file_name,
        '$year': str(today.year),
        '$month': f"{today.month:02d}",
        '$day': f"{today.day:02d}",
    }


def resolve_system_variables(text: str, context: SystemContext) -> str:
    """Resolve system variables in text.

    Replaces system variables with their runtime values:
    - {{$date}}: Current date formatted for the document language
    - {{$fileName}}: Source file name
    - {{$year}}: Current year (4 digits)
    - {{$month}}: Current month (2 digits, zero-padded)
    - {{$day}}: Current day (2 digits, zero-padded)
    - {{$toc}}: Preserved for later processing

    Args:
        text: The text containing system variables.
        context: SystemContext with file name and language.

    Returns:
        Text with system variables replaced by their values.
    """
    # Get system variables
    sys_vars = get_system_variables(context)

    # Build replacements with {{$var}} syntax
    replacements = {f'{{{{{k}}}}}': v for k, v in sys_vars.items()}

    result = text
    for variable, value in replacements.items():
        result = result.replace(variable, value)

    # Note: {{$toc}} is intentionally NOT replaced here
    # It's preserved for later processing by the TOC generator

    return result
