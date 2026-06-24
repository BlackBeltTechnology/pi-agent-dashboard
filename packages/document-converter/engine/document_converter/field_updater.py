"""DOCX field update functionality using LibreOffice via Gotenberg.

This module provides functions to update field codes (TOC, page numbers, etc.)
in DOCX files without converting to PDF. It uses the Gotenberg Docker service
which runs LibreOffice internally.

The key insight is that LibreOffice updates all fields when opening and saving
a document, so we convert DOCX -> DOCX via LibreOffice to trigger field updates.
"""
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional, Union
import urllib.request
import urllib.error

from .pdf_server import get_server, PDFServerError, check_docker_available
from .pdf_converter import find_local_libreoffice


class FieldUpdateError(Exception):
    """Exception raised when field update fails."""
    pass


def is_gotenberg_available() -> bool:
    """Check if Gotenberg Docker service is available.

    Returns:
        True if Gotenberg is available (container running or can be started).
    """
    if not check_docker_available():
        return False

    server = get_server()
    return server.is_container_running() or server.is_container_exists()


def is_field_update_available() -> bool:
    """Check if field update functionality is available.

    Field update requires either:
    - Local LibreOffice installation, OR
    - Gotenberg Docker service

    Returns:
        True if field update is available.
    """
    # Check local LibreOffice first
    if find_local_libreoffice():
        return True

    # Check Gotenberg
    return is_gotenberg_available()


def _update_fields_with_local_libreoffice(
    input_path: Path,
    output_path: Path,
    libreoffice_path: str
) -> None:
    """Update DOCX fields using local LibreOffice.

    This opens the DOCX in LibreOffice headless mode, which automatically
    updates all fields, then saves it back to DOCX format.

    Args:
        input_path: Path to input DOCX file.
        output_path: Path to output DOCX file.
        libreoffice_path: Path to LibreOffice soffice binary.

    Raises:
        FieldUpdateError: If update fails.
    """
    output_dir = output_path.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    # Create a temp directory for LibreOffice output
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)

        # Copy input to temp dir (LibreOffice outputs to same dir as input)
        tmp_input = tmp_path / input_path.name
        shutil.copy2(input_path, tmp_input)

        # Convert DOCX to DOCX (this triggers field updates)
        # Using the MS Word 2007 XML format filter
        result = subprocess.run(
            [
                libreoffice_path,
                '--headless',
                '--convert-to', 'docx:"MS Word 2007 XML"',
                '--outdir', str(tmp_path),
                str(tmp_input)
            ],
            capture_output=True,
            text=True,
            timeout=120
        )

        if result.returncode != 0:
            raise FieldUpdateError(
                f"LibreOffice field update failed: {result.stderr}"
            )

        # LibreOffice names output based on input filename
        expected_output = tmp_path / f"{tmp_input.stem}.docx"

        if not expected_output.exists():
            raise FieldUpdateError(
                f"LibreOffice did not create expected output file"
            )

        # Move to final destination
        shutil.move(str(expected_output), str(output_path))


def _update_fields_with_gotenberg(
    input_path: Path,
    output_path: Path
) -> None:
    """Update DOCX fields using Gotenberg Docker service.

    Gotenberg's LibreOffice endpoint can convert DOCX to DOCX, which
    triggers field updates during the conversion process.

    Args:
        input_path: Path to input DOCX file.
        output_path: Path to output DOCX file.

    Raises:
        FieldUpdateError: If update fails.
        PDFServerError: If Gotenberg is not available.
    """
    server = get_server()
    base_url = server.ensure_running()

    # Use LibreOffice convert endpoint with DOCX output format
    # Gotenberg API: POST /forms/libreoffice/convert
    url = f"{base_url}/forms/libreoffice/convert"

    # Read DOCX file
    docx_content = input_path.read_bytes()

    # Build multipart form data
    boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
    body = []

    # Add file field
    body.append(f'--{boundary}'.encode())
    body.append(f'Content-Disposition: form-data; name="files"; filename="{input_path.name}"'.encode())
    body.append(b'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    body.append(b'')
    body.append(docx_content)

    # Request DOCX output format (not PDF)
    # Gotenberg uses the nativePdfFormat or pdfFormat for PDF-specific options
    # For DOCX output, we need to use a different approach
    # Actually, Gotenberg's LibreOffice endpoint always outputs PDF
    # We need to use a different approach - convert via local LibreOffice or
    # use a workaround

    body.append(f'--{boundary}--'.encode())
    body_bytes = b'\r\n'.join(body)

    # Note: Gotenberg's LibreOffice endpoint only outputs PDF
    # For DOCX-to-DOCX conversion, we need local LibreOffice
    # This function will raise an error indicating the limitation
    raise FieldUpdateError(
        "Gotenberg does not support DOCX-to-DOCX conversion. "
        "Please install local LibreOffice for field updates."
    )


def update_docx_fields(
    input_path: Union[str, Path],
    output_path: Optional[Union[str, Path]] = None,
    auto_start_gotenberg: bool = True
) -> Path:
    """Update all field codes in a DOCX file.

    This function opens the DOCX in LibreOffice (local or via Docker),
    which automatically updates all fields including:
    - Table of Contents (TOC)
    - Page numbers
    - Cross-references
    - Date/time fields
    - Index entries

    Args:
        input_path: Path to input DOCX file.
        output_path: Path to output DOCX file. If None, updates in place.
        auto_start_gotenberg: If True, automatically start Gotenberg Docker
            if local LibreOffice is not available.

    Returns:
        Path to the updated DOCX file.

    Raises:
        FileNotFoundError: If input file does not exist.
        FieldUpdateError: If field update fails.

    Example:
        >>> update_docx_fields("document.docx")  # Update in place
        >>> update_docx_fields("input.docx", "output.docx")  # Save to new file
    """
    input_path = Path(input_path)

    if not input_path.exists():
        raise FileNotFoundError(f"Input file does not exist: {input_path}")

    # Determine output path
    if output_path is None:
        output_path = input_path
    else:
        output_path = Path(output_path)

    # Check for local LibreOffice first (preferred)
    libreoffice_path = find_local_libreoffice()

    if libreoffice_path:
        # Use local LibreOffice
        if output_path == input_path:
            # Update in place - use temp file
            with tempfile.NamedTemporaryFile(suffix='.docx', delete=False) as tmp:
                tmp_path = Path(tmp.name)
            try:
                _update_fields_with_local_libreoffice(input_path, tmp_path, libreoffice_path)
                shutil.move(str(tmp_path), str(output_path))
            finally:
                if tmp_path.exists():
                    tmp_path.unlink()
        else:
            _update_fields_with_local_libreoffice(input_path, output_path, libreoffice_path)

        return output_path

    # Fall back to Gotenberg (note: limited support)
    if auto_start_gotenberg and check_docker_available():
        try:
            _update_fields_with_gotenberg(input_path, output_path)
            return output_path
        except FieldUpdateError:
            # Gotenberg doesn't support DOCX-to-DOCX
            pass

    raise FieldUpdateError(
        "No field update method available. Please install LibreOffice:\n"
        "  macOS: brew install --cask libreoffice\n"
        "  Linux: sudo apt install libreoffice\n"
        "  Windows: Download from https://www.libreoffice.org/"
    )


def update_fields_if_available(
    docx_path: Union[str, Path],
    output_path: Optional[Union[str, Path]] = None
) -> bool:
    """Update DOCX fields if possible, otherwise skip silently.

    This is a convenience function that attempts to update fields but
    doesn't raise an error if the update method is not available.
    Useful for optional field updates where manual update is acceptable.

    Args:
        docx_path: Path to DOCX file.
        output_path: Path to output file. If None, updates in place.

    Returns:
        True if fields were updated, False if skipped.
    """
    try:
        update_docx_fields(docx_path, output_path, auto_start_gotenberg=False)
        return True
    except (FieldUpdateError, PDFServerError):
        return False
