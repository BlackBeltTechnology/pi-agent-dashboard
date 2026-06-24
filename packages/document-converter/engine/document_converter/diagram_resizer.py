"""Apply calculated diagram dimensions to images in DOCX files.

This module resizes diagram images in the generated DOCX to match the
dimensions calculated by the Constant Zoom normalization algorithm.
"""
import hashlib
import re
import zipfile
import tempfile
import logging
from pathlib import Path
from typing import Dict, List, Tuple
from dataclasses import dataclass

from .diagram_sizing import DiagramDimensions, SizingConfig, calculate_diagram_dimensions
from .mermaid_renderer import DiagramInfo

logger = logging.getLogger(__name__)


@dataclass
class ImageSizeMapping:
    """Mapping of image content hash to calculated dimensions."""
    content_hash: str
    dimensions: DiagramDimensions
    source_path: Path  # Original path for logging


def _compute_file_hash(file_path: Path) -> str:
    """Compute MD5 hash of file content."""
    hasher = hashlib.md5()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


def build_diagram_size_map(
    mermaid_diagrams: Dict[str, DiagramInfo],
    plantuml_diagrams: List[DiagramInfo],
    graphviz_diagrams: Dict[str, DiagramInfo],
    sizing_config: SizingConfig
) -> Dict[str, Tuple[DiagramDimensions, str]]:
    """Build mapping from image content hashes to calculated dimensions.

    Args:
        mermaid_diagrams: Dictionary of mermaid code -> DiagramInfo.
        plantuml_diagrams: List of PlantUML DiagramInfo objects.
        graphviz_diagrams: Dictionary of graphviz code -> DiagramInfo.
        sizing_config: Configuration for diagram sizing.

    Returns:
        Dictionary mapping content hash to (DiagramDimensions, source_filename).
    """
    size_map: Dict[str, Tuple[DiagramDimensions, str]] = {}

    # Process Mermaid diagrams
    for mermaid_code, diagram_info in mermaid_diagrams.items():
        if diagram_info.path and diagram_info.path.exists():
            if diagram_info.logical_width and diagram_info.logical_height:
                dims = calculate_diagram_dimensions(
                    diagram_info.logical_width,
                    diagram_info.logical_height,
                    diagram_info.units_per_inch,
                    sizing_config
                )
                content_hash = _compute_file_hash(diagram_info.path)
                size_map[content_hash] = (dims, diagram_info.path.name)
                logger.debug(f"Mermaid {diagram_info.path.name}: {dims.width_inches:.2f}x{dims.height_inches:.2f} in")

    # Process PlantUML diagrams
    for diagram_info in plantuml_diagrams:
        if diagram_info.path and diagram_info.path.exists():
            if diagram_info.logical_width and diagram_info.logical_height:
                dims = calculate_diagram_dimensions(
                    diagram_info.logical_width,
                    diagram_info.logical_height,
                    diagram_info.units_per_inch,
                    sizing_config
                )
                content_hash = _compute_file_hash(diagram_info.path)
                size_map[content_hash] = (dims, diagram_info.path.name)
                logger.debug(f"PlantUML {diagram_info.path.name}: {dims.width_inches:.2f}x{dims.height_inches:.2f} in")

    # Process Graphviz diagrams
    for graphviz_code, diagram_info in graphviz_diagrams.items():
        if diagram_info.path and diagram_info.path.exists():
            if diagram_info.logical_width and diagram_info.logical_height:
                dims = calculate_diagram_dimensions(
                    diagram_info.logical_width,
                    diagram_info.logical_height,
                    diagram_info.units_per_inch,
                    sizing_config
                )
                content_hash = _compute_file_hash(diagram_info.path)
                size_map[content_hash] = (dims, diagram_info.path.name)
                logger.debug(f"Graphviz {diagram_info.path.name}: {dims.width_inches:.2f}x{dims.height_inches:.2f} in")

    return size_map


def apply_diagram_sizes(
    docx_path: Path,
    size_map: Dict[str, Tuple[DiagramDimensions, str]]
) -> int:
    """Apply calculated dimensions to diagram images in DOCX.

    Matches images by content hash to handle pandoc renaming files.

    Args:
        docx_path: Path to the DOCX file to modify.
        size_map: Dictionary mapping content hash to (DiagramDimensions, source_filename).

    Returns:
        Number of images resized.
    """
    if not size_map:
        return 0

    resized_count = 0

    # Extract DOCX to temp directory
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)

        # Extract the docx
        with zipfile.ZipFile(docx_path, 'r') as zf:
            zf.extractall(temp_path)

        # Read relationships to map image filenames to relationship IDs
        rels_path = temp_path / 'word' / '_rels' / 'document.xml.rels'
        if not rels_path.exists():
            logger.warning("No document.xml.rels found")
            return 0

        rels_content = rels_path.read_text(encoding='utf-8')

        # Read document.xml
        doc_xml_path = temp_path / 'word' / 'document.xml'
        if not doc_xml_path.exists():
            logger.warning("No document.xml found")
            return 0

        doc_content = doc_xml_path.read_text(encoding='utf-8')

        # Build mapping from rId to filename in DOCX
        rid_to_filename: Dict[str, str] = {}
        rel_pattern = r'<Relationship[^>]*Id="([^"]+)"[^>]*Target="media/([^"]+)"'
        for match in re.finditer(rel_pattern, rels_content):
            rid = match.group(1)
            filename = match.group(2)
            rid_to_filename[rid] = filename

        # Also try alternate attribute order
        rel_pattern2 = r'<Relationship[^>]*Target="media/([^"]+)"[^>]*Id="([^"]+)"'
        for match in re.finditer(rel_pattern2, rels_content):
            filename = match.group(1)
            rid = match.group(2)
            if rid not in rid_to_filename:
                rid_to_filename[rid] = filename

        # Build hash-to-dimensions map for images in DOCX
        media_dir = temp_path / 'word' / 'media'
        if not media_dir.exists():
            logger.debug("No media directory in DOCX")
            return 0

        # Map DOCX image filenames to their hashes
        docx_file_to_hash: Dict[str, str] = {}
        for img_file in media_dir.iterdir():
            if img_file.is_file():
                docx_file_to_hash[img_file.name] = _compute_file_hash(img_file)

        # Find which DOCX images match our source diagrams
        docx_file_to_dims: Dict[str, DiagramDimensions] = {}
        for docx_filename, img_hash in docx_file_to_hash.items():
            if img_hash in size_map:
                dims, source_name = size_map[img_hash]
                docx_file_to_dims[docx_filename] = dims
                logger.debug(f"Matched {source_name} -> {docx_filename}")

        # Collect all rIds that need to be resized for centering pass
        rids_to_resize = set()
        for rid, filename in rid_to_filename.items():
            if filename in docx_file_to_dims:
                rids_to_resize.add(rid)

        # Find and update each matched diagram image
        modified = False
        for rid, filename in rid_to_filename.items():
            if filename not in docx_file_to_dims:
                continue

            dims = docx_file_to_dims[filename]
            logger.info(f"Resizing {filename} to {dims.width_inches:.2f}x{dims.height_inches:.2f} in")

            # Find the drawing element with this relationship ID
            # Pattern: <w:drawing>...<a:blip r:embed="rId..."/>...</w:drawing>
            drawing_pattern = rf'(<w:drawing>)((?:(?!</w:drawing>).)*r:embed="{rid}"(?:(?!</w:drawing>).)*)(</w:drawing>)'

            def replace_dimensions(match):
                nonlocal modified, resized_count
                drawing_start = match.group(1)
                drawing_content = match.group(2)
                drawing_end = match.group(3)

                # Update wp:extent cx="..." cy="..."
                new_content = re.sub(
                    r'(<wp:extent\s+)cx="(\d+)"\s+cy="(\d+)"',
                    rf'\1cx="{dims.width_emu}" cy="{dims.height_emu}"',
                    drawing_content
                )

                # Update a:ext cx="..." cy="..." (inside a:xfrm)
                new_content = re.sub(
                    r'(<a:ext\s+)cx="(\d+)"\s+cy="(\d+)"',
                    rf'\1cx="{dims.width_emu}" cy="{dims.height_emu}"',
                    new_content
                )

                if new_content != drawing_content:
                    modified = True
                    resized_count += 1

                return f'{drawing_start}{new_content}{drawing_end}'

            doc_content = re.sub(drawing_pattern, replace_dimensions, doc_content, flags=re.DOTALL)

        # Center-align paragraphs containing diagram images
        if rids_to_resize:
            doc_content = _center_diagram_paragraphs(doc_content, rids_to_resize)
            modified = True

        if modified:
            # Write modified document.xml
            doc_xml_path.write_text(doc_content, encoding='utf-8')

            # Repack the DOCX
            _repack_docx(temp_path, docx_path)

    return resized_count


def _center_diagram_paragraphs(doc_content: str, rids: set) -> str:
    """Center-align paragraphs containing diagram images.

    Args:
        doc_content: The document.xml content.
        rids: Set of relationship IDs for diagram images.

    Returns:
        Modified document content with centered diagram paragraphs.
    """
    # Word namespace
    w_ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

    # Build pattern to match any of the diagram rIds
    rid_pattern = '|'.join(re.escape(rid) for rid in rids)

    # Find paragraphs containing drawings with our rIds
    # Pattern: <w:p>...<w:drawing>...<a:blip r:embed="rIdX"/>...</w:drawing>...</w:p>
    para_pattern = rf'(<w:p[^>]*>)((?:(?!</w:p>).)*<w:drawing>(?:(?!</w:drawing>).)*r:embed="({rid_pattern})"(?:(?!</w:drawing>).)*</w:drawing>(?:(?!</w:p>).)*)(</w:p>)'

    def add_center_alignment(match):
        para_start = match.group(1)
        para_content = match.group(2)
        para_end = match.group(4)

        # Check if paragraph already has w:pPr
        if '<w:pPr>' in para_content or '<w:pPr ' in para_content:
            # Check if it already has w:jc
            if f'<w:jc ' in para_content:
                # Update existing w:jc to center
                para_content = re.sub(
                    r'<w:jc\s+w:val="[^"]*"',
                    f'<w:jc w:val="center"',
                    para_content
                )
            else:
                # Add w:jc inside existing w:pPr
                para_content = re.sub(
                    r'(<w:pPr[^>]*>)',
                    rf'\1<w:jc w:val="center"/>',
                    para_content
                )
        else:
            # No w:pPr exists, add it after para_start
            # Insert right after <w:p> or <w:p ...>
            para_content = f'<w:pPr><w:jc w:val="center"/></w:pPr>{para_content}'

        return f'{para_start}{para_content}{para_end}'

    return re.sub(para_pattern, add_center_alignment, doc_content, flags=re.DOTALL)


def _repack_docx(extracted_dir: Path, output_path: Path) -> None:
    """Repack extracted DOCX contents into a DOCX file.

    Args:
        extracted_dir: Directory containing extracted DOCX contents.
        output_path: Path to write the repacked DOCX.
    """
    # Remove existing file
    if output_path.exists():
        output_path.unlink()

    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for file_path in extracted_dir.rglob('*'):
            if file_path.is_file():
                arcname = file_path.relative_to(extracted_dir)
                zf.write(file_path, arcname)
