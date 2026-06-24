"""Font management for DOCX documents.

This module provides functionality for:
- Extracting font information from DOCX files
- Finding font files in directories (individual and ZIP-archived)
- Embedding fonts into DOCX files with ODTTF obfuscation
- Reading font metadata from TTF/OTF files
"""
import os
import re
import shutil
import uuid
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from xml.etree import ElementTree as ET

# OOXML namespaces
WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
FONT_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font'

# Register namespaces for proper XML output
ET.register_namespace('w', WORD_NS)
ET.register_namespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')


def get_font_name_from_file(font_path: Path) -> Optional[str]:
    """Read the font family name from a TTF/OTF file.

    Uses fontTools to read the name table from the font file.

    Args:
        font_path: Path to the font file.

    Returns:
        Font family name, or None if it cannot be read.
    """
    try:
        from fontTools.ttLib import TTFont
        font = TTFont(font_path)
        # Try to get font family name (nameID 1)
        name = font['name'].getDebugName(1)
        font.close()
        return name
    except ImportError:
        # fontTools not installed, fall back to filename parsing
        return _parse_font_name_from_filename(font_path.stem)
    except Exception:
        return _parse_font_name_from_filename(font_path.stem)


def _parse_font_name_from_filename(filename: str) -> str:
    """Parse font family name from filename.

    Handles common naming patterns like:
    - SourceSansPro-Regular -> Source Sans Pro
    - source-sans-pro -> Source Sans Pro
    - Arial-Bold -> Arial

    Args:
        filename: Font filename without extension.

    Returns:
        Parsed font family name.
    """
    # Remove common suffixes
    suffixes = ['-Regular', '-Bold', '-Italic', '-BoldItalic', '-Light',
                '-Medium', '-Semibold', '-ExtraLight', '-Black',
                '-LightItalic', '-SemiboldItalic', '-BoldIt', '-It']
    name = filename
    for suffix in suffixes:
        if name.lower().endswith(suffix.lower()):
            name = name[:-len(suffix)]
            break

    # Convert CamelCase to spaces: SourceSansPro -> Source Sans Pro
    name = re.sub(r'([a-z])([A-Z])', r'\1 \2', name)

    # Convert kebab-case to spaces: source-sans-pro -> source sans pro
    name = name.replace('-', ' ').replace('_', ' ')

    # Title case and clean up
    name = ' '.join(word.capitalize() for word in name.split())

    return name


def normalize_font_name(name: str) -> str:
    """Normalize a font name for comparison.

    Removes spaces, hyphens, underscores and converts to lowercase.

    Args:
        name: Font name to normalize.

    Returns:
        Normalized font name.
    """
    return re.sub(r'[\s\-_]', '', name).lower()


def extract_fonts_from_zip(fonts_dir: Path) -> List[Path]:
    """Extract fonts from ZIP files in the fonts directory.

    Args:
        fonts_dir: Path to fonts directory containing ZIP files.

    Returns:
        List of paths to extracted font files.
    """
    extracted_fonts = []
    temp_extract_dir = fonts_dir / "_extracted"

    # Create temporary extraction directory
    temp_extract_dir.mkdir(exist_ok=True)

    # Find all ZIP files in fonts directory
    zip_files = list(fonts_dir.glob("*.zip"))

    for zip_file in zip_files:
        try:
            with zipfile.ZipFile(zip_file, 'r') as zip_ref:
                # Extract all font files
                for file_info in zip_ref.filelist:
                    # Only extract font files (TTF, OTF)
                    if file_info.filename.lower().endswith(('.ttf', '.otf')):
                        # Extract to temp directory
                        extracted_path = temp_extract_dir / Path(file_info.filename).name
                        with zip_ref.open(file_info) as source:
                            with open(extracted_path, 'wb') as target:
                                target.write(source.read())
                        extracted_fonts.append(extracted_path)
        except Exception as e:
            print(f"Warning: Could not extract fonts from {zip_file}: {e}")

    return extracted_fonts


def get_available_fonts(fonts_dir: Path) -> List[Path]:
    """Get all available font files from fonts directory.

    Searches both individual font files and ZIP archives.

    Args:
        fonts_dir: Path to fonts directory.

    Returns:
        List of paths to font files.
    """
    if not fonts_dir.exists():
        return []

    fonts = []

    # Get directly placed font files
    for ext in ['*.ttf', '*.otf', '*.TTF', '*.OTF']:
        fonts.extend(fonts_dir.glob(ext))

    # Extract and get fonts from ZIP files
    extracted = extract_fonts_from_zip(fonts_dir)
    fonts.extend(extracted)

    return fonts


def cleanup_extracted_fonts(fonts_dir: Path) -> None:
    """Clean up temporarily extracted fonts.

    Args:
        fonts_dir: Path to fonts directory.
    """
    temp_extract_dir = fonts_dir / "_extracted"
    if temp_extract_dir.exists():
        shutil.rmtree(temp_extract_dir, ignore_errors=True)


def extract_fonts_from_docx(docx_path: Path) -> Dict[str, dict]:
    """Extract font information from a DOCX file's fontTable.xml.

    Reads the font table to identify all fonts used in the document
    and whether they have embedded font data.

    Args:
        docx_path: Path to the DOCX file.

    Returns:
        Dictionary mapping font names to their info:
        {
            'Source Sans Pro': {
                'name': 'Source Sans Pro',
                'embedded': False,
                'embed_regular': None,  # relationship ID if embedded
                'embed_bold': None,
                'embed_italic': None,
                'embed_bold_italic': None,
            }
        }
    """
    fonts = {}

    try:
        with zipfile.ZipFile(docx_path, 'r') as docx:
            # Read fontTable.xml
            if 'word/fontTable.xml' not in docx.namelist():
                return fonts

            font_table_xml = docx.read('word/fontTable.xml')
            root = ET.fromstring(font_table_xml)

            # Find all font elements
            for font_elem in root.findall(f'.//{{{WORD_NS}}}font'):
                font_name = font_elem.get(f'{{{WORD_NS}}}name')
                if not font_name:
                    continue

                font_info = {
                    'name': font_name,
                    'embedded': False,
                    'embed_regular': None,
                    'embed_bold': None,
                    'embed_italic': None,
                    'embed_bold_italic': None,
                }

                # Check for embedded font references
                embed_regular = font_elem.find(f'{{{WORD_NS}}}embedRegular')
                embed_bold = font_elem.find(f'{{{WORD_NS}}}embedBold')
                embed_italic = font_elem.find(f'{{{WORD_NS}}}embedItalic')
                embed_bold_italic = font_elem.find(f'{{{WORD_NS}}}embedBoldItalic')

                r_ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

                if embed_regular is not None:
                    font_info['embed_regular'] = embed_regular.get(f'{{{r_ns}}}id')
                    font_info['embedded'] = True
                if embed_bold is not None:
                    font_info['embed_bold'] = embed_bold.get(f'{{{r_ns}}}id')
                    font_info['embedded'] = True
                if embed_italic is not None:
                    font_info['embed_italic'] = embed_italic.get(f'{{{r_ns}}}id')
                    font_info['embedded'] = True
                if embed_bold_italic is not None:
                    font_info['embed_bold_italic'] = embed_bold_italic.get(f'{{{r_ns}}}id')
                    font_info['embedded'] = True

                fonts[font_name] = font_info

    except Exception as e:
        print(f"Warning: Could not read fonts from {docx_path}: {e}")

    return fonts


def extract_embedded_fonts(docx_path: Path, output_dir: Path) -> List[Path]:
    """Extract and deobfuscate embedded fonts from a DOCX file.

    DOCX files store embedded fonts as ODTTF files with XOR obfuscation.
    This function extracts and deobfuscates them to standard TTF/OTF.

    Args:
        docx_path: Path to the DOCX file.
        output_dir: Directory to save extracted fonts.

    Returns:
        List of paths to extracted font files.
    """
    extracted = []
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(docx_path, 'r') as docx:
            # Find all font files in word/fonts/
            font_files = [f for f in docx.namelist()
                         if f.startswith('word/fonts/') and f.endswith('.odttf')]

            # Read relationships to get font GUIDs for deobfuscation
            rels = {}
            if 'word/_rels/fontTable.xml.rels' in docx.namelist():
                rels_xml = docx.read('word/_rels/fontTable.xml.rels')
                rels_root = ET.fromstring(rels_xml)
                for rel in rels_root.findall(f'.//{{{REL_NS}}}Relationship'):
                    rel_id = rel.get('Id')
                    target = rel.get('Target')
                    if target:
                        # Extract GUID from target path like fonts/{GUID}.odttf
                        match = re.search(r'\{([A-Fa-f0-9\-]+)\}', target)
                        if match:
                            rels[target] = match.group(1)

            for font_file in font_files:
                # Read obfuscated font data
                obfuscated_data = docx.read(font_file)

                # Get GUID for deobfuscation
                font_filename = Path(font_file).name
                guid = None
                for target, g in rels.items():
                    if font_filename in target:
                        guid = g
                        break

                if guid:
                    # Deobfuscate
                    deobfuscated_data = _deobfuscate_font(obfuscated_data, guid)
                else:
                    # Try to extract GUID from filename
                    match = re.search(r'\{([A-Fa-f0-9\-]+)\}', font_filename)
                    if match:
                        guid = match.group(1)
                        deobfuscated_data = _deobfuscate_font(obfuscated_data, guid)
                    else:
                        deobfuscated_data = obfuscated_data

                # Determine output filename from font metadata
                temp_path = output_dir / font_filename.replace('.odttf', '.ttf')
                temp_path.write_bytes(deobfuscated_data)

                # Try to read actual font name
                font_name = get_font_name_from_file(temp_path)
                if font_name:
                    # Rename with proper name
                    proper_name = font_name.replace(' ', '') + '.ttf'
                    proper_path = output_dir / proper_name
                    if temp_path != proper_path:
                        temp_path.rename(proper_path)
                        temp_path = proper_path

                extracted.append(temp_path)

    except Exception as e:
        print(f"Warning: Could not extract embedded fonts from {docx_path}: {e}")

    return extracted


def _deobfuscate_font(data: bytes, guid: str) -> bytes:
    """Deobfuscate ODTTF font data using XOR with GUID-derived key.

    The OOXML specification uses XOR obfuscation with a 32-byte key
    derived from the font's GUID. Only the first 32 bytes are obfuscated.

    Args:
        data: Obfuscated font data.
        guid: GUID string (with or without braces/hyphens).

    Returns:
        Deobfuscated font data.
    """
    # Clean GUID and convert to bytes
    guid_clean = guid.replace('{', '').replace('}', '').replace('-', '')

    # Convert hex string to bytes (reverse byte order for each pair)
    try:
        guid_bytes = bytes.fromhex(guid_clean)
    except ValueError:
        return data  # Return as-is if GUID is invalid

    # Create 32-byte key by repeating the 16-byte GUID twice (reversed)
    key = guid_bytes[::-1] + guid_bytes[::-1]

    # XOR first 32 bytes
    result = bytearray(data)
    for i in range(min(32, len(result))):
        result[i] ^= key[i]

    return bytes(result)


def _obfuscate_font(data: bytes, guid: str) -> bytes:
    """Obfuscate font data for embedding in DOCX.

    Uses the same XOR algorithm as deobfuscation (XOR is its own inverse).

    Args:
        data: Font data to obfuscate.
        guid: GUID string to use as key.

    Returns:
        Obfuscated font data (ODTTF format).
    """
    return _deobfuscate_font(data, guid)  # XOR is symmetric


def find_font_file(
    font_name: str,
    search_dirs: List[Path],
    include_system: bool = True
) -> Dict[str, Path]:
    """Find font files matching a font name.

    Searches in the provided directories for font files that match
    the given font name. Supports individual files and ZIP archives.

    Args:
        font_name: Font family name to search for.
        search_dirs: List of directories to search.
        include_system: Whether to search system font directories.

    Returns:
        Dictionary mapping variant names to file paths:
        {
            'regular': Path('/path/to/Font-Regular.ttf'),
            'bold': Path('/path/to/Font-Bold.ttf'),
            'italic': Path('/path/to/Font-Italic.ttf'),
            'bolditalic': Path('/path/to/Font-BoldItalic.ttf'),
        }
    """
    found = {}
    normalized_name = normalize_font_name(font_name)

    # Collect all font files from search directories
    all_fonts = []
    for search_dir in search_dirs:
        if search_dir and search_dir.exists():
            all_fonts.extend(get_available_fonts(search_dir))

    # Search system fonts if requested
    if include_system:
        system_fonts = _get_system_font_dirs()
        for sys_dir in system_fonts:
            if sys_dir.exists():
                for ext in ['*.ttf', '*.otf', '*.TTF', '*.OTF']:
                    all_fonts.extend(sys_dir.glob(ext))

    # Match fonts by name
    for font_path in all_fonts:
        # Get font name from file
        file_font_name = get_font_name_from_file(font_path)
        if file_font_name and normalize_font_name(file_font_name) == normalized_name:
            variant = _detect_font_variant(font_path)
            if variant not in found:
                found[variant] = font_path

    return found


def _get_system_font_dirs() -> List[Path]:
    """Get system font directories for the current platform.

    Returns:
        List of system font directory paths.
    """
    import platform
    system = platform.system()

    dirs = []
    if system == 'Darwin':  # macOS
        dirs = [
            Path('/Library/Fonts'),
            Path('/System/Library/Fonts'),
            Path.home() / 'Library/Fonts',
        ]
    elif system == 'Windows':
        windir = os.environ.get('WINDIR', 'C:\\Windows')
        dirs = [
            Path(windir) / 'Fonts',
            Path.home() / 'AppData/Local/Microsoft/Windows/Fonts',
        ]
    else:  # Linux
        dirs = [
            Path('/usr/share/fonts'),
            Path('/usr/local/share/fonts'),
            Path.home() / '.fonts',
            Path.home() / '.local/share/fonts',
        ]

    return [d for d in dirs if d.exists()]


def _detect_font_variant(font_path: Path) -> str:
    """Detect the font variant (regular, bold, italic, etc.) from a font file.

    Args:
        font_path: Path to the font file.

    Returns:
        Variant name: 'regular', 'bold', 'italic', or 'bolditalic'.
    """
    filename = font_path.stem.lower()

    if 'bolditalic' in filename or 'boldit' in filename or ('bold' in filename and 'italic' in filename):
        return 'bolditalic'
    elif 'bold' in filename:
        return 'bold'
    elif 'italic' in filename or filename.endswith('it'):
        return 'italic'
    else:
        return 'regular'


def resolve_template_fonts(
    docx_path: Path,
    template_fonts_dir: Optional[Path] = None,
    default_fonts_dir: Optional[Path] = None,
    include_system: bool = True
) -> Dict[str, Dict[str, Path]]:
    """Resolve all fonts used in a DOCX to their font files.

    Args:
        docx_path: Path to the DOCX file.
        template_fonts_dir: Template's fonts directory (searched first).
        default_fonts_dir: Default template's fonts directory (fallback).
        include_system: Whether to search system fonts as last resort.

    Returns:
        Dictionary mapping font names to variant paths:
        {
            'Source Sans Pro': {
                'regular': Path('/path/to/SourceSansPro-Regular.ttf'),
                'bold': Path('/path/to/SourceSansPro-Bold.ttf'),
            },
            'Arial': {
                'regular': Path('/path/to/Arial.ttf'),
            }
        }
    """
    result = {}

    # Get fonts used in the document
    doc_fonts = extract_fonts_from_docx(docx_path)

    # Build search directories (order matters: template first, then default)
    search_dirs = []
    if template_fonts_dir and template_fonts_dir.exists():
        search_dirs.append(template_fonts_dir)
    if default_fonts_dir and default_fonts_dir.exists():
        search_dirs.append(default_fonts_dir)

    # Resolve each font
    for font_name, font_info in doc_fonts.items():
        # Skip if already embedded
        if font_info['embedded']:
            continue

        # Find font files
        found = find_font_file(font_name, search_dirs, include_system)
        if found:
            result[font_name] = found

    return result


def _add_odttf_content_type(docx_path: Path) -> None:
    """Add odttf content type to [Content_Types].xml if not present.

    DOCX files need to declare the content type for .odttf (obfuscated font) files.
    Without this, Word will report "unreadable content" errors.

    Args:
        docx_path: Path to the DOCX file.
    """
    try:
        with zipfile.ZipFile(docx_path, 'r') as docx_in:
            content_types_xml = docx_in.read('[Content_Types].xml').decode('utf-8')

        # Check if odttf extension is already declared
        if 'Extension="odttf"' in content_types_xml:
            return  # Already present

        # Use string manipulation to add the odttf extension
        # This preserves the original XML format without namespace prefix issues
        odttf_default = '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>'

        # Insert after <Types ...> opening tag
        import re
        pattern = r'(<Types[^>]*>)'
        replacement = r'\1' + odttf_default
        modified_xml = re.sub(pattern, replacement, content_types_xml)

        # Write back
        temp_path = docx_path.with_suffix('.docx.tmp')
        with zipfile.ZipFile(docx_path, 'r') as docx_in:
            with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as docx_out:
                for item in docx_in.namelist():
                    if item == '[Content_Types].xml':
                        docx_out.writestr(item, modified_xml.encode('utf-8'))
                    else:
                        docx_out.writestr(item, docx_in.read(item))

        # Replace original
        docx_path.unlink()
        temp_path.rename(docx_path)

    except Exception as e:
        print(f"Warning: Could not add odttf content type: {e}")


def embed_font_in_docx(
    docx_path: Path,
    font_name: str,
    font_files: Dict[str, Path],
    output_path: Optional[Path] = None
) -> bool:
    """Embed font files into a DOCX document.

    Uses string manipulation to preserve original XML structure and namespaces,
    avoiding ElementTree's namespace prefix issues that cause Word corruption.

    Args:
        docx_path: Path to the DOCX file.
        font_name: Font family name as it appears in the document.
        font_files: Dictionary mapping variants to font file paths.
        output_path: Output path (defaults to overwriting input).

    Returns:
        True if fonts were embedded successfully.
    """
    if not font_files:
        return False

    if output_path is None:
        output_path = docx_path

    temp_path = output_path.with_suffix('.docx.tmp')

    try:
        # Read the DOCX as a zip
        with zipfile.ZipFile(docx_path, 'r') as docx_in:
            # Read fontTable.xml as string to preserve formatting
            font_table_xml = docx_in.read('word/fontTable.xml').decode('utf-8')

            # Check if font exists in table
            # Look for w:font w:name="Font Name" pattern
            font_pattern = rf'<w:font\s+w:name="{re.escape(font_name)}"[^>]*>'
            if not re.search(font_pattern, font_table_xml):
                return False

            # Read existing relationships or prepare new content
            rels_xml = ''
            existing_rels = []
            if 'word/_rels/fontTable.xml.rels' in docx_in.namelist():
                rels_xml = docx_in.read('word/_rels/fontTable.xml.rels').decode('utf-8')
                # Extract existing relationship IDs
                existing_rels = re.findall(r'Id="(rId\d+)"', rels_xml)

            # Prepare embed elements and relationships
            rel_id_counter = len(existing_rels) + 1
            new_rels = []
            embed_elements = []

            variant_to_element = {
                'regular': 'embedRegular',
                'bold': 'embedBold',
                'italic': 'embedItalic',
                'bolditalic': 'embedBoldItalic',
            }

            font_files_to_write = {}

            for variant, font_file in font_files.items():
                if variant not in variant_to_element:
                    continue

                elem_name = variant_to_element[variant]

                # Generate GUID for obfuscation
                font_guid = str(uuid.uuid4()).upper()

                # Generate relationship ID
                while f'rId{rel_id_counter}' in existing_rels:
                    rel_id_counter += 1
                rel_id = f'rId{rel_id_counter}'
                existing_rels.append(rel_id)
                rel_id_counter += 1

                # Prepare font file for writing
                font_filename = f'{{{font_guid}}}.odttf'
                font_data = font_file.read_bytes()
                obfuscated_data = _obfuscate_font(font_data, font_guid)
                font_files_to_write[f'word/fonts/{font_filename}'] = obfuscated_data

                # Prepare relationship entry
                new_rels.append(
                    f'<Relationship Id="{rel_id}" '
                    f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" '
                    f'Target="fonts/{font_filename}"/>'
                )

                # Prepare embed element
                embed_elements.append((elem_name, rel_id))

            # Build embed elements string
            embeds_str = ''
            for elem_name, rel_id in embed_elements:
                embeds_str += f'<w:{elem_name} r:id="{rel_id}"/>'

            # Find the closing </w:font> tag for the specific font and insert embeds before it
            # Strategy: find the font opening tag, then find its matching </w:font>

            # First, find where our font element starts
            font_start_pattern = rf'<w:font\s+w:name="{re.escape(font_name)}"'
            font_start_match = re.search(font_start_pattern, font_table_xml)

            if font_start_match:
                start_pos = font_start_match.start()
                # Find the next </w:font> after this position
                rest_of_xml = font_table_xml[start_pos:]
                close_tag_match = re.search(r'</w:font>', rest_of_xml)

                if close_tag_match:
                    # Calculate absolute position of closing tag
                    close_tag_pos = start_pos + close_tag_match.start()
                    # Insert embeds just before </w:font>
                    modified_font_table = (
                        font_table_xml[:close_tag_pos] +
                        embeds_str +
                        font_table_xml[close_tag_pos:]
                    )
                else:
                    # No closing tag found - shouldn't happen in valid XML
                    modified_font_table = font_table_xml
            else:
                modified_font_table = font_table_xml

            # Modify or create relationships file
            if rels_xml:
                # Insert new relationships before </Relationships>
                new_rels_str = ''.join(new_rels)
                modified_rels = rels_xml.replace('</Relationships>', new_rels_str + '</Relationships>')
            else:
                # Create new relationships file
                modified_rels = (
                    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                    + ''.join(new_rels) +
                    '</Relationships>'
                )

            # Write output zip
            with zipfile.ZipFile(temp_path, 'w', zipfile.ZIP_DEFLATED) as docx_out:
                # Copy existing files except fontTable, its rels, and fonts we're replacing
                for item in docx_in.namelist():
                    if item == 'word/fontTable.xml':
                        continue
                    if item == 'word/_rels/fontTable.xml.rels':
                        continue
                    # Preserve existing font files that aren't being replaced
                    if item.startswith('word/fonts/'):
                        if item not in font_files_to_write:
                            docx_out.writestr(item, docx_in.read(item))
                        continue
                    docx_out.writestr(item, docx_in.read(item))

                # Write modified fontTable.xml
                docx_out.writestr('word/fontTable.xml', modified_font_table.encode('utf-8'))

                # Write relationships
                docx_out.writestr('word/_rels/fontTable.xml.rels', modified_rels.encode('utf-8'))

                # Write new font files
                for font_path, font_data in font_files_to_write.items():
                    docx_out.writestr(font_path, font_data)

        # Replace original with temp
        if output_path == docx_path:
            docx_path.unlink()
        temp_path.rename(output_path)

        return True

    except Exception as e:
        print(f"Warning: Could not embed fonts in {docx_path}: {e}")
        if temp_path.exists():
            temp_path.unlink()
        return False


def embed_template_fonts(
    docx_path: Path,
    template_fonts_dir: Optional[Path] = None,
    default_fonts_dir: Optional[Path] = None,
    include_system: bool = True,
    output_path: Optional[Path] = None
) -> Dict[str, bool]:
    """Embed all template fonts into a DOCX document.

    This is the main orchestration function that:
    1. Detects fonts used in the document
    2. Resolves font files from template/default/system directories
    3. Embeds each font into the document

    Args:
        docx_path: Path to the DOCX file.
        template_fonts_dir: Template's fonts directory.
        default_fonts_dir: Default template's fonts directory.
        include_system: Whether to search system fonts.
        output_path: Output path (defaults to overwriting input).

    Returns:
        Dictionary mapping font names to embedding success status.
    """
    results = {}

    # Resolve fonts
    resolved = resolve_template_fonts(
        docx_path,
        template_fonts_dir,
        default_fonts_dir,
        include_system
    )

    if not resolved:
        return results

    # Use output path or input path
    current_path = docx_path
    if output_path and output_path != docx_path:
        shutil.copy2(docx_path, output_path)
        current_path = output_path

    # Embed each font
    fonts_embedded = False
    for font_name, font_files in resolved.items():
        success = embed_font_in_docx(current_path, font_name, font_files)
        results[font_name] = success
        if success:
            fonts_embedded = True
            print(f"Embedded font: {font_name} ({len(font_files)} variant(s))")
        else:
            print(f"Warning: Could not embed font: {font_name}")

    # Add odttf content type to [Content_Types].xml if fonts were embedded
    if fonts_embedded:
        _add_odttf_content_type(current_path)

    # Cleanup extracted fonts
    if template_fonts_dir:
        cleanup_extracted_fonts(template_fonts_dir)
    if default_fonts_dir:
        cleanup_extracted_fonts(default_fonts_dir)

    return results


# Legacy function for backwards compatibility
def embed_fonts_in_docx(docx_path: Path, fonts_dir: Path) -> None:
    """Embed fonts from fonts directory into DOCX file.

    This is a simplified wrapper around embed_template_fonts().

    Args:
        docx_path: Path to DOCX file.
        fonts_dir: Path to fonts directory containing font files.
    """
    embed_template_fonts(
        docx_path,
        template_fonts_dir=fonts_dir,
        include_system=False
    )
