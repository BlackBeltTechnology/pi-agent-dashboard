"""Metadata mapping module for bidirectional DOCX-Markdown synchronization."""
from pathlib import Path
from typing import Dict, List, Optional, Any, TYPE_CHECKING
from datetime import datetime, timezone
from xml.etree import ElementTree as ET
from xml.dom import minidom

if TYPE_CHECKING:
    from .docx_reader import ExtractionResult, ExtractedElement


# XML namespace for metadata
META_NS = "http://document-converter/meta/1.0"
META_VERSION = "1.0"


def create_mapping(
    elements: List['ExtractedElement'],
    preserved: List[Dict[str, Any]],
    images: List[Dict[str, Any]]
) -> ET.Element:
    """Create XML mapping structure from extracted elements.

    Args:
        elements: List of extracted elements with line mappings.
        preserved: List of preserved element information.
        images: List of image information.

    Returns:
        XML Element containing the mapping structure.
    """
    mappings = ET.Element('mappings')

    for i, element in enumerate(elements):
        mapping = ET.SubElement(mappings, 'mapping')
        mapping.set('id', f"m{i + 1}")

        # DOCX path
        docx_path = ET.SubElement(mapping, 'docx-path')
        docx_path.text = element.docx_path

        # Markdown line range
        md_range = ET.SubElement(mapping, 'md-range')
        md_range.set('start', str(element.line_start))
        md_range.set('end', str(element.line_end))

        # Element type
        elem_type = ET.SubElement(mapping, 'type')
        elem_type.text = element.type

        # Level (for headings and lists)
        if element.level > 0:
            level = ET.SubElement(mapping, 'level')
            level.text = str(element.level)

        # Style name
        if element.style_name:
            style = ET.SubElement(mapping, 'style')
            style.text = element.style_name

        # Additional metadata
        if element.metadata:
            meta = ET.SubElement(mapping, 'metadata')
            for key, value in element.metadata.items():
                if value is not None:
                    meta_item = ET.SubElement(meta, key.replace('_', '-'))
                    meta_item.text = str(value)

    return mappings


def create_preserved_section(
    preserved: List[Dict[str, Any]],
    images: List[Dict[str, Any]]
) -> ET.Element:
    """Create XML section for preserved elements.

    Args:
        preserved: List of preserved element information (charts, etc).
        images: List of image information.

    Returns:
        XML Element containing preserved element references.
    """
    section = ET.Element('preserved')

    # Add preserved elements (charts, shapes, etc.)
    for i, elem in enumerate(preserved):
        element = ET.SubElement(section, 'element')
        element.set('id', f"preserved_{i + 1}")
        element.set('type', elem.get('type', 'unknown'))

        if 'ref_id' in elem:
            element.set('ref', elem['ref_id'])

        docx_path = ET.SubElement(element, 'docx-path')
        docx_path.text = elem.get('docx_path', '')

    # Add image references
    for i, img in enumerate(images):
        element = ET.SubElement(section, 'element')
        element.set('id', f"img_{i + 1}")
        element.set('type', 'image')

        if 'embed_id' in img:
            element.set('ref', img['embed_id'])

        docx_path = ET.SubElement(element, 'docx-path')
        docx_path.text = img.get('docx_path', '')

        if 'extracted_path' in img:
            extracted = ET.SubElement(element, 'extracted-path')
            extracted.text = img['extracted_path']

    return section


def prettify_xml(elem: ET.Element) -> str:
    """Return a pretty-printed XML string.

    Args:
        elem: XML Element to format.

    Returns:
        Formatted XML string.
    """
    rough_string = ET.tostring(elem, encoding='unicode')
    reparsed = minidom.parseString(rough_string)
    return reparsed.toprettyxml(indent="  ")


def save_metadata(
    result: 'ExtractionResult',
    source_docx: Path,
    output_md: Path,
    meta_path: Path
) -> None:
    """Save extraction metadata to an XML file.

    Args:
        result: The extraction result containing elements and mappings.
        source_docx: Path to the source DOCX file.
        output_md: Path to the output Markdown file.
        meta_path: Path for the metadata XML file.
    """
    # Create root element
    root = ET.Element('docmeta')
    root.set('version', META_VERSION)
    # Note: We don't set xmlns to simplify parsing with ElementTree

    # Source file info
    source = ET.SubElement(root, 'source')
    source.text = source_docx.name

    # Extracted file info
    extracted = ET.SubElement(root, 'extracted')
    extracted.text = output_md.name

    # Timestamp
    timestamp = ET.SubElement(root, 'timestamp')
    timestamp.text = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

    # Add mappings
    mappings = create_mapping(
        result.elements,
        result.preserved_elements,
        result.images
    )
    root.append(mappings)

    # Add preserved elements section
    preserved = create_preserved_section(
        result.preserved_elements,
        result.images
    )
    root.append(preserved)

    # Write to file
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    xml_string = prettify_xml(root)
    meta_path.write_text(xml_string, encoding='utf-8')


def load_metadata(meta_path: Path) -> Dict[str, Any]:
    """Load metadata from an XML file.

    Args:
        meta_path: Path to the metadata XML file.

    Returns:
        Dictionary containing parsed metadata.
    """
    if not meta_path.exists():
        raise FileNotFoundError(f"Metadata file not found: {meta_path}")

    tree = ET.parse(meta_path)
    root = tree.getroot()

    metadata = {
        'version': root.get('version', '1.0'),
        'source': '',
        'extracted': '',
        'timestamp': '',
        'mappings': [],
        'preserved': []
    }

    # Parse source and extracted file names
    source_elem = root.find('source')
    if source_elem is not None:
        metadata['source'] = source_elem.text or ''

    extracted_elem = root.find('extracted')
    if extracted_elem is not None:
        metadata['extracted'] = extracted_elem.text or ''

    timestamp_elem = root.find('timestamp')
    if timestamp_elem is not None:
        metadata['timestamp'] = timestamp_elem.text or ''

    # Parse mappings
    mappings_elem = root.find('mappings')
    if mappings_elem is not None:
        for mapping in mappings_elem.findall('mapping'):
            mapping_data = {
                'id': mapping.get('id', ''),
                'docx_path': '',
                'md_start': 0,
                'md_end': 0,
                'type': '',
                'level': 0,
                'style': '',
                'metadata': {}
            }

            docx_path = mapping.find('docx-path')
            if docx_path is not None:
                mapping_data['docx_path'] = docx_path.text or ''

            md_range = mapping.find('md-range')
            if md_range is not None:
                mapping_data['md_start'] = int(md_range.get('start', 0))
                mapping_data['md_end'] = int(md_range.get('end', 0))

            type_elem = mapping.find('type')
            if type_elem is not None:
                mapping_data['type'] = type_elem.text or ''

            level_elem = mapping.find('level')
            if level_elem is not None:
                mapping_data['level'] = int(level_elem.text or 0)

            style_elem = mapping.find('style')
            if style_elem is not None:
                mapping_data['style'] = style_elem.text or ''

            meta_elem = mapping.find('metadata')
            if meta_elem is not None:
                for child in meta_elem:
                    key = child.tag.replace('-', '_')
                    mapping_data['metadata'][key] = child.text

            metadata['mappings'].append(mapping_data)

    # Parse preserved elements
    preserved_elem = root.find('preserved')
    if preserved_elem is not None:
        for element in preserved_elem.findall('element'):
            elem_data = {
                'id': element.get('id', ''),
                'type': element.get('type', ''),
                'ref': element.get('ref', ''),
                'docx_path': '',
                'extracted_path': ''
            }

            docx_path = element.find('docx-path')
            if docx_path is not None:
                elem_data['docx_path'] = docx_path.text or ''

            extracted_path = element.find('extracted-path')
            if extracted_path is not None:
                elem_data['extracted_path'] = extracted_path.text or ''

            metadata['preserved'].append(elem_data)

    return metadata


def update_mapping(
    meta_path: Path,
    old_md_content: str,
    new_md_content: str
) -> Dict[str, Any]:
    """Update metadata mappings based on Markdown changes.

    Args:
        meta_path: Path to the metadata XML file.
        old_md_content: Original Markdown content.
        new_md_content: Modified Markdown content.

    Returns:
        Dictionary with change information.
    """
    metadata = load_metadata(meta_path)

    old_lines = old_md_content.split('\n')
    new_lines = new_md_content.split('\n')

    changes = {
        'modified_mappings': [],
        'line_shifts': {},
        'unchanged_mappings': []
    }

    # Simple diff: track which line ranges changed
    # This is a basic implementation - a more sophisticated diff
    # would use difflib or similar

    for mapping in metadata['mappings']:
        start = mapping['md_start'] - 1  # Convert to 0-indexed
        end = mapping['md_end'] - 1

        if start < 0 or end >= len(old_lines):
            continue

        old_content = '\n'.join(old_lines[start:end + 1])

        # Check if this range still exists and matches
        if end < len(new_lines):
            new_content = '\n'.join(new_lines[start:end + 1])
            if old_content == new_content:
                changes['unchanged_mappings'].append(mapping['id'])
            else:
                changes['modified_mappings'].append({
                    'id': mapping['id'],
                    'old_content': old_content,
                    'new_content': new_content
                })
        else:
            changes['modified_mappings'].append({
                'id': mapping['id'],
                'old_content': old_content,
                'new_content': None  # Deleted
            })

    return changes


def find_metadata_path(md_path: Path) -> Optional[Path]:
    """Find the metadata file for a given Markdown file.

    Args:
        md_path: Path to the Markdown file.

    Returns:
        Path to the metadata file if it exists, None otherwise.
    """
    meta_path = md_path.parent / f"{md_path.stem}_meta.xml"
    if meta_path.exists():
        return meta_path
    return None


def get_meta_path(document_path: Path) -> Path:
    """Get the metadata file path for a document.

    Args:
        document_path: Path to the Markdown or DOCX file.

    Returns:
        Path to the corresponding _meta.xml file.
    """
    return document_path.parent / f"{document_path.stem}_meta.xml"


def save_metadata_to_both_locations(
    result: 'ExtractionResult',
    source_path: Path,
    output_path: Path
) -> None:
    """Save extraction metadata to both source and output locations.

    Args:
        result: The extraction result containing elements and mappings.
        source_path: Path to the source file (DOCX).
        output_path: Path to the output file (MD).
    """
    # Get metadata paths for both locations
    source_meta = get_meta_path(source_path)
    output_meta = get_meta_path(output_path)

    # Save to source location
    save_metadata(result, source_path, output_path, source_meta)

    # Save to output location if different
    if source_meta != output_meta:
        save_metadata(result, source_path, output_path, output_meta)
