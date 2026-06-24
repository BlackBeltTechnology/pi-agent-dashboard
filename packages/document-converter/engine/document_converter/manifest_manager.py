"""Document manifest management for tracking conversion metadata and templates."""
from pathlib import Path
from typing import Dict, Optional, Any
from xml.etree import ElementTree as ET
from xml.dom import minidom
from datetime import datetime, timezone


def get_manifest_path(document_path: Path) -> Path:
    """Get the manifest file path for a document.

    Args:
        document_path: Path to the Markdown or DOCX file.

    Returns:
        Path to the corresponding _manifest.xml file.
    """
    return document_path.parent / f"{document_path.stem}_manifest.xml"


def create_manifest(
    document_name: str,
    template_name: Optional[str] = None,
    template_version: str = "1.0",
    features: Optional[Dict[str, bool]] = None
) -> ET.Element:
    """Create a manifest XML element.

    Args:
        document_name: Name of the source document.
        template_name: Name of the template used (if any).
        template_version: Version of the template.
        features: Dictionary of feature flags.

    Returns:
        XML Element containing the manifest.
    """
    root = ET.Element('manifest', version='1.0')

    # Document info
    doc_elem = ET.SubElement(root, 'document')
    doc_elem.text = document_name

    # Timestamp
    created = ET.SubElement(root, 'created')
    created.text = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

    # Template info (if used)
    if template_name:
        template = ET.SubElement(root, 'template')
        template.set('name', template_name)
        template.set('version', template_version)

    # Features
    if features:
        features_elem = ET.SubElement(root, 'features')
        for feature, enabled in features.items():
            feat = ET.SubElement(features_elem, feature.replace('_', '-'))
            feat.set('enabled', str(enabled).lower())

    return root


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


def save_manifest(
    manifest_path: Path,
    document_name: str,
    template_name: Optional[str] = None,
    template_version: str = "1.0",
    features: Optional[Dict[str, bool]] = None
) -> None:
    """Save a document manifest to file.

    Args:
        manifest_path: Path to save the manifest.
        document_name: Name of the source document.
        template_name: Name of the template used (if any).
        template_version: Version of the template.
        features: Dictionary of feature flags.
    """
    root = create_manifest(
        document_name=document_name,
        template_name=template_name,
        template_version=template_version,
        features=features
    )

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    xml_string = prettify_xml(root)
    manifest_path.write_text(xml_string, encoding='utf-8')


def save_manifest_to_both_locations(
    source_path: Path,
    output_path: Path,
    template_name: Optional[str] = None,
    template_version: str = "1.0",
    features: Optional[Dict[str, bool]] = None
) -> None:
    """Save manifest to both source and output locations.

    Args:
        source_path: Path to the source file (DOCX or MD).
        output_path: Path to the output file.
        template_name: Name of the template used (if any).
        template_version: Version of the template.
        features: Dictionary of feature flags.
    """
    document_name = source_path.name

    # Determine manifest paths
    source_manifest = get_manifest_path(source_path)
    output_manifest = get_manifest_path(output_path)

    # Save to source location
    save_manifest(
        source_manifest,
        document_name,
        template_name,
        template_version,
        features
    )

    # Save to output location if different
    if source_manifest != output_manifest:
        save_manifest(
            output_manifest,
            document_name,
            template_name,
            template_version,
            features
        )


def load_manifest(manifest_path: Path) -> Dict[str, Any]:
    """Load a document manifest from file.

    Args:
        manifest_path: Path to the manifest file.

    Returns:
        Dictionary containing manifest data.
    """
    if not manifest_path.exists():
        return {}

    tree = ET.parse(manifest_path)
    root = tree.getroot()

    manifest = {
        'version': root.get('version', '1.0'),
        'document': '',
        'created': '',
        'template_name': None,
        'template_version': None,
        'features': {}
    }

    # Parse document
    doc_elem = root.find('document')
    if doc_elem is not None and doc_elem.text:
        manifest['document'] = doc_elem.text

    # Parse created timestamp
    created_elem = root.find('created')
    if created_elem is not None and created_elem.text:
        manifest['created'] = created_elem.text

    # Parse template info
    template_elem = root.find('template')
    if template_elem is not None:
        manifest['template_name'] = template_elem.get('name')
        manifest['template_version'] = template_elem.get('version', '1.0')

    # Parse features
    features_elem = root.find('features')
    if features_elem is not None:
        for child in features_elem:
            feature_name = child.tag.replace('-', '_')
            manifest['features'][feature_name] = child.get('enabled', 'false').lower() == 'true'

    return manifest


def update_manifest_template(
    manifest_path: Path,
    template_name: str,
    template_version: str = "1.0"
) -> None:
    """Update the template reference in an existing manifest.

    Args:
        manifest_path: Path to the manifest file.
        template_name: New template name.
        template_version: Template version.
    """
    if not manifest_path.exists():
        # Create new manifest with just template info
        save_manifest(
            manifest_path,
            manifest_path.stem.replace('_manifest', ''),
            template_name,
            template_version
        )
        return

    tree = ET.parse(manifest_path)
    root = tree.getroot()

    # Find or create template element
    template_elem = root.find('template')
    if template_elem is None:
        template_elem = ET.SubElement(root, 'template')

    template_elem.set('name', template_name)
    template_elem.set('version', template_version)

    # Save updated manifest
    xml_string = prettify_xml(root)
    manifest_path.write_text(xml_string, encoding='utf-8')


def resolve_template_name(
    md_path: Optional[Path] = None,
    docx_path: Optional[Path] = None,
    cli_template: Optional[str] = None
) -> Optional[str]:
    """Resolve template name using fallback chain.

    Resolution order:
    1. CLI argument (highest priority)
    2. Markdown manifest
    3. DOCX manifest (fallback)

    Args:
        md_path: Path to the Markdown file.
        docx_path: Path to the DOCX file.
        cli_template: Template name from CLI argument.

    Returns:
        Resolved template name, or None if not found.
    """
    # 1. CLI argument takes priority
    if cli_template:
        return cli_template

    # 2. Check Markdown manifest
    if md_path:
        md_manifest = get_manifest_path(md_path)
        manifest = load_manifest(md_manifest)
        if manifest.get('template_name'):
            return manifest['template_name']

    # 3. Fallback to DOCX manifest
    if docx_path:
        docx_manifest = get_manifest_path(docx_path)
        manifest = load_manifest(docx_manifest)
        if manifest.get('template_name'):
            return manifest['template_name']

    return None


def get_template_from_manifest(document_path: Path) -> Optional[str]:
    """Get template name from a document's manifest.

    Args:
        document_path: Path to the document (MD or DOCX).

    Returns:
        Template name if found, None otherwise.
    """
    manifest_path = get_manifest_path(document_path)
    manifest = load_manifest(manifest_path)
    return manifest.get('template_name')
