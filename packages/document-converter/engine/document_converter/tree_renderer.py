"""Tree renderer - converts ASCII tree structures to PNG images."""
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional, Tuple, Union

from PIL import Image, ImageDraw, ImageFont

from .code_renderer import DEFAULT_FONT, get_default_monospace_font


@dataclass
class TreeStyleConfig:
    """Configuration for tree rendering."""
    enabled: bool = True
    auto_detect: bool = True
    font_name: str = field(default_factory=lambda: DEFAULT_FONT)
    font_size: int = 12

    @classmethod
    def from_dict(cls, data: dict) -> "TreeStyleConfig":
        """Create config from dictionary."""
        return cls(
            enabled=data.get("enabled", True),
            auto_detect=data.get("auto_detect", True),
            font_name=data.get("font_name", DEFAULT_FONT),
            font_size=data.get("font_size", 12),
        )


@dataclass
class TreeNode:
    """Represents a node in the tree structure."""
    name: str
    children: List["TreeNode"] = field(default_factory=list)
    depth: int = 0


@dataclass
class TreeBlock:
    """Represents an extracted tree block."""
    code: str
    start_pos: int = 0
    end_pos: int = 0
    original_text: str = ""


# Unicode box-drawing characters
BOX_CHARS_UNICODE = r'[├└│─┌┐┘┬┴┼]'
# ASCII approximations
BOX_CHARS_ASCII = r'[\|+`]'


def is_ascii_tree(code: str) -> bool:
    """Detect if code block contains an ASCII tree structure.

    Uses heuristic: 5+ lines must contain box-drawing characters.

    Args:
        code: Code block content.

    Returns:
        True if code appears to be an ASCII tree.
    """
    if not code or not code.strip():
        return False

    lines = code.strip().split('\n')

    if len(lines) < 5:
        return False

    # Count lines with box-drawing characters
    tree_lines = 0
    for line in lines:
        if re.search(BOX_CHARS_UNICODE, line):
            tree_lines += 1
        elif re.search(r'[+|`].*[-|`]', line) or re.search(r'^[\s]*[+|`\\]', line):
            # ASCII approximation patterns
            tree_lines += 1

    return tree_lines >= 5


def is_tree_block(language: Optional[str]) -> bool:
    """Check if language marker indicates a tree block.

    Args:
        language: Language marker from code fence.

    Returns:
        True if marker is 'tree' or 'directory'.
    """
    if not language:
        return False

    return language.lower().strip() in ("tree", "directory")


def parse_tree(tree_text: str) -> Optional[TreeNode]:
    """Parse ASCII tree text into a tree structure.

    Args:
        tree_text: ASCII tree text.

    Returns:
        Root TreeNode, or None if parsing fails.
    """
    if not tree_text or not tree_text.strip():
        return None

    lines = tree_text.strip().split('\n')
    if not lines:
        return None

    # First line is the root
    root_name = lines[0].strip()
    # Remove any leading tree characters
    root_name = re.sub(r'^[├└│─┌┐┘┬┴┼\s+|`\\-]+', '', root_name).strip()
    if not root_name:
        root_name = lines[0].strip()

    root = TreeNode(name=root_name, depth=0)

    if len(lines) == 1:
        return root

    # Parse remaining lines
    node_stack = [(root, -1)]  # (node, indent_level)

    for line in lines[1:]:
        if not line.strip():
            continue

        # Calculate indent level by finding the position of the first non-space, non-tree char
        # Tree chars: ├ └ │ ─ + | ` \ -
        stripped = line.lstrip()
        indent = len(line) - len(stripped)

        # Find the actual name (after tree drawing chars)
        name_match = re.search(r'[├└│+|`\\─\-\s]*([\w\.\-_/]+.*?)$', stripped)
        if name_match:
            name = name_match.group(1).strip()
        else:
            name = stripped

        # Clean up the name
        name = re.sub(r'^[─\-\s]+', '', name).strip()
        if not name:
            continue

        new_node = TreeNode(name=name, depth=indent)

        # Find parent based on indent
        while node_stack and node_stack[-1][1] >= indent:
            node_stack.pop()

        if node_stack:
            parent = node_stack[-1][0]
            parent.children.append(new_node)

        node_stack.append((new_node, indent))

    return root


def render_tree_to_image(
    tree_text: str,
    output_path: Path,
    font_name: str = None,
    font_size: int = 12,
    return_dimensions: bool = False,
) -> Union[Path, Tuple[Path, int, int]]:
    """Render ASCII tree to a PNG image.

    Args:
        tree_text: ASCII tree text.
        output_path: Path for output PNG file.
        font_name: Font name for rendering.
        font_size: Font size in points.
        return_dimensions: If True, return (path, width, height).

    Returns:
        Output path, or tuple of (path, width, height) if return_dimensions=True.

    Raises:
        ValueError: If tree_text is empty.
    """
    if font_name is None:
        font_name = DEFAULT_FONT

    if not tree_text or not tree_text.strip():
        raise ValueError("Tree text cannot be empty")

    # Try to load font
    try:
        font = ImageFont.truetype(font_name, font_size)
    except OSError:
        # Fallback to platform default font
        try:
            fallback_font = get_default_monospace_font()
            font = ImageFont.truetype(fallback_font, font_size)
        except OSError:
            font = ImageFont.load_default()

    lines = tree_text.strip().split('\n')

    # Calculate dimensions
    padding = 20
    line_height = font_size + 4

    # Measure text width
    dummy_img = Image.new('RGB', (1, 1))
    draw = ImageDraw.Draw(dummy_img)

    max_width = 0
    for line in lines:
        bbox = draw.textbbox((0, 0), line, font=font)
        width = bbox[2] - bbox[0]
        max_width = max(max_width, width)

    img_width = max_width + 2 * padding
    img_height = len(lines) * line_height + 2 * padding

    # Create image
    img = Image.new('RGB', (img_width, img_height), color='white')
    draw = ImageDraw.Draw(img)

    # Draw text
    y = padding
    for line in lines:
        draw.text((padding, y), line, font=font, fill='black')
        y += line_height

    # Save
    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path, 'PNG')

    if return_dimensions:
        return output_path, img_width, img_height

    return output_path


def extract_tree_blocks(
    markdown_content: str,
    config: Optional[TreeStyleConfig] = None,
) -> List[TreeBlock]:
    """Extract tree blocks from markdown content.

    Args:
        markdown_content: Markdown text containing code blocks.
        config: Tree style configuration.

    Returns:
        List of TreeBlock objects.
    """
    if config is None:
        config = TreeStyleConfig()

    # Pattern for fenced code blocks
    pattern = r'```(\w*)\n(.*?)```'

    blocks = []
    for match in re.finditer(pattern, markdown_content, re.DOTALL):
        language = match.group(1).lower().strip()
        code = match.group(2)

        # Check if explicitly marked as tree
        if is_tree_block(language):
            blocks.append(TreeBlock(
                code=code.strip(),
                start_pos=match.start(),
                end_pos=match.end(),
                original_text=match.group(0),
            ))
        # Auto-detect trees in unmarked code blocks
        elif config.auto_detect and not language and is_ascii_tree(code):
            blocks.append(TreeBlock(
                code=code.strip(),
                start_pos=match.start(),
                end_pos=match.end(),
                original_text=match.group(0),
            ))

    return blocks


def render_all_tree_blocks(
    markdown_content: str,
    output_dir: Path,
    config: Optional[TreeStyleConfig] = None,
) -> dict:
    """Render all tree blocks in markdown to images.

    Args:
        markdown_content: Markdown text containing tree blocks.
        output_dir: Directory for output images.
        config: Tree style configuration.

    Returns:
        Dictionary mapping original tree block text to image path.
    """
    if config is None:
        config = TreeStyleConfig()

    if not config.enabled:
        return {}

    blocks = extract_tree_blocks(markdown_content, config)
    result = {}

    for i, block in enumerate(blocks):
        output_path = output_dir / f"tree_block_{i}.png"

        try:
            render_tree_to_image(
                tree_text=block.code,
                output_path=output_path,
                font_name=config.font_name,
                font_size=config.font_size,
            )
            result[block.original_text] = output_path
        except Exception as e:
            # Log error but continue with other blocks
            print(f"Warning: Failed to render tree block {i}: {e}")

    return result
