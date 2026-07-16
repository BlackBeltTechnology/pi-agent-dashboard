"""PDF conversion logic using local LibreOffice or Docker-based Gotenberg service.

Provides functions to convert DOCX, Markdown, and AsciiDoc files to PDF format.
Prefers local LibreOffice installation for better compatibility, falls back to
gotenberg/gotenberg:8 Docker image when local LibreOffice is not available.
"""
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union
import urllib.request
import urllib.error

from .pdf_server import get_server, PDFServerError


def find_local_libreoffice() -> Optional[str]:
    """Find local LibreOffice installation.

    Returns:
        Path to LibreOffice soffice binary, or None if not found.
    """
    # Check common locations
    candidates = [
        # macOS
        '/Applications/LibreOffice.app/Contents/MacOS/soffice',
        # Linux
        '/usr/bin/libreoffice',
        '/usr/bin/soffice',
        '/usr/local/bin/libreoffice',
        '/usr/local/bin/soffice',
        # Snap on Linux
        '/snap/bin/libreoffice',
    ]

    # Check PATH
    soffice_path = shutil.which('soffice')
    if soffice_path:
        return soffice_path

    libreoffice_path = shutil.which('libreoffice')
    if libreoffice_path:
        return libreoffice_path

    # Check common locations
    for candidate in candidates:
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate

    return None


def _find_libreoffice_python(libreoffice_path: str) -> Optional[str]:
    """Find the Python interpreter bundled with LibreOffice.

    Args:
        libreoffice_path: Path to LibreOffice soffice binary.

    Returns:
        Path to LibreOffice's Python interpreter, or None if not found.
    """
    lo_dir = Path(libreoffice_path).parent

    # macOS: /Applications/LibreOffice.app/Contents/MacOS/soffice
    # Python is at: /Applications/LibreOffice.app/Contents/Resources/python
    if 'MacOS' in str(lo_dir):
        python_path = lo_dir.parent / 'Resources' / 'python'
        if python_path.exists():
            return str(python_path)

    # Linux: /usr/bin/libreoffice or /usr/bin/soffice
    # Python with uno is typically the system Python with python3-uno package
    # Check if system Python has uno
    try:
        result = subprocess.run(
            ['python3', '-c', 'import uno'],
            capture_output=True,
            timeout=5
        )
        if result.returncode == 0:
            return 'python3'
    except Exception:
        pass

    return None


def _convert_with_toc_update(
    docx_path: Path,
    output_path: Path,
    libreoffice_path: str
) -> bool:
    """Convert DOCX to PDF with TOC update using LibreOffice Python/UNO.

    This starts LibreOffice with a socket listener, runs a Python script via UNO
    to update all indexes and export to PDF, then terminates LibreOffice.

    Args:
        docx_path: Path to input DOCX file.
        output_path: Path to output PDF file.
        libreoffice_path: Path to LibreOffice soffice binary.

    Returns:
        True if conversion succeeded, False if it failed (caller should fallback).

    Note:
        This approach requires the uno Python module which comes with LibreOffice.
        If uno is not available or the conversion fails, returns False so the
        caller can fall back to the standard conversion method.
    """
    import time

    output_dir = output_path.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    # Find LibreOffice Python first - if not available, skip this method
    lo_python = _find_libreoffice_python(libreoffice_path)
    if lo_python is None:
        return False

    # Create a temporary Python script for the conversion
    script_content = f'''#!/usr/bin/env python3
"""LibreOffice UNO script to update TOC and export to PDF."""
import sys
import time

def main():
    try:
        import uno
        from com.sun.star.beans import PropertyValue
    except ImportError:
        print("ERROR: uno module not available", file=sys.stderr)
        sys.exit(1)

    # Connect to LibreOffice
    max_retries = 30
    for attempt in range(max_retries):
        try:
            localContext = uno.getComponentContext()
            resolver = localContext.ServiceManager.createInstanceWithContext(
                "com.sun.star.bridge.UnoUrlResolver", localContext)
            ctx = resolver.resolve(
                "uno:socket,host=localhost,port=2002;urp;StarOffice.ComponentContext")
            break
        except Exception:
            if attempt < max_retries - 1:
                time.sleep(0.5)
            else:
                print("ERROR: Could not connect to LibreOffice", file=sys.stderr)
                sys.exit(1)

    smgr = ctx.ServiceManager
    desktop = smgr.createInstanceWithContext("com.sun.star.frame.Desktop", ctx)

    # Load document
    doc_url = "file://{docx_path.absolute().as_posix()}"
    load_props = (
        PropertyValue(Name="Hidden", Value=True),
    )
    doc = desktop.loadComponentFromURL(doc_url, "_blank", 0, load_props)

    if doc is None:
        print("ERROR: Could not load document", file=sys.stderr)
        sys.exit(1)

    # Update all indexes (TOC, etc.)
    try:
        if doc.supportsService("com.sun.star.text.GenericTextDocument"):
            indexes = doc.getDocumentIndexes()
            count = indexes.getCount()
            for i in range(count):
                indexes.getByIndex(i).update()
            print(f"Updated {{count}} index(es)")
    except Exception as e:
        print(f"Warning: Could not update indexes: {{e}}", file=sys.stderr)

    # Export to PDF with embedded fonts
    # Create PDF filter data with font embedding options
    pdf_filter_data = (
        PropertyValue(Name="EmbedStandardFonts", Value=True),
        PropertyValue(Name="EmbedLinkedFonts", Value=True),
        PropertyValue(Name="UseTaggedPDF", Value=True),
        PropertyValue(Name="ExportBookmarks", Value=True),
    )
    pdf_props = (
        PropertyValue(Name="FilterName", Value="writer_pdf_Export"),
        PropertyValue(Name="FilterData", Value=pdf_filter_data),
    )
    pdf_url = "file://{output_path.absolute().as_posix()}"
    doc.storeToURL(pdf_url, pdf_props)

    # Close document
    doc.close(True)

    # Terminate LibreOffice
    desktop.terminate()

    print("SUCCESS")

if __name__ == "__main__":
    main()
'''

    # Write the script to a temp file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
        f.write(script_content)
        script_path = f.name

    lo_process = None
    try:
        # Start LibreOffice with socket listener
        lo_process = subprocess.Popen(
            [
                libreoffice_path,
                '--headless',
                '--invisible',
                '--nologo',
                '--nofirststartwizard',
                '--accept=socket,host=localhost,port=2002;urp;'
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )

        # Give LibreOffice time to start
        time.sleep(2)

        # Run the script using LibreOffice's Python
        result = subprocess.run(
            [lo_python, script_path],
            capture_output=True,
            text=True,
            timeout=120
        )

        # Check if successful
        if result.returncode == 0 and output_path.exists():
            return True
        else:
            return False

    except Exception:
        return False

    finally:
        # Clean up
        try:
            os.unlink(script_path)
        except OSError:
            pass
        if lo_process:
            try:
                lo_process.terminate()
                lo_process.wait(timeout=5)
            except Exception:
                try:
                    lo_process.kill()
                except Exception:
                    pass


def _convert_with_local_libreoffice(
    docx_path: Path,
    output_path: Path,
    libreoffice_path: str,
    export_filter: str = 'writer_pdf_Export'
) -> None:
    """Convert a document to PDF using local LibreOffice.

    Args:
        docx_path: Path to input document (DOCX or, with `impress_pdf_Export`,
            PPTX).
        output_path: Path to output PDF file.
        libreoffice_path: Path to LibreOffice soffice binary.
        export_filter: LibreOffice PDF export filter. `writer_pdf_Export` for
            Writer docs (default); `impress_pdf_Export` for Impress decks.

    Raises:
        PDFConversionError: If conversion fails.
    """
    # LibreOffice outputs to the same directory as input by default,
    # or to --outdir if specified. We need to handle this.
    output_dir = output_path.parent
    output_dir.mkdir(parents=True, exist_ok=True)

    # Run LibreOffice in headless mode with font embedding. The export filter
    # is chosen by document type (Writer vs Impress); EmbedStandardFonts is a
    # shared PDF-export option.
    result = subprocess.run(
        [
            libreoffice_path,
            '--headless',
            '--convert-to', f'pdf:{export_filter}:{{"EmbedStandardFonts":{{"type":"boolean","value":"true"}}}}',
            '--outdir', str(output_dir),
            str(docx_path)
        ],
        capture_output=True,
        text=True,
        timeout=120
    )

    if result.returncode != 0:
        raise PDFConversionError(
            f"LibreOffice conversion failed: {result.stderr}"
        )

    # LibreOffice names the output based on input filename
    expected_output = output_dir / f"{docx_path.stem}.pdf"

    if not expected_output.exists():
        raise PDFConversionError(
            f"LibreOffice did not create expected output file: {expected_output}"
        )

    # Rename if needed
    if expected_output != output_path:
        expected_output.rename(output_path)


class PDFConversionError(Exception):
    """Exception raised for PDF conversion errors."""
    pass


@dataclass
class PDFOptions:
    """Options for PDF conversion.

    Attributes:
        pdf_format: PDF format - 'pdf' (standard) or 'pdf/a' (archival).
        page_size: Page size - 'a4' (default), 'letter', etc.
        keep_docx: Keep intermediate DOCX file when converting from MD/AsciiDoc.
    """
    pdf_format: str = 'pdf'
    page_size: str = 'a4'
    keep_docx: bool = True

    def __post_init__(self):
        """Validate options."""
        valid_formats = ('pdf', 'pdf/a')
        if self.pdf_format.lower() not in valid_formats:
            raise ValueError(f"Invalid pdf_format: {self.pdf_format}. Must be one of: {valid_formats}")

        valid_sizes = ('a4', 'letter', 'legal', 'a3', 'a5')
        if self.page_size.lower() not in valid_sizes:
            raise ValueError(f"Invalid page_size: {self.page_size}. Must be one of: {valid_sizes}")


@dataclass
class BatchConversionResult:
    """Result of batch PDF conversion.

    Attributes:
        successful: List of successfully converted file paths.
        failed: Dictionary mapping failed file paths to error messages.
        total: Total number of files processed.
    """
    successful: List[Path] = field(default_factory=list)
    failed: Dict[Path, str] = field(default_factory=dict)
    total: int = 0

    @property
    def success_count(self) -> int:
        """Number of successfully converted files."""
        return len(self.successful)

    @property
    def failure_count(self) -> int:
        """Number of failed conversions."""
        return len(self.failed)


def _send_conversion_request(docx_path: Path, base_url: str) -> bytes:
    """Send DOCX file to Gotenberg server and get PDF bytes.

    Args:
        docx_path: Path to DOCX file.
        base_url: Base URL of the Gotenberg server.

    Returns:
        PDF file content as bytes.

    Raises:
        PDFConversionError: If conversion fails.
    """
    # Gotenberg LibreOffice conversion endpoint
    url = f"{base_url}/forms/libreoffice/convert"

    # Read DOCX file
    docx_content = docx_path.read_bytes()

    # Build multipart form data for Gotenberg
    boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW'
    body = []

    # Add file field (Gotenberg expects 'files' as field name)
    body.append(f'--{boundary}'.encode())
    body.append(f'Content-Disposition: form-data; name="files"; filename="{docx_path.name}"'.encode())
    body.append(b'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    body.append(b'')
    body.append(docx_content)

    body.append(f'--{boundary}--'.encode())

    body_bytes = b'\r\n'.join(body)

    # Create request
    request = urllib.request.Request(
        url,
        data=body_bytes,
        headers={
            'Content-Type': f'multipart/form-data; boundary={boundary}',
            'Content-Length': str(len(body_bytes))
        },
        method='POST'
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            if response.status != 200:
                raise PDFConversionError(f"Conversion failed with status {response.status}")
            return response.read()
    except urllib.error.HTTPError as e:
        raise PDFConversionError(f"Conversion failed: HTTP {e.code} - {e.reason}")
    except urllib.error.URLError as e:
        raise PDFConversionError(f"Connection to PDF server failed: {e.reason}")
    except TimeoutError:
        raise PDFConversionError("Conversion timed out after 120 seconds")


def convert_docx_to_pdf(
    input_path: Union[str, Path],
    output_path: Union[str, Path],
    pdf_format: str = 'pdf',
    page_size: str = 'a4',
    use_docker: bool = False,
    update_toc: bool = True
) -> None:
    """Convert DOCX file to PDF.

    Prefers local LibreOffice installation for better table rendering compatibility.
    Falls back to Docker-based Gotenberg service if local LibreOffice is not available.

    Args:
        input_path: Path to input DOCX file.
        output_path: Path to output PDF file.
        pdf_format: PDF format - 'pdf' (standard) or 'pdf/a' (archival).
        page_size: Page size - 'a4' (default), 'letter', etc.
        use_docker: Force use of Docker/Gotenberg even if local LibreOffice is available.
        update_toc: Update Table of Contents before PDF export (default: True).
            This ensures page numbers in the TOC are correct. Requires LibreOffice
            Python/UNO support. If unavailable, falls back to standard conversion.

    Raises:
        FileNotFoundError: If input file does not exist.
        PDFServerError: If Docker/server is not available and no local LibreOffice.
        PDFConversionError: If conversion fails.
    """
    input_path = Path(input_path)
    output_path = Path(output_path)

    # Validate input
    if not input_path.exists():
        raise FileNotFoundError(f"Input file does not exist: {input_path}")

    # Validate options
    options = PDFOptions(pdf_format=pdf_format, page_size=page_size)

    # Try local LibreOffice first (better table rendering compatibility)
    if not use_docker:
        libreoffice_path = find_local_libreoffice()
        if libreoffice_path:
            # First try with TOC update if requested (uses UNO API for proper page numbers)
            if update_toc and _convert_with_toc_update(input_path, output_path, libreoffice_path):
                return
            # Fall back to standard conversion if TOC update not requested or fails
            _convert_with_local_libreoffice(input_path, output_path, libreoffice_path)
            return

    # Fall back to Docker/Gotenberg
    server = get_server()
    base_url = server.ensure_running()

    # Convert
    pdf_bytes = _send_conversion_request(input_path, base_url)

    # Write output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(pdf_bytes)


def convert_md_to_pdf(
    input_path: Union[str, Path],
    output_path: Union[str, Path],
    keep_docx: bool = True,
    pdf_format: str = 'pdf',
    page_size: str = 'a4',
    template_name: Optional[str] = None,
    templates_dir: Optional[Union[str, Path]] = None,
    **md_kwargs
) -> Path:
    """Convert Markdown file to PDF via intermediate DOCX.

    Args:
        input_path: Path to input Markdown file.
        output_path: Path to output PDF file.
        keep_docx: Keep intermediate DOCX file (default: True).
        pdf_format: PDF format - 'pdf' (standard) or 'pdf/a' (archival).
        page_size: Page size - 'a4' (default), 'letter', etc.
        template_name: Optional template name for DOCX conversion.
        templates_dir: Directory containing templates.
        **md_kwargs: Additional arguments passed to convert_md_to_docx.

    Returns:
        Path to intermediate DOCX file (if keep_docx=True) or None.

    Raises:
        FileNotFoundError: If input file does not exist.
        PDFServerError: If Docker/server is not available.
        PDFConversionError: If conversion fails.
    """
    from .converter import convert_md_to_docx

    input_path = Path(input_path)
    output_path = Path(output_path)

    # Validate input
    if not input_path.exists():
        raise FileNotFoundError(f"Input file does not exist: {input_path}")

    # Determine intermediate DOCX path
    docx_path = output_path.with_suffix('.docx')

    try:
        # Convert MD to DOCX
        convert_md_to_docx(
            input_path,
            docx_path,
            template_name=template_name,
            templates_dir=templates_dir,
            **md_kwargs
        )

        # Convert DOCX to PDF
        convert_docx_to_pdf(
            docx_path,
            output_path,
            pdf_format=pdf_format,
            page_size=page_size
        )

        return docx_path if keep_docx else None

    finally:
        # Clean up intermediate file if not keeping
        if not keep_docx and docx_path.exists():
            docx_path.unlink()


def convert_adoc_to_pdf(
    input_path: Union[str, Path],
    output_path: Union[str, Path],
    keep_docx: bool = True,
    pdf_format: str = 'pdf',
    page_size: str = 'a4',
    template_path: Optional[Union[str, Path]] = None,
    **adoc_kwargs
) -> Path:
    """Convert AsciiDoc file to PDF via intermediate DOCX.

    Args:
        input_path: Path to input AsciiDoc file.
        output_path: Path to output PDF file.
        keep_docx: Keep intermediate DOCX file (default: True).
        pdf_format: PDF format - 'pdf' (standard) or 'pdf/a' (archival).
        page_size: Page size - 'a4' (default), 'letter', etc.
        template_path: Optional path to DOCX template for styling.
        **adoc_kwargs: Additional arguments passed to convert_adoc_to_docx.

    Returns:
        Path to intermediate DOCX file (if keep_docx=True) or None.

    Raises:
        FileNotFoundError: If input file does not exist.
        PDFServerError: If Docker/server is not available.
        PDFConversionError: If conversion fails.
    """
    from .asciidoc_converter import convert_adoc_to_docx

    input_path = Path(input_path)
    output_path = Path(output_path)

    # Validate input
    if not input_path.exists():
        raise FileNotFoundError(f"Input file does not exist: {input_path}")

    # Determine intermediate DOCX path
    docx_path = output_path.with_suffix('.docx')

    try:
        # Convert AsciiDoc to DOCX
        convert_adoc_to_docx(
            input_path,
            docx_path,
            template_path=template_path,
            **adoc_kwargs
        )

        # Convert DOCX to PDF
        convert_docx_to_pdf(
            docx_path,
            output_path,
            pdf_format=pdf_format,
            page_size=page_size
        )

        return docx_path if keep_docx else None

    finally:
        # Clean up intermediate file if not keeping
        if not keep_docx and docx_path.exists():
            docx_path.unlink()


def convert_to_pdf(
    input_path: Union[str, Path],
    output_path: Union[str, Path],
    keep_docx: bool = True,
    pdf_format: str = 'pdf',
    page_size: str = 'a4',
    **kwargs
) -> Optional[Path]:
    """Convert document to PDF with automatic format detection.

    Detects input format based on file extension and uses the appropriate
    converter (DOCX, Markdown, or AsciiDoc).

    Args:
        input_path: Path to input file (.docx, .md, .markdown, .adoc, .asciidoc, .asc).
        output_path: Path to output PDF file.
        keep_docx: Keep intermediate DOCX file when converting from MD/AsciiDoc.
        pdf_format: PDF format - 'pdf' (standard) or 'pdf/a' (archival).
        page_size: Page size - 'a4' (default), 'letter', etc.
        **kwargs: Additional arguments passed to the specific converter.

    Returns:
        Path to intermediate DOCX file (if applicable and keep_docx=True) or None.

    Raises:
        FileNotFoundError: If input file does not exist.
        ValueError: If input format cannot be detected.
        PDFServerError: If Docker/server is not available.
        PDFConversionError: If conversion fails.
    """
    input_path = Path(input_path)
    ext = input_path.suffix.lower()

    if ext == '.docx':
        convert_docx_to_pdf(
            input_path,
            output_path,
            pdf_format=pdf_format,
            page_size=page_size
        )
        return None

    elif ext == '.pptx':
        convert_pptx_to_pdf(input_path, output_path)
        return None

    elif ext in ('.md', '.markdown'):
        return convert_md_to_pdf(
            input_path,
            output_path,
            keep_docx=keep_docx,
            pdf_format=pdf_format,
            page_size=page_size,
            **kwargs
        )

    elif ext in ('.adoc', '.asciidoc', '.asc'):
        return convert_adoc_to_pdf(
            input_path,
            output_path,
            keep_docx=keep_docx,
            pdf_format=pdf_format,
            page_size=page_size,
            **kwargs
        )

    else:
        raise ValueError(
            f"Cannot detect format for file: {input_path}. "
            "Supported extensions: .docx, .pptx, .md, .markdown, .adoc, .asciidoc, .asc"
        )


def convert_pptx_to_pdf(
    input_path: Union[str, Path],
    output_path: Union[str, Path],
) -> None:
    """Convert a PPTX deck to PDF.

    Uses local LibreOffice with the Impress export filter (faithful slide
    layout, fonts, charts). Falls back to the Docker/Gotenberg LibreOffice route
    when no local soffice is present.

    Args:
        input_path: Path to input PPTX file.
        output_path: Path to output PDF file.

    Raises:
        FileNotFoundError: If input file does not exist.
        PDFServerError: If Docker/server is not available and no local LibreOffice.
        PDFConversionError: If conversion fails.
    """
    input_path = Path(input_path)
    output_path = Path(output_path)

    if not input_path.exists():
        raise FileNotFoundError(f"Input file does not exist: {input_path}")

    libreoffice_path = find_local_libreoffice()
    if libreoffice_path:
        _convert_with_local_libreoffice(
            input_path, output_path, libreoffice_path, export_filter='impress_pdf_Export'
        )
        return

    # Fall back to Docker/Gotenberg (its LibreOffice route handles pptx too).
    server = get_server()
    base_url = server.ensure_running()
    pdf_bytes = _send_conversion_request(input_path, base_url)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(pdf_bytes)


def batch_convert_to_pdf(
    input_paths: List[Union[str, Path]],
    output_dir: Union[str, Path],
    keep_docx: bool = True,
    pdf_format: str = 'pdf',
    page_size: str = 'a4',
    **kwargs
) -> BatchConversionResult:
    """Convert multiple files to PDF.

    Args:
        input_paths: List of input file paths.
        output_dir: Directory for output PDF files.
        keep_docx: Keep intermediate DOCX files when converting from MD/AsciiDoc.
        pdf_format: PDF format - 'pdf' (standard) or 'pdf/a' (archival).
        page_size: Page size - 'a4' (default), 'letter', etc.
        **kwargs: Additional arguments passed to converters.

    Returns:
        BatchConversionResult with lists of successful and failed conversions.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    result = BatchConversionResult(total=len(input_paths))

    for input_path in input_paths:
        input_path = Path(input_path)
        output_path = output_dir / f"{input_path.stem}.pdf"

        try:
            convert_to_pdf(
                input_path,
                output_path,
                keep_docx=keep_docx,
                pdf_format=pdf_format,
                page_size=page_size,
                **kwargs
            )
            result.successful.append(output_path)
        except Exception as e:
            result.failed[input_path] = str(e)

    return result
