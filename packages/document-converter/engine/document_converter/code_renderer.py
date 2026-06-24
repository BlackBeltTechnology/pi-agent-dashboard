"""Code block renderer - converts code to syntax-highlighted PNG images using Pygments."""
import platform
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple, Union

from pygments import highlight
from pygments.lexers import get_lexer_by_name, guess_lexer, TextLexer
from pygments.formatters import ImageFormatter
from pygments.styles import get_all_styles, get_style_by_name
from pygments.util import ClassNotFound
from PIL import Image, ImageFont


# Platform-specific monospace font preferences
MONOSPACE_FONTS_BY_PLATFORM = {
    "darwin": ["Menlo", "Monaco", "SF Mono", "Courier New", "Courier"],
    "linux": ["DejaVu Sans Mono", "Liberation Mono", "Ubuntu Mono", "Courier New", "Courier"],
    "windows": ["Consolas", "Courier New", "Lucida Console", "Courier"],
}

# Fallback fonts for any platform
FALLBACK_FONTS = ["Courier New", "Courier", "monospace"]


def get_default_monospace_font() -> str:
    """Get the default monospace font for the current platform.

    Returns:
        Font name that should be available on the current platform.
    """
    system = platform.system().lower()

    # Get platform-specific fonts
    fonts = MONOSPACE_FONTS_BY_PLATFORM.get(system, FALLBACK_FONTS)

    # Try to find an available font
    for font_name in fonts:
        if _is_font_available(font_name):
            return font_name

    # Return first preference even if we can't verify availability
    return fonts[0] if fonts else "Courier"


def _is_font_available(font_name: str) -> bool:
    """Check if a font is available on the system.

    Args:
        font_name: Name of the font to check.

    Returns:
        True if font appears to be available.
    """
    try:
        # Try to load font using PIL
        ImageFont.truetype(font_name, 12)
        return True
    except (OSError, IOError):
        pass

    # Check common font paths by platform
    system = platform.system().lower()

    if system == "darwin":
        font_dirs = [
            Path("/System/Library/Fonts"),
            Path("/Library/Fonts"),
            Path.home() / "Library/Fonts",
        ]
    elif system == "linux":
        font_dirs = [
            Path("/usr/share/fonts"),
            Path("/usr/local/share/fonts"),
            Path.home() / ".fonts",
            Path.home() / ".local/share/fonts",
        ]
    elif system == "windows":
        font_dirs = [
            Path("C:/Windows/Fonts"),
        ]
    else:
        return False

    # Simple check - look for files containing font name
    font_name_lower = font_name.lower().replace(" ", "")
    for font_dir in font_dirs:
        if font_dir.exists():
            for font_file in font_dir.rglob("*"):
                if font_name_lower in font_file.stem.lower().replace(" ", ""):
                    return True

    return False


# Default font determined at module load time
DEFAULT_FONT = get_default_monospace_font()


@dataclass
class CodeStyleConfig:
    """Configuration for code block rendering."""
    enabled: bool = True
    theme: str = "default"
    font_name: str = field(default_factory=lambda: DEFAULT_FONT)
    font_size: int = 12
    line_numbers: bool = False

    @classmethod
    def from_dict(cls, data: dict) -> "CodeStyleConfig":
        """Create config from dictionary."""
        return cls(
            enabled=data.get("enabled", True),
            theme=data.get("theme", "default"),
            font_name=data.get("font_name", DEFAULT_FONT),
            font_size=data.get("font_size", 12),
            line_numbers=data.get("line_numbers", False),
        )


@dataclass
class CodeBlock:
    """Represents an extracted code block."""
    code: str
    language: str
    start_pos: int = 0
    end_pos: int = 0
    original_text: str = ""


# Language aliases mapping
LANGUAGE_ALIASES = {
    # Python
    "py": "python",
    "python3": "python",
    # JavaScript
    "js": "javascript",
    "node": "javascript",
    # TypeScript
    "ts": "typescript",
    # Shell
    "sh": "bash",
    "shell": "bash",
    "zsh": "bash",
    # YAML
    "yml": "yaml",
    # C++
    "c++": "cpp",
    # C#
    "cs": "csharp",
    "c#": "csharp",
    # Ruby
    "rb": "ruby",
    # Kotlin
    "kt": "kotlin",
    # Markdown
    "md": "markdown",
}

# Languages to exclude (handled by other renderers)
EXCLUDED_LANGUAGES = {"mermaid", "plantuml", "tree", "directory", "graphviz", "dot"}


def detect_language(marker: Optional[str]) -> str:
    """Detect language from fenced code block marker.

    Args:
        marker: Language marker from code fence (e.g., 'python', 'js')

    Returns:
        Normalized language name, or 'text' for unknown/empty markers.
    """
    if not marker:
        return "text"

    marker = marker.lower().strip()

    if not marker:
        return "text"

    # Check aliases first
    if marker in LANGUAGE_ALIASES:
        return LANGUAGE_ALIASES[marker]

    # Try to get lexer to verify language exists
    try:
        get_lexer_by_name(marker)
        return marker
    except ClassNotFound:
        return "text"


def get_available_themes() -> List[str]:
    """Get list of available Pygments themes.

    Returns:
        List of theme names.
    """
    return list(get_all_styles())


def render_code_to_image(
    code: str,
    output_path: Path,
    language: str = "text",
    theme: str = "default",
    font_name: str = None,
    font_size: int = 12,
    line_numbers: bool = False,
    return_dimensions: bool = False,
) -> Union[Path, Tuple[Path, int, int]]:
    """Render code to a syntax-highlighted PNG image.

    Args:
        code: Source code to render.
        output_path: Path for output PNG file.
        language: Programming language for syntax highlighting.
        theme: Pygments theme name.
        font_name: Font name for rendering.
        font_size: Font size in points.
        line_numbers: Whether to show line numbers.
        return_dimensions: If True, return (path, width, height).

    Returns:
        Output path, or tuple of (path, width, height) if return_dimensions=True.

    Raises:
        ValueError: If code is empty or theme is invalid.
    """
    if font_name is None:
        font_name = DEFAULT_FONT

    if not code or not code.strip():
        raise ValueError("Code cannot be empty")

    # Validate theme
    available_themes = get_available_themes()
    if theme not in available_themes:
        raise ValueError(f"Invalid theme '{theme}'. Available themes: {', '.join(sorted(available_themes)[:10])}...")

    # Get lexer
    try:
        lexer = get_lexer_by_name(language)
    except ClassNotFound:
        lexer = TextLexer()

    # Get style
    style = get_style_by_name(theme)

    # Create formatter
    formatter = ImageFormatter(
        style=style,
        font_name=font_name,
        font_size=font_size,
        line_numbers=line_numbers,
        image_pad=10,
        line_pad=2,
    )

    # Render
    result = highlight(code, lexer, formatter)

    # Write to file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(result)

    if return_dimensions:
        with Image.open(output_path) as img:
            width, height = img.size
        return output_path, width, height

    return output_path


def extract_code_blocks(markdown_content: str) -> List[CodeBlock]:
    """Extract code blocks from markdown content.

    Excludes blocks handled by other renderers (mermaid, plantuml, tree, etc.).

    Args:
        markdown_content: Markdown text containing code blocks.

    Returns:
        List of CodeBlock objects.
    """
    # Pattern for fenced code blocks: ```language\ncode\n```
    pattern = r'```(\w*)\n(.*?)```'

    blocks = []
    for match in re.finditer(pattern, markdown_content, re.DOTALL):
        language = match.group(1).lower().strip()
        code = match.group(2)

        # Skip blocks handled by other renderers
        if language in EXCLUDED_LANGUAGES:
            continue

        blocks.append(CodeBlock(
            code=code.strip(),
            language=language,
            start_pos=match.start(),
            end_pos=match.end(),
            original_text=match.group(0),
        ))

    return blocks


def render_all_code_blocks(
    markdown_content: str,
    output_dir: Path,
    config: Optional[CodeStyleConfig] = None,
) -> dict:
    """Render all code blocks in markdown to images.

    Args:
        markdown_content: Markdown text containing code blocks.
        output_dir: Directory for output images.
        config: Code style configuration.

    Returns:
        Dictionary mapping original code block text to image path.
    """
    if config is None:
        config = CodeStyleConfig()

    if not config.enabled:
        return {}

    blocks = extract_code_blocks(markdown_content)
    result = {}

    for i, block in enumerate(blocks):
        output_path = output_dir / f"code_block_{i}.png"

        # Detect language
        language = detect_language(block.language) if block.language else "text"

        try:
            render_code_to_image(
                code=block.code,
                output_path=output_path,
                language=language,
                theme=config.theme,
                font_name=config.font_name,
                font_size=config.font_size,
                line_numbers=config.line_numbers,
            )
            result[block.original_text] = output_path
        except Exception as e:
            # Log error but continue with other blocks
            print(f"Warning: Failed to render code block {i}: {e}")

    return result
