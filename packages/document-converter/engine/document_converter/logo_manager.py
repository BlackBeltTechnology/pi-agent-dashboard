"""Logo replacement system module.

Provides functions for detecting and replacing logo placeholders in documents.
"""
import logging
import re
import zipfile
import tempfile
import os
import shutil
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from xml.etree import ElementTree as ET

logger = logging.getLogger(__name__)


def get_image_dimensions(image_path: Path) -> Optional[Tuple[int, int]]:
    """Get width and height of an image file.

    Supports PNG, JPEG, and GIF formats.

    Args:
        image_path: Path to the image file.

    Returns:
        Tuple of (width, height) in pixels, or None if unable to determine.
    """
    if not image_path.exists():
        return None

    try:
        with open(image_path, 'rb') as f:
            header = f.read(32)

            # PNG: signature + IHDR chunk
            if header[:8] == b'\x89PNG\r\n\x1a\n':
                width = struct.unpack('>I', header[16:20])[0]
                height = struct.unpack('>I', header[20:24])[0]
                return (width, height)

            # JPEG
            if header[:2] == b'\xff\xd8':
                f.seek(0)
                f.read(2)  # Skip SOI marker
                while True:
                    marker, = struct.unpack('>H', f.read(2))
                    if marker == 0xFFD9:  # EOI
                        break
                    if marker == 0xFFDA:  # Start of scan
                        break
                    length, = struct.unpack('>H', f.read(2))
                    if marker in (0xFFC0, 0xFFC1, 0xFFC2):  # SOF markers
                        f.read(1)  # precision
                        height, width = struct.unpack('>HH', f.read(4))
                        return (width, height)
                    f.seek(length - 2, 1)
                return None

            # GIF
            if header[:6] in (b'GIF87a', b'GIF89a'):
                width, height = struct.unpack('<HH', header[6:10])
                return (width, height)

    except Exception as e:
        logger.debug(f"Could not read image dimensions from {image_path}: {e}")

    return None

# Pattern for logo placeholder in alt text
LOGO_PLACEHOLDER_PATTERN = re.compile(r'\{\{logo:([^}]+)\}\}')


@dataclass
class LogoConfig:
    """Configuration for a logo replacement.

    Attributes:
        name: The placeholder name (without {{logo:}}).
        file: Path to the logo file.
        width: Optional width for the logo.
        height: Optional height for the logo.
    """
    name: str
    file: Optional[Path] = None
    width: Optional[int] = None
    height: Optional[int] = None

    @classmethod
    def from_dict(cls, name: str, config: Any) -> 'LogoConfig':
        """Create LogoConfig from a dictionary or string.

        Args:
            name: The logo placeholder name.
            config: Either a path string or a dict with file, width, height.

        Returns:
            LogoConfig instance.
        """
        if isinstance(config, str):
            return cls(name=name, file=Path(config))
        elif isinstance(config, dict):
            file_path = config.get('file')
            return cls(
                name=name,
                file=Path(file_path) if file_path else None,
                width=config.get('width'),
                height=config.get('height'),
            )
        return cls(name=name)


def is_logo_placeholder(text: str) -> Optional[str]:
    """Check if text contains a logo placeholder.

    Args:
        text: The text to check (alt text or caption).

    Returns:
        The logo name if a placeholder is found, None otherwise.
    """
    if not text:
        return None
    match = LOGO_PLACEHOLDER_PATTERN.search(text)
    if match:
        return match.group(1)
    return None


def extract_logo_from_alt_or_caption(
    alt_text: Optional[str],
    caption: Optional[str]
) -> tuple[Optional[str], bool]:
    """Extract logo name from alt text or caption.

    Checks alt text first, then caption. Returns whether the logo
    was found in caption (to indicate caption should be removed).

    Args:
        alt_text: The image alt text.
        caption: The image caption text.

    Returns:
        Tuple of (logo_name, found_in_caption).
        logo_name is None if no placeholder found.
        found_in_caption is True if logo was detected from caption.
    """
    # Check alt text first
    logo_name = is_logo_placeholder(alt_text)
    if logo_name:
        return (logo_name, False)

    # Check caption
    logo_name = is_logo_placeholder(caption)
    if logo_name:
        return (logo_name, True)

    return (None, False)


def remove_logo_placeholder_from_text(text: str) -> str:
    """Remove logo placeholder pattern from text.

    Args:
        text: Text containing {{logo:name}} pattern.

    Returns:
        Text with logo placeholder removed and whitespace cleaned up.
    """
    if not text:
        return text

    # Remove the placeholder pattern
    cleaned = LOGO_PLACEHOLDER_PATTERN.sub('', text)

    # Clean up extra whitespace
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    return cleaned


def parse_logos_frontmatter(frontmatter: Dict[str, Any]) -> Dict[str, LogoConfig]:
    """Parse logos configuration from frontmatter.

    Args:
        frontmatter: Parsed frontmatter dictionary.

    Returns:
        Dictionary mapping logo names to LogoConfig.
    """
    logos_dict = frontmatter.get('logos', {})
    if not isinstance(logos_dict, dict):
        return {}

    result = {}
    for name, config in logos_dict.items():
        result[name] = LogoConfig.from_dict(name, config)
    return result


def extract_logos_from_markdown(markdown_content: str) -> Dict[str, LogoConfig]:
    """Extract logo mappings from markdown image syntax.

    Finds images with alt text in the format {{logo:name}} and extracts
    the logo name and image path. This allows defining logos inline:

        ![{{logo:company}}](images/logo.png)

    Args:
        markdown_content: The markdown content to parse.

    Returns:
        Dictionary mapping logo names to LogoConfig.
    """
    result = {}

    # Pattern to match ![{{logo:name}}](path) or ![{{logo:name}}](path "title")
    # Also handles spaces: ![ {{ logo:name }} ]( path )
    pattern = r'!\[\s*\{\{\s*logo:([^}]+?)\s*\}\}\s*\]\(([^)\s]+)(?:\s+"[^"]*")?\)'

    for match in re.finditer(pattern, markdown_content):
        logo_name = match.group(1).strip()
        image_path = match.group(2).strip()

        if logo_name and image_path:
            result[logo_name] = LogoConfig(
                name=logo_name,
                file=Path(image_path)
            )
            logger.debug(f"Extracted logo from markdown: {logo_name} -> {image_path}")

    return result


def merge_logo_configs(
    frontmatter_logos: Dict[str, LogoConfig],
    markdown_logos: Dict[str, LogoConfig]
) -> Dict[str, LogoConfig]:
    """Merge logo configurations from frontmatter and markdown.

    Frontmatter logos take precedence over markdown-extracted logos.

    Args:
        frontmatter_logos: Logos from frontmatter configuration.
        markdown_logos: Logos extracted from markdown image syntax.

    Returns:
        Merged dictionary of logo configurations.
    """
    # Start with markdown logos
    result = dict(markdown_logos)

    # Frontmatter overrides markdown
    result.update(frontmatter_logos)

    return result


def resolve_logo_path(
    logo_name: str,
    frontmatter_logos: Dict[str, LogoConfig],
    template_path: Optional[Path] = None,
    source_path: Optional[Path] = None,
    project_root: Optional[Path] = None
) -> Optional[Path]:
    """Resolve the file path for a logo.

    Path resolution rules:
    - Paths starting with '/' are relative to project_root
    - Other paths are relative to the source document directory
    - Absolute paths (e.g., /Users/...) are used as-is

    Search order:
    1. Frontmatter logos configuration
    2. Template logos directory
    3. Source file's images directory

    Args:
        logo_name: The logo placeholder name.
        frontmatter_logos: Logo configurations from frontmatter.
        template_path: Path to the template directory.
        source_path: Path to the source document.
        project_root: Path to the project root directory.

    Returns:
        Resolved Path to the logo file, or None if not found.
    """
    # Check frontmatter configuration
    if logo_name in frontmatter_logos:
        config = frontmatter_logos[logo_name]
        if config.file:
            file_str = str(config.file)

            # Check if it's a true absolute path (e.g., /Users/... or C:\...)
            if config.file.is_absolute() and config.file.exists():
                return config.file

            # Path starting with '/' - relative to project root
            if file_str.startswith('/') and project_root:
                # Remove leading '/' and resolve from project root
                rel_path = project_root / file_str.lstrip('/')
                if rel_path.exists():
                    return rel_path

            # Relative path - resolve from source document directory
            if source_path:
                rel_path = source_path.parent / config.file
                if rel_path.exists():
                    return rel_path

    # Common image extensions to try
    extensions = ['.png', '.jpg', '.jpeg', '.svg', '.gif']

    # Check template logos directory
    if template_path:
        logos_dir = template_path / 'logos'
        if logos_dir.exists():
            for ext in extensions:
                logo_file = logos_dir / f"{logo_name}{ext}"
                if logo_file.exists():
                    return logo_file

    # Check source images directory
    if source_path:
        images_dir = source_path.parent / 'images'
        if images_dir.exists():
            for ext in extensions:
                logo_file = images_dir / f"{logo_name}{ext}"
                if logo_file.exists():
                    return logo_file

    return None


def list_template_logos(template_path: Path) -> List[str]:
    """List available logos in a template's logos directory.

    Args:
        template_path: Path to the template directory.

    Returns:
        List of logo file names (without extension).
    """
    logos_dir = template_path / 'logos'
    if not logos_dir.exists():
        return []

    logos = []
    extensions = {'.png', '.jpg', '.jpeg', '.svg', '.gif'}

    for file in logos_dir.iterdir():
        if file.suffix.lower() in extensions:
            logos.append(file.stem)

    return sorted(logos)


def extract_logos_to_frontmatter(placeholders: List[Dict[str, Any]], images_dir: Path) -> Dict[str, Any]:
    """Generate logos frontmatter from detected placeholders.

    Args:
        placeholders: List of detected logo placeholder dictionaries.
        images_dir: Directory where images are extracted.

    Returns:
        Dictionary suitable for frontmatter logos section.
    """
    logos = {}

    for placeholder in placeholders:
        name = placeholder.get('name')
        if not name:
            continue

        # Check if logo file exists in images dir
        extensions = ['.png', '.jpg', '.jpeg', '.svg', '.gif']
        for ext in extensions:
            logo_file = images_dir / f"{name}{ext}"
            if logo_file.exists():
                logos[name] = str(logo_file.relative_to(images_dir.parent))
                break
        else:
            # Just record the placeholder name
            logos[name] = f"images/{name}.png"

    return logos


def _get_image_emu_dimensions(
    doc_xml_path: Path,
    rels_content: str,
    target_filename: str
) -> Optional[Tuple[int, int]]:
    """Get image display dimensions from document XML in EMUs.

    Args:
        doc_xml_path: Path to document.xml file.
        rels_content: Content of document.xml.rels for finding image references.
        target_filename: Filename of the target image (e.g., 'image1.png').

    Returns:
        Tuple of (width, height) in EMUs, or None if not found.
    """
    if not doc_xml_path.exists():
        return None

    content = doc_xml_path.read_text(encoding='utf-8')

    # Find the relationship ID for this image
    rel_pattern = rf'<Relationship[^>]*Target="media/{re.escape(target_filename)}"[^>]*Id="([^"]+)"'
    rel_match = re.search(rel_pattern, rels_content)
    if not rel_match:
        rel_pattern = rf'<Relationship[^>]*Id="([^"]+)"[^>]*Target="media/{re.escape(target_filename)}"'
        rel_match = re.search(rel_pattern, rels_content)

    if not rel_match:
        return None

    image_rid = rel_match.group(1)

    # Find the drawing that contains this image and get wp:extent dimensions
    drawing_pattern = rf'<w:drawing>((?:(?!</w:drawing>).)*r:embed="{image_rid}"(?:(?!</w:drawing>).)*)</w:drawing>'
    drawing_match = re.search(drawing_pattern, content, re.DOTALL)

    if not drawing_match:
        return None

    drawing_content = drawing_match.group(1)

    # Extract wp:extent cx and cy
    extent_pattern = r'<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"'
    extent_match = re.search(extent_pattern, drawing_content)

    if extent_match:
        return (int(extent_match.group(1)), int(extent_match.group(2)))

    return None


def _update_image_dimensions_in_xml(
    doc_xml_path: Path,
    rels_content: str,
    target_filename: str,
    new_width: int,
    new_height: int,
    offset_x: int,
    offset_y: int
) -> bool:
    """Update image dimensions and position in document XML.

    Finds the drawing element that references the target image and updates:
    - wp:extent cx/cy (display dimensions)
    - a:ext cx/cy (image extent)
    - wp:positionH/wp:positionV posOffset (if absolute positioning, adjust for centering)

    Args:
        doc_xml_path: Path to document.xml file.
        rels_content: Content of document.xml.rels for finding image references.
        target_filename: Filename of the target image (e.g., 'image1.png').
        new_width: New width in EMUs.
        new_height: New height in EMUs.
        offset_x: X offset in EMUs to adjust position for centering.
        offset_y: Y offset in EMUs to adjust position for centering.

    Returns:
        True if dimensions were updated, False otherwise.
    """
    if not doc_xml_path.exists():
        return False

    content = doc_xml_path.read_text(encoding='utf-8')

    # Find the relationship ID for this image
    # Pattern: Target="media/image1.png" ... Id="rId9"
    rel_pattern = rf'<Relationship[^>]*Target="media/{re.escape(target_filename)}"[^>]*Id="([^"]+)"'
    rel_match = re.search(rel_pattern, rels_content)
    if not rel_match:
        # Try alternate order
        rel_pattern = rf'<Relationship[^>]*Id="([^"]+)"[^>]*Target="media/{re.escape(target_filename)}"'
        rel_match = re.search(rel_pattern, rels_content)

    if not rel_match:
        logger.debug(f"Could not find relationship for image: {target_filename}")
        return False

    image_rid = rel_match.group(1)
    logger.debug(f"Found image relationship {image_rid} for {target_filename}")

    # Find the drawing that contains a:blip r:embed="image_rid"
    # and update its dimensions
    drawing_pattern = rf'(<w:drawing>)((?:(?!</w:drawing>).)*r:embed="{image_rid}"(?:(?!</w:drawing>).)*)(</w:drawing>)'
    drawing_match = re.search(drawing_pattern, content, re.DOTALL)

    if not drawing_match:
        logger.debug(f"Could not find drawing for image {image_rid}")
        return False

    drawing_content = drawing_match.group(2)
    modified = False

    # Update wp:extent cx="..." cy="..."
    extent_pattern = r'(<wp:extent\s+)cx="(\d+)"\s+cy="(\d+)"'
    def replace_extent(m):
        nonlocal modified
        modified = True
        return f'{m.group(1)}cx="{new_width}" cy="{new_height}"'

    new_drawing_content = re.sub(extent_pattern, replace_extent, drawing_content)

    # Update a:ext cx="..." cy="..." (inside a:xfrm)
    aext_pattern = r'(<a:ext\s+)cx="(\d+)"\s+cy="(\d+)"'
    new_drawing_content = re.sub(aext_pattern, replace_extent, new_drawing_content)

    # If absolute positioning, adjust position to keep center aligned
    if offset_x != 0 or offset_y != 0:
        # Update horizontal position offset
        def adjust_h_offset(m):
            old_offset = int(m.group(2))
            new_offset = old_offset + offset_x
            return f'{m.group(1)}<wp:posOffset>{new_offset}</wp:posOffset>'

        h_pattern = r'(<wp:positionH[^>]*>)\s*<wp:posOffset>(\d+)</wp:posOffset>'
        new_drawing_content = re.sub(h_pattern, adjust_h_offset, new_drawing_content)

        # Update vertical position offset
        def adjust_v_offset(m):
            old_offset = int(m.group(2))
            new_offset = old_offset + offset_y
            return f'{m.group(1)}<wp:posOffset>{new_offset}</wp:posOffset>'

        v_pattern = r'(<wp:positionV[^>]*>)\s*<wp:posOffset>(\d+)</wp:posOffset>'
        new_drawing_content = re.sub(v_pattern, adjust_v_offset, new_drawing_content)

    if modified:
        # Rebuild the drawing element
        new_drawing = f'{drawing_match.group(1)}{new_drawing_content}{drawing_match.group(3)}'
        new_content = content[:drawing_match.start()] + new_drawing + content[drawing_match.end():]
        doc_xml_path.write_text(new_content, encoding='utf-8')
        logger.debug(f"Updated dimensions for {target_filename}")
        return True

    return False


def _replace_fragmented_logo_placeholder(content: str, logo_name: str) -> tuple[str, bool]:
    """Replace a {{logo:name}} pattern that may be fragmented across XML elements.

    Word often splits text like {{logo:company}} into multiple <w:t> elements:
    <w:t>{{</w:t><w:t>logo:company</w:t><w:t>}}</w:t>

    This function finds such fragmented patterns and removes them.

    Args:
        content: XML content.
        logo_name: Logo name (without {{logo:}}).

    Returns:
        Tuple of (modified content, whether replacement was made).
    """
    # First try simple replacement
    simple_pattern = f'{{{{logo:{logo_name}}}}}'
    if simple_pattern in content:
        return content.replace(simple_pattern, ''), True

    # Try with spaces
    spaced_pattern = f'{{{{ logo:{logo_name} }}}}'
    if spaced_pattern in content:
        return content.replace(spaced_pattern, ''), True

    # For fragmented patterns, find <w:t> elements that together contain the pattern
    wt_pattern = r'(<w:t[^>]*>)([^<]*)(</w:t>)'

    matches = list(re.finditer(wt_pattern, content))
    if not matches:
        return content, False

    # Target patterns to look for
    targets = [
        f'{{{{logo:{logo_name}}}}}',
        f'{{{{ logo:{logo_name} }}}}',
        f'{{{{logo:{logo_name} }}}}',
        f'{{{{ logo:{logo_name}}}}}',
    ]

    result = content
    replaced = False

    for i in range(len(matches)):
        combined_text = ''
        match_indices = []

        for j in range(i, min(i + 15, len(matches))):
            combined_text += matches[j].group(2)
            match_indices.append(j)

            # Check if we found any target pattern
            found_target = None
            for target in targets:
                if target in combined_text:
                    found_target = target
                    break

            if found_target:
                # Found the pattern - replace with empty string
                pattern_start = combined_text.find(found_target)
                pattern_end = pattern_start + len(found_target)

                # Calculate which elements contain parts of the pattern
                char_pos = 0
                elements_to_modify = []
                for idx in match_indices:
                    elem_text = matches[idx].group(2)
                    elem_start = char_pos
                    elem_end = char_pos + len(elem_text)

                    if elem_end > pattern_start and elem_start < pattern_end:
                        elements_to_modify.append((idx, elem_start, elem_end))

                    char_pos = elem_end

                if elements_to_modify:
                    # Build new content, clearing text from affected elements
                    new_content_parts = []
                    last_end = 0

                    for idx, elem_start, elem_end in elements_to_modify:
                        m = matches[idx]
                        new_content_parts.append(result[last_end:m.start()])

                        # Calculate what part of this element's text to keep
                        elem_text = m.group(2)
                        keep_before = ''
                        keep_after = ''

                        if elem_start < pattern_start:
                            keep_before = elem_text[:pattern_start - elem_start]
                        if elem_end > pattern_end:
                            keep_after = elem_text[pattern_end - elem_start:]

                        # Reconstruct the element with modified text
                        new_text = keep_before + keep_after
                        new_content_parts.append(f'{m.group(1)}{new_text}{m.group(3)}')
                        last_end = m.end()

                    new_content_parts.append(result[last_end:])
                    result = ''.join(new_content_parts)
                    replaced = True
                    break

        if replaced:
            break

    return result, replaced


def _find_logo_image_and_replace_cover(
    tmp_path: Path,
    logo_name: str,
    logos: Dict[str, LogoConfig],
    source_path: Optional[Path] = None
) -> bool:
    """Find logo image and use it to replace template header/cover logo.

    This function supports two modes:
    1. Logo defined via markdown image: ![{{logo:name}}](path)
       - Finds the drawing with {{logo:name}} in alt text
       - Uses that embedded image to replace header/cover logo
       - Removes the markdown image paragraph from the body

    2. Logo defined only in frontmatter: logos: { name: "path" }
       - Resolves the logo path from frontmatter config
       - Uses that file directly to replace header/cover logo

    Args:
        tmp_path: Path to extracted DOCX directory.
        logo_name: The logo name (e.g., 'company').
        logos: Dictionary of logo configurations.
        source_path: Path to the source markdown file.

    Returns:
        True if replacement was made, False otherwise.
    """
    doc_xml_path = tmp_path / 'word' / 'document.xml'
    rels_path = tmp_path / 'word' / '_rels' / 'document.xml.rels'

    if not doc_xml_path.exists() or not rels_path.exists():
        return False

    content = doc_xml_path.read_text(encoding='utf-8')
    rels_content = rels_path.read_text(encoding='utf-8')

    # Also load header files and their relationships (logos are often in headers)
    header_contents = {}
    header_rels = {}
    for header_file in ['header1.xml', 'header2.xml', 'header3.xml']:
        header_path = tmp_path / 'word' / header_file
        header_rels_path = tmp_path / 'word' / '_rels' / f'{header_file}.rels'
        if header_path.exists():
            header_contents[header_file] = header_path.read_text(encoding='utf-8')
            if header_rels_path.exists():
                header_rels[header_file] = header_rels_path.read_text(encoding='utf-8')

    # Try to find drawing with {{logo:name}} in the descr attribute of wp:docPr
    # Pattern: <wp:docPr descr="{{logo:company}}" .../>
    # The drawing contains this docPr and also has <a:blip r:embed="rIdX"/>

    # Build patterns to match the logo placeholder in descr
    logo_patterns = [
        rf'descr="\{{\{{logo:{logo_name}\}}\}}"',
        rf'descr="\{{\{{ logo:{logo_name} \}}\}}"',
        rf"descr='\{{\{{logo:{logo_name}\}}\}}'",
    ]

    logo_drawing_match = None
    for pattern in logo_patterns:
        # Find the drawing containing this docPr
        drawing_pattern = rf'<w:drawing>((?:(?!</w:drawing>).)*{pattern}(?:(?!</w:drawing>).)*)</w:drawing>'
        logo_drawing_match = re.search(drawing_pattern, content, re.DOTALL)
        if logo_drawing_match:
            break

    drawing_full = None
    logo_image_path = None

    if logo_drawing_match:
        # Mode 1: Logo from markdown image in document
        drawing_content = logo_drawing_match.group(1)
        drawing_full = logo_drawing_match.group(0)

        # Extract the image relationship ID from the drawing
        blip_match = re.search(r'<a:blip[^>]*r:embed="([^"]+)"', drawing_content)
        if blip_match:
            logo_image_rid = blip_match.group(1)

            # Find the image file path from relationships
            rel_match = re.search(rf'<Relationship[^>]*Id="{logo_image_rid}"[^>]*Target="([^"]+)"', rels_content)
            if rel_match:
                logo_image_target = rel_match.group(1)
                logo_image_path = tmp_path / 'word' / logo_image_target
                if not logo_image_path.exists():
                    logo_image_path = None
                    logger.debug(f"Logo image file not found in DOCX: {logo_image_target}")

    if not logo_image_path:
        # Mode 2: Logo defined only in frontmatter - resolve from config
        if logo_name in logos and logos[logo_name].file:
            config = logos[logo_name]
            logo_file = config.file

            # Resolve path relative to source document
            if source_path and not logo_file.is_absolute():
                resolved_path = source_path.parent / logo_file
                if resolved_path.exists():
                    logo_image_path = resolved_path
                    logger.debug(f"Using logo from frontmatter config: {logo_image_path}")
            elif logo_file.is_absolute() and logo_file.exists():
                logo_image_path = logo_file
                logger.debug(f"Using absolute logo path: {logo_image_path}")

    if not logo_image_path:
        logger.debug(f"No logo image found for: {logo_name}")
        return False

    # Strategy: Find the template's placeholder image to replace
    # The template marks logo placeholders in several ways:
    # 1. Image with hyperlink containing {{logo:name}} or {{logo/name}} in URL
    # 2. descr attribute with {{logo:name}}
    # 3. Fallback: image1.* (first image in template)

    target_image_path = None

    # Method 1: Find hyperlink relationships with {{logo:name}} pattern
    # URL-encoded pattern: %7B%7Blogo/company%7D%7D = {{logo/company}}
    # Also support {{logo:company}} format
    logo_hyperlink_patterns = [
        # URL-encoded with slash: {{logo/name}}
        rf'<Relationship[^>]*Target="[^"]*%7B%7Blogo[/]{logo_name}%7D%7D[^"]*"[^>]*Id="([^"]+)"',
        rf'<Relationship[^>]*Id="([^"]+)"[^>]*Target="[^"]*%7B%7Blogo[/]{logo_name}%7D%7D[^"]*"',
        # URL-encoded with colon: {{logo:name}}
        rf'<Relationship[^>]*Target="[^"]*%7B%7Blogo%3A{logo_name}%7D%7D[^"]*"[^>]*Id="([^"]+)"',
        rf'<Relationship[^>]*Id="([^"]+)"[^>]*Target="[^"]*%7B%7Blogo%3A{logo_name}%7D%7D[^"]*"',
        # Non-encoded patterns (less common)
        rf'<Relationship[^>]*Target="[^"]*\{{\{{logo[/:]{logo_name}\}}\}}[^"]*"[^>]*Id="([^"]+)"',
        rf'<Relationship[^>]*Id="([^"]+)"[^>]*Target="[^"]*\{{\{{logo[/:]{logo_name}\}}\}}[^"]*"',
    ]

    hyperlink_rid = None
    for pattern in logo_hyperlink_patterns:
        match = re.search(pattern, rels_content, re.IGNORECASE)
        if match:
            hyperlink_rid = match.group(1)
            logger.debug(f"Found logo hyperlink relationship: {hyperlink_rid}")
            break

    # Find the image that has this hyperlink (via a:hlinkClick reference)
    if hyperlink_rid:
        # Find drawing with a:hlinkClick r:id="hyperlink_rid"
        hlink_pattern = rf'<w:drawing>((?:(?!</w:drawing>).)*a:hlinkClick[^>]*r:id="{hyperlink_rid}"(?:(?!</w:drawing>).)*)</w:drawing>'
        hlink_drawing = re.search(hlink_pattern, content, re.DOTALL)

        if hlink_drawing:
            drawing_content = hlink_drawing.group(1)
            # Get the image embed ID
            blip_match = re.search(r'<a:blip[^>]*r:embed="([^"]+)"', drawing_content)
            if blip_match:
                image_rid = blip_match.group(1)
                # Find the image file
                img_rel = re.search(rf'<Relationship[^>]*Id="{image_rid}"[^>]*Target="([^"]+)"', rels_content)
                if img_rel:
                    img_target = img_rel.group(1)
                    target_image_path = tmp_path / 'word' / img_target
                    if target_image_path.exists():
                        logger.debug(f"Found logo placeholder image via hyperlink: {target_image_path}")
                    else:
                        target_image_path = None

    # Fallback: search for image with {{logo:name}} in descr attribute
    if not target_image_path:
        descr_patterns = [
            rf'<w:drawing>((?:(?!</w:drawing>).)*descr="[^"]*\{{\{{logo:{logo_name}\}}\}}[^"]*"(?:(?!</w:drawing>).)*)</w:drawing>',
            rf'<w:drawing>((?:(?!</w:drawing>).)*descr="[^"]*\{{\{{ logo:{logo_name} \}}\}}[^"]*"(?:(?!</w:drawing>).)*)</w:drawing>',
        ]

        for pattern in descr_patterns:
            descr_drawing = re.search(pattern, content, re.DOTALL)
            if descr_drawing:
                drawing_content = descr_drawing.group(1)
                blip_match = re.search(r'<a:blip[^>]*r:embed="([^"]+)"', drawing_content)
                if blip_match:
                    image_rid = blip_match.group(1)
                    img_rel = re.search(rf'<Relationship[^>]*Id="{image_rid}"[^>]*Target="([^"]+)"', rels_content)
                    if img_rel:
                        img_target = img_rel.group(1)
                        target_image_path = tmp_path / 'word' / img_target
                        if target_image_path.exists():
                            logger.debug(f"Found logo placeholder image via descr: {target_image_path}")
                            break
                        else:
                            target_image_path = None

    # Fallback: Look for image1.* which is typically the template logo
    # This works because pandoc copies media files from reference-doc
    if not target_image_path:
        word_media = tmp_path / 'word' / 'media'
        if word_media.exists():
            # Look for image1 with various extensions (standard template logo location)
            for ext in ['.png', '.jpeg', '.jpg', '.gif', '.svg']:
                image1_path = word_media / f'image1{ext}'
                if image1_path.exists():
                    target_image_path = image1_path
                    logger.debug(f"Found template logo at standard location: {target_image_path}")
                    break

    if not target_image_path:
        logger.debug(f"No logo placeholder found in template for: {logo_name}")
        return False

    # Replace target image with logo image
    if logo_image_path.exists() and target_image_path and target_image_path.exists():
        # Get new image dimensions for aspect ratio calculation
        new_dims = get_image_dimensions(logo_image_path)

        # Copy the new logo over the old one
        shutil.copy2(logo_image_path, target_image_path)
        logger.info(f"Replaced template logo placeholder with: {logo_name}")

        # Adjust image dimensions in XML to preserve aspect ratio and center
        if new_dims:
            new_w, new_h = new_dims
            new_aspect = new_w / new_h if new_h > 0 else 1

            target_filename = target_image_path.name

            # Get original bounding box dimensions from XML (in EMUs)
            old_emu_dims = _get_image_emu_dimensions(doc_xml_path, rels_content, target_filename)

            if old_emu_dims:
                old_emu_w, old_emu_h = old_emu_dims

                # Calculate new dimensions that fit within original bounds while preserving aspect ratio
                # Try fitting by width first
                fit_by_width_w = old_emu_w
                fit_by_width_h = int(old_emu_w / new_aspect)

                # Try fitting by height
                fit_by_height_h = old_emu_h
                fit_by_height_w = int(old_emu_h * new_aspect)

                # Choose the one that fits within bounds
                if fit_by_width_h <= old_emu_h:
                    # Fitting by width works
                    new_display_w = fit_by_width_w
                    new_display_h = fit_by_width_h
                else:
                    # Must fit by height
                    new_display_w = fit_by_height_w
                    new_display_h = fit_by_height_h

                # Calculate position offset to keep center aligned
                # offset = (old_size - new_size) / 2
                offset_x = (old_emu_w - new_display_w) // 2
                offset_y = (old_emu_h - new_display_h) // 2

                # Update dimensions in document.xml
                _update_image_dimensions_in_xml(
                    doc_xml_path, rels_content, target_filename,
                    new_display_w, new_display_h, offset_x, offset_y
                )

                logger.debug(f"Adjusted logo: original bounds {old_emu_w}x{old_emu_h} EMUs, "
                           f"new size {new_display_w}x{new_display_h} EMUs, offset ({offset_x}, {offset_y})")

        # Only remove paragraph if logo was from a markdown image (not frontmatter-only)
        if drawing_full:
            # Remove the paragraph containing the logo image from the body
            # Find the paragraph containing the logo drawing
            para_pattern = rf'<w:p[^>]*>(?:(?!</w:p>).)*{re.escape(drawing_full)}(?:(?!</w:p>).)*</w:p>'
            new_content = re.sub(para_pattern, '', content, count=1, flags=re.DOTALL)

            # Also remove the ImageCaption paragraph that Pandoc creates
            # Pattern: <w:p>...<w:pStyle w:val="ImageCaption"/>...<w:t>{{logo:name}}</w:t>...</w:p>
            caption_patterns = [
                rf'<w:p[^>]*>(?:(?!</w:p>).)*<w:pStyle w:val="ImageCaption"/>(?:(?!</w:p>).)*\{{\{{logo:{logo_name}\}}\}}(?:(?!</w:p>).)*</w:p>',
                rf'<w:p[^>]*>(?:(?!</w:p>).)*<w:pStyle w:val="Caption"/>(?:(?!</w:p>).)*\{{\{{logo:{logo_name}\}}\}}(?:(?!</w:p>).)*</w:p>',
            ]
            for cap_pattern in caption_patterns:
                new_content = re.sub(cap_pattern, '', new_content, flags=re.DOTALL)

            doc_xml_path.write_text(new_content, encoding='utf-8')

        return True

    return False


def replace_logo_placeholders_in_docx(
    docx_path: Path,
    logos: Dict[str, LogoConfig],
    source_path: Optional[Path] = None,
    template_path: Optional[Path] = None,
    project_root: Optional[Path] = None
) -> int:
    """Replace {{logo:name}} placeholders in a DOCX with actual images.

    This function:
    1. Finds images with {{logo:name}} captions (from markdown ![{{logo:name}}](path))
    2. Uses those images to replace the template's cover page logo
    3. Removes the {{logo:name}} caption text and the body image paragraph

    Args:
        docx_path: Path to the DOCX file to modify.
        logos: Dictionary of logo configurations from frontmatter/markdown.
        source_path: Path to the source markdown file.
        template_path: Path to the template directory.
        project_root: Path to the project root directory.

    Returns:
        Number of logos replaced.
    """
    if not logos:
        return 0

    replaced_count = 0

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)

        # Extract DOCX
        with zipfile.ZipFile(docx_path, 'r') as zf:
            zf.extractall(tmp_path)

        # Process each logo - try to find image and replace cover page logo
        for logo_name, config in logos.items():
            if _find_logo_image_and_replace_cover(tmp_path, logo_name, logos, source_path):
                replaced_count += 1
            else:
                # Fall back to just removing placeholder text
                doc_xml_path = tmp_path / 'word' / 'document.xml'
                if doc_xml_path.exists():
                    content = doc_xml_path.read_text(encoding='utf-8')

                    # Loop to handle multiple occurrences
                    max_iterations = 50
                    iteration = 0

                    while iteration < max_iterations:
                        iteration += 1
                        new_content, was_replaced = _replace_fragmented_logo_placeholder(content, logo_name)

                        if was_replaced:
                            content = new_content
                            replaced_count += 1
                            logger.info(f"Removed logo placeholder: {logo_name}")
                        else:
                            break

                    doc_xml_path.write_text(content, encoding='utf-8')

                    if f'logo:{logo_name}' in content:
                        logger.warning(f"Logo placeholder pattern still present: {logo_name}")

        # Repack DOCX - ensure [Content_Types].xml is first (Word requirement)
        with zipfile.ZipFile(docx_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            # Write [Content_Types].xml first (required by OOXML spec)
            content_types = tmp_path / '[Content_Types].xml'
            if content_types.exists():
                zf.write(content_types, '[Content_Types].xml')

            # Write remaining files in sorted order
            for root_dir, dirs, files in os.walk(tmp_path):
                dirs.sort()  # Ensure consistent directory order
                for file in sorted(files):
                    if file == '[Content_Types].xml':
                        continue  # Already written
                    file_path = Path(root_dir) / file
                    arcname = file_path.relative_to(tmp_path)
                    zf.write(file_path, arcname)

    return replaced_count
