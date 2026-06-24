"""Add missing Pandoc styles to DOCX documents.

Pandoc generates content using styles that may not exist in the template.
This module ensures those styles are defined to prevent Word from reporting
unreadable content errors.
"""
from pathlib import Path
from docx import Document
from docx.shared import Pt, Twips
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import logging

logger = logging.getLogger(__name__)

# Pandoc styles that need to be defined
PANDOC_STYLES = {
    # Style name: (base style, description)
    'FirstParagraph': ('Normal', 'First paragraph after heading'),
    'BodyText': ('Normal', 'Body text'),
    'Compact': ('Normal', 'Compact paragraph'),
    'ImageCaption': ('Normal', 'Image caption'),
    'CaptionedFigure': ('Normal', 'Figure with caption'),
    'Caption': ('Normal', 'Caption text'),
    'SourceCode': ('Normal', 'Source code block'),
    'Verbatim': ('Normal', 'Verbatim text'),
    'Definition': ('Normal', 'Definition text'),
    'DefinitionTerm': ('Normal', 'Definition term'),
    'BlockQuote': ('Normal', 'Block quote'),
}


def ensure_pandoc_styles(docx_path: Path) -> None:
    """Ensure all Pandoc-generated styles exist in the document.

    This function adds style definitions for common Pandoc styles
    that may not exist in the template. If a style already exists,
    it is not modified.

    Args:
        docx_path: Path to the DOCX file to fix.
    """
    doc = Document(docx_path)
    styles_added = []

    for style_name, (base_style_name, description) in PANDOC_STYLES.items():
        try:
            # Check if style already exists
            existing = None
            for style in doc.styles:
                if style.name == style_name:
                    existing = style
                    break

            if existing is None:
                # Create the style
                try:
                    new_style = doc.styles.add_style(style_name, WD_STYLE_TYPE.PARAGRAPH)

                    # Try to base it on the base style
                    try:
                        base = doc.styles[base_style_name]
                        new_style.base_style = base
                    except KeyError:
                        pass  # Use default if base doesn't exist

                    # Set basic formatting based on style type
                    if style_name == 'Compact':
                        new_style.paragraph_format.space_before = Pt(0)
                        new_style.paragraph_format.space_after = Pt(0)
                    elif style_name == 'ImageCaption' or style_name == 'Caption':
                        new_style.font.italic = True
                        new_style.font.size = Pt(10)
                        new_style.paragraph_format.space_before = Pt(6)
                    elif style_name == 'SourceCode' or style_name == 'Verbatim':
                        new_style.font.name = 'Courier New'
                        new_style.font.size = Pt(9)
                    elif style_name == 'BlockQuote':
                        new_style.paragraph_format.left_indent = Twips(720)  # 0.5 inch
                        new_style.font.italic = True

                    styles_added.append(style_name)
                except ValueError as e:
                    # Style might already exist with different ID
                    logger.debug(f"Could not add style {style_name}: {e}")
        except Exception as e:
            logger.debug(f"Error processing style {style_name}: {e}")

    if styles_added:
        logger.info(f"Added missing Pandoc styles: {', '.join(styles_added)}")
        doc.save(docx_path)


def fix_style_references(docx_path: Path) -> None:
    """Fix any broken style references in the document.

    This is a more aggressive fix that directly manipulates the XML
    to ensure all referenced styles exist.

    Args:
        docx_path: Path to the DOCX file to fix.
    """
    import zipfile
    import tempfile

    try:
        from lxml import etree as ET
        USING_LXML = True
    except ImportError:
        from xml.etree import ElementTree as ET
        USING_LXML = False

    # Namespaces - register all Word namespaces
    namespaces = {
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

    if not USING_LXML:
        for prefix, uri in namespaces.items():
            ET.register_namespace(prefix, uri)

    w_ns = namespaces['w']

    # Extract and analyze
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Extract docx
        with zipfile.ZipFile(docx_path, 'r') as zf:
            zf.extractall(temp_path)

        # Read document.xml to find all referenced styles
        doc_xml_path = temp_path / 'word' / 'document.xml'
        styles_xml_path = temp_path / 'word' / 'styles.xml'

        if not doc_xml_path.exists() or not styles_xml_path.exists():
            return

        # Parse document to find referenced styles
        if USING_LXML:
            parser = ET.XMLParser(remove_blank_text=False)
            doc_tree = ET.parse(str(doc_xml_path), parser)
        else:
            doc_tree = ET.parse(doc_xml_path)
        doc_root = doc_tree.getroot()

        # Find all style references
        referenced_styles = set()
        if USING_LXML:
            for pStyle in doc_root.iter(f'{{{w_ns}}}pStyle'):
                style_val = pStyle.get(f'{{{w_ns}}}val')
                if style_val:
                    referenced_styles.add(style_val)
        else:
            for pStyle in doc_root.iter(f'{{{w_ns}}}pStyle'):
                style_val = pStyle.get(f'{{{w_ns}}}val')
                if style_val:
                    referenced_styles.add(style_val)

        # Parse styles.xml
        if USING_LXML:
            styles_tree = ET.parse(str(styles_xml_path), parser)
        else:
            styles_tree = ET.parse(styles_xml_path)
        styles_root = styles_tree.getroot()

        # Find defined styles
        defined_styles = set()
        for style in styles_root.iter(f'{{{w_ns}}}style'):
            style_id = style.get(f'{{{w_ns}}}styleId')
            if style_id:
                defined_styles.add(style_id)

        # Find missing styles
        missing_styles = referenced_styles - defined_styles

        if missing_styles:
            logger.info(f"Found missing style definitions: {missing_styles}")

            # Add missing styles
            for style_name in missing_styles:
                style_elem = ET.SubElement(styles_root, f'{{{w_ns}}}style')
                style_elem.set(f'{{{w_ns}}}type', 'paragraph')
                style_elem.set(f'{{{w_ns}}}styleId', style_name)
                style_elem.set(f'{{{w_ns}}}customStyle', '1')

                name_elem = ET.SubElement(style_elem, f'{{{w_ns}}}name')
                name_elem.set(f'{{{w_ns}}}val', style_name)

                # Base on Normal
                basedOn = ET.SubElement(style_elem, f'{{{w_ns}}}basedOn')
                basedOn.set(f'{{{w_ns}}}val', 'Normal')

            # Save modified styles.xml
            if USING_LXML:
                styles_tree.write(str(styles_xml_path), encoding='UTF-8', xml_declaration=True)
            else:
                styles_tree.write(styles_xml_path, encoding='UTF-8', xml_declaration=True)

            # Repackage docx - ensure [Content_Types].xml is first
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

            logger.info(f"Added {len(missing_styles)} missing style definitions")
