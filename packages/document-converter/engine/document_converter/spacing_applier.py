"""Apply spacing configuration to DOCX documents.

Modifies paragraph spacing for headings, diagrams, and other elements
based on configuration from frontmatter or template.
"""
import zipfile
import tempfile
import logging
from pathlib import Path
from typing import Optional

try:
    from lxml import etree as ET
    USING_LXML = True
except ImportError:
    from xml.etree import ElementTree as ET
    USING_LXML = False

from .spacing_config import SpacingConfig, ElementSpacing, DEFAULT_SPACING

logger = logging.getLogger(__name__)

# Word namespaces
NAMESPACES = {
    'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'pic': 'http://schemas.openxmlformats.org/drawingml/2006/picture',
    'v': 'urn:schemas-microsoft-com:vml',
    'o': 'urn:schemas-microsoft-com:office:office',
    'm': 'http://schemas.openxmlformats.org/officeDocument/2006/math',
    'w10': 'urn:schemas-microsoft-com:office:word',
}

W_NS = NAMESPACES['w']
W_PREFIX = '{' + W_NS + '}'

# Register all namespaces for ElementTree
if not USING_LXML:
    for prefix, uri in NAMESPACES.items():
        ET.register_namespace(prefix, uri)


def points_to_twips(points: int) -> int:
    """Convert points to twips (1 point = 20 twips)."""
    return points * 20


def apply_spacing_to_element(pPr, spacing: ElementSpacing) -> None:
    """Apply spacing configuration to a paragraph properties element.

    Args:
        pPr: The w:pPr element to modify.
        spacing: ElementSpacing configuration.
    """
    if spacing.before is None and spacing.after is None and spacing.line is None:
        return

    # Find or create w:spacing element
    if USING_LXML:
        spacing_elem = pPr.find('w:spacing', NAMESPACES)
    else:
        spacing_elem = pPr.find(f'{W_PREFIX}spacing')

    if spacing_elem is None:
        if USING_LXML:
            spacing_elem = ET.SubElement(pPr, f'{{{W_NS}}}spacing')
        else:
            spacing_elem = ET.SubElement(pPr, f'{W_PREFIX}spacing')

    # Apply spacing values (in twips)
    if spacing.before is not None:
        spacing_elem.set(f'{{{W_NS}}}before', str(points_to_twips(spacing.before)))
    if spacing.after is not None:
        spacing_elem.set(f'{{{W_NS}}}after', str(points_to_twips(spacing.after)))
    if spacing.line is not None:
        # Line spacing: 240 = single line, 360 = 1.5 lines, 480 = double
        spacing_elem.set(f'{{{W_NS}}}line', str(int(spacing.line * 240)))
        spacing_elem.set(f'{{{W_NS}}}lineRule', 'auto')


def get_heading_level(para) -> Optional[int]:
    """Get heading level from paragraph style.

    Args:
        para: The w:p element.

    Returns:
        Heading level (1-6) or None if not a heading.
    """
    if USING_LXML:
        pPr = para.find('w:pPr', NAMESPACES)
    else:
        pPr = para.find(f'{W_PREFIX}pPr')

    if pPr is None:
        return None

    if USING_LXML:
        pStyle = pPr.find('w:pStyle', NAMESPACES)
    else:
        pStyle = pPr.find(f'{W_PREFIX}pStyle')

    if pStyle is None:
        return None

    style_val = pStyle.get(f'{{{W_NS}}}val', '')

    # Check for Heading 1, Heading 2, etc.
    if style_val.startswith('Heading'):
        try:
            level = int(style_val.replace('Heading', '').strip())
            if 1 <= level <= 6:
                return level
        except ValueError:
            pass

    # Check for Heading1, Heading2, etc. (no space)
    for i in range(1, 7):
        if style_val == f'Heading{i}':
            return i

    return None


def is_diagram_paragraph(para) -> bool:
    """Check if paragraph contains a diagram or image.

    Args:
        para: The w:p element.

    Returns:
        True if paragraph contains an image/diagram.
    """
    # Check for drawing elements (images, diagrams)
    if USING_LXML:
        drawings = para.findall('.//wp:drawing', NAMESPACES)
        pics = para.findall('.//pic:pic', NAMESPACES)
        picts = para.findall('.//v:shape', NAMESPACES)
    else:
        drawings = para.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}drawing')
        pics = para.findall('.//{http://schemas.openxmlformats.org/drawingml/2006/picture}pic')
        picts = para.findall('.//{urn:schemas-microsoft-com:vml}shape')

    return bool(drawings or pics or picts)


def is_table_paragraph(para) -> bool:
    """Check if paragraph is immediately before/after a table.

    Note: Tables are w:tbl elements, not w:p. This function is for
    identifying paragraphs that need spacing adjustment around tables.
    """
    # Tables are siblings, not children. This requires context.
    return False


def is_code_block(para) -> bool:
    """Check if paragraph is a code block.

    Args:
        para: The w:p element.

    Returns:
        True if paragraph is formatted as code.
    """
    if USING_LXML:
        pPr = para.find('w:pPr', NAMESPACES)
    else:
        pPr = para.find(f'{W_PREFIX}pPr')

    if pPr is None:
        return False

    if USING_LXML:
        pStyle = pPr.find('w:pStyle', NAMESPACES)
    else:
        pStyle = pPr.find(f'{W_PREFIX}pStyle')

    if pStyle is None:
        return False

    style_val = pStyle.get(f'{{{W_NS}}}val', '')
    return style_val in ('SourceCode', 'Verbatim', 'Code', 'CodeBlock')


def apply_spacing_to_document(docx_path: Path, config: SpacingConfig) -> bool:
    """Apply spacing configuration to a DOCX document.

    Modifies paragraph spacing for headings, diagrams, and other elements.

    Args:
        docx_path: Path to the DOCX file.
        config: SpacingConfig with spacing values.

    Returns:
        True if changes were made, False otherwise.
    """
    changes_made = False

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Extract DOCX
        with zipfile.ZipFile(docx_path, 'r') as zf:
            zf.extractall(temp_path)

        doc_xml_path = temp_path / 'word' / 'document.xml'
        if not doc_xml_path.exists():
            return False

        # Parse document.xml - use lxml parser for proper namespace handling
        if USING_LXML:
            parser = ET.XMLParser(remove_blank_text=False)
            tree = ET.parse(str(doc_xml_path), parser)
        else:
            tree = ET.parse(doc_xml_path)
        root = tree.getroot()

        # Find all paragraphs
        if USING_LXML:
            body = root.find('.//w:body', NAMESPACES)
        else:
            body = root.find(f'.//{W_PREFIX}body')

        if body is None:
            return False

        elements = list(body)
        prev_was_table = False

        for i, elem in enumerate(elements):
            # Handle tables - track for spacing on surrounding paragraphs
            if elem.tag == f'{{{W_NS}}}tbl':
                prev_was_table = True
                continue

            if elem.tag != f'{{{W_NS}}}p':
                prev_was_table = False
                continue

            para = elem

            # Get or create pPr
            if USING_LXML:
                pPr = para.find('w:pPr', NAMESPACES)
            else:
                pPr = para.find(f'{W_PREFIX}pPr')

            if pPr is None:
                if USING_LXML:
                    pPr = ET.Element(f'{{{W_NS}}}pPr')
                else:
                    pPr = ET.Element(f'{W_PREFIX}pPr')
                para.insert(0, pPr)

            # Check element type and apply appropriate spacing
            heading_level = get_heading_level(para)
            if heading_level:
                spacing = config.get_heading_spacing(heading_level)
                if spacing:
                    apply_spacing_to_element(pPr, spacing)
                    changes_made = True
                    logger.debug(f"Applied H{heading_level} spacing: before={spacing.before}, after={spacing.after}")

            elif is_diagram_paragraph(para):
                if config.diagrams.before is not None or config.diagrams.after is not None:
                    apply_spacing_to_element(pPr, config.diagrams)
                    changes_made = True
                    logger.debug(f"Applied diagram spacing: before={config.diagrams.before}, after={config.diagrams.after}")

            elif is_code_block(para):
                if config.code_blocks.before is not None or config.code_blocks.after is not None:
                    apply_spacing_to_element(pPr, config.code_blocks)
                    changes_made = True

            elif prev_was_table:
                # Paragraph right after a table - apply table.after as before
                if config.tables.after is not None:
                    # Create spacing with the table's after value as this paragraph's before
                    table_spacing = ElementSpacing(before=config.tables.after)
                    apply_spacing_to_element(pPr, table_spacing)
                    changes_made = True

            prev_was_table = False

        # Apply spacing to paragraphs before tables
        for i, elem in enumerate(elements):
            if elem.tag == f'{{{W_NS}}}tbl' and i > 0:
                prev_elem = elements[i - 1]
                if prev_elem.tag == f'{{{W_NS}}}p':
                    if USING_LXML:
                        pPr = prev_elem.find('w:pPr', NAMESPACES)
                    else:
                        pPr = prev_elem.find(f'{W_PREFIX}pPr')

                    if pPr is None:
                        if USING_LXML:
                            pPr = ET.Element(f'{{{W_NS}}}pPr')
                        else:
                            pPr = ET.Element(f'{W_PREFIX}pPr')
                        prev_elem.insert(0, pPr)
                    if config.tables.before is not None:
                        # Apply table.before as the paragraph's after
                        table_spacing = ElementSpacing(after=config.tables.before)
                        apply_spacing_to_element(pPr, table_spacing)
                        changes_made = True

        if changes_made:
            # Save modified document.xml
            if USING_LXML:
                tree.write(str(doc_xml_path), encoding='UTF-8', xml_declaration=True)
            else:
                tree.write(doc_xml_path, encoding='UTF-8', xml_declaration=True)

            # Repackage DOCX - ensure [Content_Types].xml is first (Word requirement)
            with zipfile.ZipFile(docx_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                # Write [Content_Types].xml first (required by OOXML spec)
                content_types = temp_path / '[Content_Types].xml'
                if content_types.exists():
                    zf.write(content_types, '[Content_Types].xml')

                # Write remaining files
                for file_path in sorted(temp_path.rglob('*')):
                    if file_path.is_file() and file_path.name != '[Content_Types].xml':
                        arcname = file_path.relative_to(temp_path)
                        zf.write(file_path, arcname)

            logger.info("Applied spacing configuration to document")

    return changes_made
