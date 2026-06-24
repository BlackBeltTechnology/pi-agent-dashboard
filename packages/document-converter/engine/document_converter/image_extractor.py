"""Image extraction module for DOCX files."""
from pathlib import Path
from typing import Dict, List, Any, TYPE_CHECKING
from docx import Document
from docx.oxml.ns import qn
import re

if TYPE_CHECKING:
    from .docx_reader import ExtractionResult


# Mapping of content types to file extensions
CONTENT_TYPE_EXTENSIONS = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/gif': '.gif',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff',
    'image/x-emf': '.emf',
    'image/x-wmf': '.wmf',
}


def get_image_extension(content_type: str) -> str:
    """Get file extension for a given content type.

    Args:
        content_type: The MIME content type.

    Returns:
        File extension including the dot.
    """
    return CONTENT_TYPE_EXTENSIONS.get(content_type, '.png')


def extract_images_from_docx(doc_path: Path) -> Dict[str, bytes]:
    """Extract all images from a DOCX file.

    Args:
        doc_path: Path to the DOCX file.

    Returns:
        Dictionary mapping embed IDs to image data.
    """
    doc = Document(doc_path)
    images = {}

    # Access the document's relationships to find images
    for rel_id, rel in doc.part.rels.items():
        if "image" in rel.reltype:
            try:
                image_part = rel.target_part
                images[rel_id] = {
                    'data': image_part.blob,
                    'content_type': image_part.content_type,
                    'filename': Path(image_part.partname).name
                }
            except Exception:
                # Skip images that can't be accessed
                pass

    return images


def save_image(image_data: bytes, output_path: Path) -> None:
    """Save image data to a file.

    Args:
        image_data: Raw image bytes.
        output_path: Path to save the image.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(image_data)


def create_images_directory(document_path: Path) -> Path:
    """Create the images directory for a document.

    Args:
        document_path: Path to the document file (MD or DOCX).

    Returns:
        Path to the images directory.
    """
    images_dir = document_path.parent / f"{document_path.stem}_images"
    images_dir.mkdir(parents=True, exist_ok=True)
    return images_dir


def create_images_directories(
    source_path: Path,
    output_path: Path
) -> tuple[Path, Path]:
    """Create images directories for both source and output locations.

    Args:
        source_path: Path to the source file (DOCX).
        output_path: Path to the output file (MD).

    Returns:
        Tuple of (source_images_dir, output_images_dir).
        If locations are the same, both paths will be identical.
    """
    source_images_dir = create_images_directory(source_path)
    output_images_dir = create_images_directory(output_path)

    return source_images_dir, output_images_dir


def save_images_to_both_locations(
    image_data: bytes,
    filename: str,
    source_images_dir: Path,
    output_images_dir: Path
) -> None:
    """Save image data to both source and output directories.

    Args:
        image_data: Raw image bytes.
        filename: Name of the image file.
        source_images_dir: Directory for source location images.
        output_images_dir: Directory for output location images.
    """
    # Save to source location
    source_path = source_images_dir / filename
    save_image(image_data, source_path)

    # Save to output location if different
    if source_images_dir != output_images_dir:
        output_path = output_images_dir / filename
        save_image(image_data, output_path)


def extract_images(
    doc_path: Path,
    output_md_path: Path,
    extraction_result: 'ExtractionResult'
) -> 'ExtractionResult':
    """Extract images from DOCX and update the extraction result.

    Images are saved to both the source DOCX location and the output
    Markdown location (if different directories).

    Args:
        doc_path: Path to the source DOCX file.
        output_md_path: Path to the output markdown file.
        extraction_result: The extraction result to update.

    Returns:
        Updated ExtractionResult with image references in markdown.
    """
    from .docx_reader import ExtractionResult, ExtractedElement

    # Get images from the document
    doc_images = extract_images_from_docx(doc_path)

    if not doc_images:
        return extraction_result

    # Create images directories in both locations
    source_images_dir, output_images_dir = create_images_directories(
        doc_path, output_md_path
    )
    relative_images_dir = f"{output_md_path.stem}_images"

    # Track image file mappings
    image_files: Dict[str, str] = {}  # embed_id -> relative path
    image_counter = 1

    # Save each image to both locations and track its path
    for embed_id, image_info in doc_images.items():
        ext = get_image_extension(image_info['content_type'])
        filename = f"image_{image_counter:03d}{ext}"

        # Save to both source and output locations
        save_images_to_both_locations(
            image_info['data'],
            filename,
            source_images_dir,
            output_images_dir
        )

        # Store relative path for markdown reference
        image_files[embed_id] = f"{relative_images_dir}/{filename}"
        image_counter += 1

    # Update markdown with image references
    # Find positions where images should be inserted
    updated_markdown = extraction_result.markdown
    image_elements = []

    # Match each image in extraction_result.images to its file
    for img_info in extraction_result.images:
        embed_id = img_info.get('embed_id')
        if embed_id and embed_id in image_files:
            relative_path = image_files[embed_id]
            # Create image markdown
            img_md = f"![Image]({relative_path})"

            # Create element for tracking
            image_elements.append(ExtractedElement(
                type='image',
                content=img_md,
                docx_path=img_info.get('docx_path', ''),
                metadata={
                    'embed_id': embed_id,
                    'file_path': relative_path,
                    'original_path': img_info.get('docx_path', '')
                }
            ))

    # Insert image references into markdown
    # For now, append at the end of paragraphs where they were found
    if image_elements:
        lines = updated_markdown.split('\n')
        insertions = []  # (line_index, image_md)

        for img_info, img_element in zip(extraction_result.images, image_elements):
            para_index = img_info.get('paragraph_index', 0)
            # Find the corresponding line in markdown
            # This is approximate - we insert after the paragraph
            line_count = 0
            for i, element in enumerate(extraction_result.elements):
                if element.docx_path == f"/w:body/w:p[{para_index + 1}]":
                    insertions.append((element.line_end, img_element.content))
                    break

        # Sort insertions in reverse order to maintain line numbers
        insertions.sort(key=lambda x: x[0], reverse=True)

        for line_idx, img_md in insertions:
            if line_idx < len(lines):
                lines.insert(line_idx + 1, '')
                lines.insert(line_idx + 2, img_md)

        updated_markdown = '\n'.join(lines)

    # Create updated result
    updated_elements = extraction_result.elements + image_elements
    updated_images = []
    for img_info in extraction_result.images:
        embed_id = img_info.get('embed_id')
        if embed_id and embed_id in image_files:
            img_info['extracted_path'] = image_files[embed_id]
        updated_images.append(img_info)

    return ExtractionResult(
        markdown=updated_markdown,
        elements=updated_elements,
        preserved_elements=extraction_result.preserved_elements,
        images=updated_images
    )


def get_image_info_from_docx(doc_path: Path) -> List[Dict[str, Any]]:
    """Get information about all images in a DOCX file without extracting them.

    Args:
        doc_path: Path to the DOCX file.

    Returns:
        List of image information dictionaries.
    """
    doc = Document(doc_path)
    images = []

    for rel_id, rel in doc.part.rels.items():
        if "image" in rel.reltype:
            try:
                image_part = rel.target_part
                images.append({
                    'embed_id': rel_id,
                    'content_type': image_part.content_type,
                    'original_filename': Path(image_part.partname).name,
                    'size': len(image_part.blob)
                })
            except Exception:
                pass

    return images
