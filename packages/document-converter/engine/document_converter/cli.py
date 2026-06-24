"""Command-line interface for document converter."""
import argparse
import glob
import logging
import sys
from pathlib import Path

from .converter import convert_md_to_docx
from .manifest_manager import (
    save_manifest_to_both_locations,
    resolve_template_name
)
from .variable_manager import (
    get_properties_path,
    load_properties_file,
    save_properties_file,
    resolve_variables
)
from .frontmatter_parser import parse_frontmatter, extract_template_config, extract_variables

logger = logging.getLogger(__name__)


def add_common_args(parser: argparse.ArgumentParser) -> None:
    """Add common arguments to a parser."""
    parser.add_argument(
        '--templates-dir',
        type=str,
        default=None,
        help='Path to templates directory (default: ./templates)'
    )


def cmd_convert(args: argparse.Namespace) -> int:
    """Handle the convert command (MD to DOCX)."""
    from .template_manager import resolve_templates_dir

    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        print(f"Error: Input file not found: {args.input}", file=sys.stderr)
        return 1

    # Parse frontmatter if not ignored
    frontmatter = {}
    fm_template_config = {}
    if not getattr(args, 'ignore_frontmatter', False):
        content = input_path.read_text(encoding='utf-8')
        frontmatter, _ = parse_frontmatter(content, format='markdown')
        fm_template_config = extract_template_config(frontmatter)

        if frontmatter:
            logger.info(f"Frontmatter parsed: {len(frontmatter)} keys")

    # Resolve template name using fallback chain:
    # 1. CLI argument (--template-name)
    # 2. Frontmatter template
    # 3. Markdown manifest (if exists)
    # 4. Associated DOCX manifest (if exists)
    template_name = args.template_name
    if template_name is None and fm_template_config.get('template'):
        template_name = fm_template_config['template']
        print(f"Using template from frontmatter: {template_name}")

    if template_name is None:
        template_name = resolve_template_name(
            md_path=input_path,
            docx_path=output_path if output_path.suffix == '.docx' else None,
            cli_template=None
        )

    print(f"Converting: {args.input}")
    print(f"Output: {args.output}")
    if args.document_name:
        print(f"Document Name: {args.document_name}")
    if args.document_title:
        print(f"Document Title: {args.document_title}")
    if template_name:
        source = "(CLI)" if args.template_name else "(from frontmatter/manifest)"
        print(f"Template: {template_name} {source}")
    if args.template_path:
        print(f"Template Path: {args.template_path}")
    if getattr(args, 'language', None):
        print(f"Language: {args.language}")

    # Handle variable resolution if using a template
    variables = {}

    # First, extract variables from frontmatter (if not ignoring frontmatter)
    frontmatter_vars = {}
    if not getattr(args, 'ignore_frontmatter', False):
        try:
            content = input_path.read_text(encoding='utf-8')
            frontmatter, _ = parse_frontmatter(content)
            frontmatter_vars = extract_variables(frontmatter)
            if frontmatter_vars:
                print(f"Frontmatter variables: {len(frontmatter_vars)}")
        except Exception as e:
            print(f"Warning: Could not parse frontmatter: {e}")

    if template_name and not args.template_path:
        templates_dir = resolve_templates_dir(args.templates_dir)
        template_dir = templates_dir / template_name

        if template_dir.exists():
            # Load properties file if it exists
            properties_path = get_properties_path(input_path)
            interactive = not getattr(args, 'non_interactive', False)

            try:
                # Get template defaults, but frontmatter vars take priority
                template_vars = resolve_variables(
                    template_dir=template_dir,
                    properties_path=properties_path,
                    interactive=interactive,
                    provided=frontmatter_vars  # Pass frontmatter vars as already provided
                )
                # Merge: frontmatter > template defaults
                variables = {**template_vars, **frontmatter_vars}
                if variables:
                    print(f"Variables loaded: {len(variables)}")
            except Exception as e:
                print(f"Warning: Could not load variables: {e}")
                variables = frontmatter_vars
    else:
        variables = frontmatter_vars

    print()

    try:
        convert_md_to_docx(
            input_path=args.input,
            output_path=args.output,
            template_path=args.template_path,
            template_name=template_name,
            templates_dir=args.templates_dir,
            document_name=args.document_name,
            document_title=args.document_title,
            font_name=args.font,
            fonts_dir=args.fonts_dir,
            diagram_width=args.diagram_width,
            diagram_scale=args.diagram_scale,
            diagram_format=args.diagram_format,
            embed_svg_in_word=args.embed_svg_in_word,
            debug=args.debug,
            variables=variables,
            embed_fonts=not args.no_embed_fonts,
            update_fields=args.update_fields,
            enable_code_render=not getattr(args, 'no_code_render', False),
            enable_tree_render=not getattr(args, 'no_tree_render', False),
            code_theme=getattr(args, 'code_theme', None),
            code_line_numbers=getattr(args, 'code_line_numbers', False)
        )

        # Save manifest to both locations with template name
        if template_name:
            features = {'variables': bool(variables)}
            save_manifest_to_both_locations(
                source_path=input_path,
                output_path=output_path,
                template_name=template_name,
                features=features
            )

        print(f"Conversion successful!")
        print(f"  Output saved to: {args.output}")
        if template_name:
            manifest_path = output_path.parent / f"{output_path.stem}_manifest.xml"
            print(f"  Manifest saved to: {manifest_path}")
        if args.debug:
            debug_path = Path(args.output).with_name(f"{Path(args.output).stem}_debug.md")
            print(f"  Debug markdown saved to: {debug_path}")
        return 0
    except Exception as e:
        print(f"Conversion failed: {e}", file=sys.stderr)
        return 1


def cmd_extract(args: argparse.Namespace) -> int:
    """Handle the extract command (DOCX to MD)."""
    from .docx_reader import convert_docx_to_md

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"Error: Input file not found: {args.input}", file=sys.stderr)
        return 1

    print(f"Extracting: {args.input}")
    print(f"Output: {args.output}")
    if args.include_meta:
        print("Including metadata file")
    print()

    try:
        result = convert_docx_to_md(
            input_path=input_path,
            output_path=Path(args.output),
            include_meta=args.include_meta,
            extract_images=True
        )
        print(f"Extraction successful!")
        print(f"  Markdown saved to: {args.output}")
        if args.include_meta:
            meta_path = Path(args.output).parent / f"{Path(args.output).stem}_meta.xml"
            print(f"  Metadata saved to: {meta_path}")
        if result.images:
            images_dir = Path(args.output).parent / f"{Path(args.output).stem}_images"
            print(f"  Images extracted to: {images_dir}/")
        return 0
    except Exception as e:
        print(f"Extraction failed: {e}", file=sys.stderr)
        return 1


def cmd_merge(args: argparse.Namespace) -> int:
    """Handle the merge command (round-trip editing)."""
    from .round_trip import merge_md_to_docx

    original = Path(args.original)
    edited = Path(args.edited)

    if not original.exists():
        print(f"Error: Original DOCX not found: {args.original}", file=sys.stderr)
        return 1
    if not edited.exists():
        print(f"Error: Edited Markdown not found: {args.edited}", file=sys.stderr)
        return 1

    print(f"Merging: {args.edited} into {args.original}")
    print(f"Output: {args.output}")
    print()

    try:
        result = merge_md_to_docx(
            original_docx=original,
            edited_md=edited,
            output_path=Path(args.output),
            meta_path=Path(args.meta) if args.meta else None
        )
        print(f"Merge successful!")
        print(f"  Output saved to: {args.output}")
        print(f"  Changes applied: {len(result.changes_applied)}")
        if result.warnings:
            print("  Warnings:")
            for warning in result.warnings:
                print(f"    - {warning}")
        return 0
    except Exception as e:
        print(f"Merge failed: {e}", file=sys.stderr)
        return 1


def cmd_create_template(args: argparse.Namespace) -> int:
    """Handle the create-template command."""
    from .template_extractor import create_template

    source = Path(args.source)
    if not source.exists():
        print(f"Error: Source file not found: {args.source}", file=sys.stderr)
        return 1

    print(f"Creating template from: {args.source}")
    print(f"Template name: {args.name}")
    if args.templates_dir:
        print(f"Templates directory: {args.templates_dir}")
    if args.no_cover_page:
        print("Cover page: disabled")
    elif args.cover_boundary:
        print(f"Cover page boundary: paragraph {args.cover_boundary}")
    print()

    # Parse cover boundary if provided
    cover_boundary = None
    if args.cover_boundary:
        try:
            cover_boundary = int(args.cover_boundary) - 1  # Convert to 0-based
        except ValueError:
            print(f"Error: Invalid cover boundary: {args.cover_boundary}", file=sys.stderr)
            return 1

    try:
        template_path = create_template(
            source_docx=source,
            template_name=args.name,
            templates_dir=Path(args.templates_dir) if args.templates_dir else None,
            interactive=not args.non_interactive,
            include_cover_page=not args.no_cover_page,
            cover_boundary=cover_boundary
        )
        print(f"\nTemplate created successfully!")
        print(f"  Location: {template_path}/")
        return 0
    except Exception as e:
        print(f"Template creation failed: {e}", file=sys.stderr)
        return 1


def cmd_analyze(args: argparse.Namespace) -> int:
    """Handle the analyze command (analyze DOCX for template variables)."""
    from .template_extractor import analyze_document_for_variables

    input_path = Path(args.input)

    if not input_path.exists():
        print(f"Error: Input file not found: {args.input}", file=sys.stderr)
        return 1

    print(f"Analyzing: {args.input}")
    print()

    try:
        analysis = analyze_document_for_variables(input_path)

        if args.json:
            import json
            result = {
                'source_file': analysis.source_file,
                'paragraph_count': analysis.paragraph_count,
                'has_cover_page': analysis.has_cover_page,
                'cover_boundary': analysis.cover_boundary,
                'has_different_first_page_header': analysis.has_different_first_page_header,
                'candidates': [
                    {
                        'id': c.id,
                        'category': c.category,
                        'category_label': c.category_label,
                        'content': c.content,
                        'suggested_name': c.suggested_name,
                        'description': c.description,
                    }
                    for c in analysis.candidates
                ]
            }
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            analysis.print_summary()

            # Print additional info
            print(f"\nDocument Info:")
            print(f"  Paragraphs: {analysis.paragraph_count}")
            print(f"  Cover page detected: {'Yes' if analysis.has_cover_page else 'No'}")
            if analysis.cover_boundary is not None:
                print(f"  Cover boundary: paragraph {analysis.cover_boundary + 1}")
            print(f"  Different first page header: {'Yes' if analysis.has_different_first_page_header else 'No'}")
            print(f"  Variable candidates: {len(analysis.candidates)}")

        return 0

    except Exception as e:
        print(f"Error analyzing document: {e}", file=sys.stderr)
        return 1


def cmd_list_templates(args: argparse.Namespace) -> int:
    """Handle the list-templates command."""
    from .template_manager import list_templates

    templates = list_templates(
        templates_dir=Path(args.templates_dir) if args.templates_dir else None
    )

    if not templates:
        print("No templates found.")
        if not args.templates_dir:
            print("  (Looking in ./templates/)")
        else:
            print(f"  (Looking in {args.templates_dir}/)")
        return 0

    print("Available templates:")
    print()
    for template in templates:
        name = template['name']
        desc = template.get('description', '')
        has_vars = template.get('has_variables', False)
        var_indicator = " [has variables]" if has_vars else ""

        print(f"  {name}{var_indicator}")
        if desc:
            print(f"    {desc}")

    return 0


def cmd_convert_pdf(args: argparse.Namespace) -> int:
    """Handle the convert-pdf command."""
    from .pdf_converter import (
        convert_to_pdf,
        batch_convert_to_pdf,
        PDFConversionError
    )
    from .pdf_server import PDFServerError

    # Collect input files
    input_files = []

    for pattern in args.inputs:
        # Check if it's a glob pattern
        if '*' in pattern or '?' in pattern:
            matches = glob.glob(pattern, recursive=True)
            input_files.extend(Path(m) for m in matches)
        else:
            input_files.append(Path(pattern))

    if not input_files:
        print("Error: No input files found.", file=sys.stderr)
        return 1

    # Validate all input files exist
    missing = [f for f in input_files if not f.exists()]
    if missing:
        for f in missing:
            print(f"Error: File not found: {f}", file=sys.stderr)
        return 1

    # Determine if batch mode
    is_batch = len(input_files) > 1 or args.output_dir

    # Build options
    pdf_format = args.pdf_format or 'pdf'
    page_size = args.page_size or 'a4'
    keep_docx = not args.no_keep_docx

    try:
        if is_batch:
            # Batch conversion mode
            output_dir = Path(args.output_dir) if args.output_dir else Path('.')

            print(f"Batch converting {len(input_files)} file(s) to PDF...")
            print(f"Output directory: {output_dir}")
            print(f"PDF format: {pdf_format}")
            print(f"Page size: {page_size}")
            print(f"Keep intermediate DOCX: {'Yes' if keep_docx else 'No'}")
            print()

            # Build kwargs for MD/AsciiDoc conversion
            kwargs = {}
            if args.template:
                kwargs['template_name'] = args.template
            if args.templates_dir:
                kwargs['templates_dir'] = args.templates_dir

            result = batch_convert_to_pdf(
                input_paths=input_files,
                output_dir=output_dir,
                keep_docx=keep_docx,
                pdf_format=pdf_format,
                page_size=page_size,
                **kwargs
            )

            # Report results
            print(f"Conversion complete!")
            print(f"  Successful: {result.success_count}/{result.total}")

            if result.successful:
                for pdf_path in result.successful:
                    print(f"    - {pdf_path}")

            if result.failed:
                print(f"  Failed: {result.failure_count}/{result.total}")
                for input_path, error in result.failed.items():
                    print(f"    - {input_path}: {error}")
                return 1

            return 0

        else:
            # Single file conversion
            input_path = input_files[0]

            # Determine output path
            if args.output:
                output_path = Path(args.output)
            else:
                output_path = input_path.with_suffix('.pdf')

            print(f"Converting: {input_path}")
            print(f"Output: {output_path}")
            print(f"PDF format: {pdf_format}")
            print(f"Page size: {page_size}")

            ext = input_path.suffix.lower()
            if ext != '.docx':
                print(f"Keep intermediate DOCX: {'Yes' if keep_docx else 'No'}")

            if args.template:
                print(f"Template: {args.template}")
            print()

            # Build kwargs for MD/AsciiDoc conversion
            kwargs = {}
            if args.template:
                kwargs['template_name'] = args.template
            if args.templates_dir:
                kwargs['templates_dir'] = args.templates_dir

            docx_path = convert_to_pdf(
                input_path=input_path,
                output_path=output_path,
                keep_docx=keep_docx,
                pdf_format=pdf_format,
                page_size=page_size,
                **kwargs
            )

            print("Conversion successful!")
            print(f"  PDF saved to: {output_path}")
            if docx_path:
                print(f"  DOCX saved to: {docx_path}")

            return 0

    except PDFServerError as e:
        print(f"PDF Server Error: {e}", file=sys.stderr)
        print("  Make sure Docker is installed and running.", file=sys.stderr)
        return 1
    except PDFConversionError as e:
        print(f"Conversion Error: {e}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


def main():
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(
        description='Document Converter - Convert between Markdown and DOCX formats',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # Convert command (MD to DOCX)
    convert_parser = subparsers.add_parser(
        'convert',
        help='Convert Markdown to DOCX',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  document-converter convert input.md output.docx
  document-converter convert input.md output.docx --template-name corporate
  document-converter convert input.md output.docx --document-name "Project X"
        """
    )
    convert_parser.add_argument('input', type=str, help='Input Markdown file')
    convert_parser.add_argument('output', type=str, help='Output DOCX file')
    convert_parser.add_argument('--template-path', type=str, default=None,
                                help='Path to DOCX template file')
    convert_parser.add_argument('--template-name', type=str, default=None,
                                help='Name of template from templates directory')
    convert_parser.add_argument('--document-name', type=str, default=None,
                                help='Document name for template placeholder')
    convert_parser.add_argument('--document-title', type=str, default=None,
                                help='Document title for template placeholder')
    convert_parser.add_argument('--font', type=str, default='Source Sans Pro',
                                help='Default font name')
    convert_parser.add_argument('--fonts-dir', type=str, default=None,
                                help='Path to fonts directory')
    convert_parser.add_argument('--diagram-width', type=int, default=1200,
                                help='Maximum diagram width in pixels')
    convert_parser.add_argument('--diagram-scale', type=int, default=2,
                                help='Diagram scale factor')
    convert_parser.add_argument('--diagram-format', type=str, default='png',
                                choices=['png', 'svg', 'auto'],
                                help='Diagram output format (default: png). "auto" uses SVG for HTML/Markdown, PNG for DOCX.')
    convert_parser.add_argument('--embed-svg-in-word', action='store_true',
                                help='[EXPERIMENTAL] Embed SVG directly in Word (requires Word 2016+). Only applies with --diagram-format svg.')
    convert_parser.add_argument('--no-code-render', action='store_true',
                                help='Disable rendering code blocks as syntax-highlighted images')
    convert_parser.add_argument('--no-tree-render', action='store_true',
                                help='Disable rendering ASCII trees as images')
    convert_parser.add_argument('--code-theme', type=str, default=None,
                                help='Pygments theme for code highlighting (default: "default")')
    convert_parser.add_argument('--code-line-numbers', action='store_true',
                                help='Show line numbers in code blocks')
    convert_parser.add_argument('--debug', action='store_true',
                                help='Save debug markdown file')
    convert_parser.add_argument('--non-interactive', action='store_true',
                                help='Use default values for missing template variables')
    convert_parser.add_argument('--no-embed-fonts', action='store_true',
                                help='Do not embed fonts into the DOCX file (fonts embedded by default)')
    convert_parser.add_argument('--ignore-frontmatter', action='store_true',
                                help='Ignore YAML frontmatter in source file')
    convert_parser.add_argument('--language', type=str, default=None,
                                help='Language code for date formatting (e.g., en, hu, de, fr)')
    # Field update options (mutually exclusive)
    field_update_group = convert_parser.add_mutually_exclusive_group()
    field_update_group.add_argument('--update-fields', action='store_true', dest='update_fields',
                                    help='Update field codes (TOC, page numbers) after generation. Requires LibreOffice.')
    field_update_group.add_argument('--no-update-fields', action='store_false', dest='update_fields',
                                    help='Do not update field codes (default: auto-update when TOC is enabled)')
    convert_parser.set_defaults(update_fields=None)  # None = auto (update if TOC enabled)
    add_common_args(convert_parser)

    # Extract command (DOCX to MD)
    extract_parser = subparsers.add_parser(
        'extract',
        help='Extract Markdown from DOCX',
        epilog="""
Examples:
  document-converter extract document.docx output.md
  document-converter extract document.docx output.md --include-meta
        """
    )
    extract_parser.add_argument('input', type=str, help='Input DOCX file')
    extract_parser.add_argument('output', type=str, help='Output Markdown file')
    extract_parser.add_argument('--include-meta', action='store_true',
                                help='Generate metadata XML file for round-trip editing')
    add_common_args(extract_parser)

    # Merge command (round-trip)
    merge_parser = subparsers.add_parser(
        'merge',
        help='Merge edited Markdown back into DOCX',
        epilog="""
Examples:
  document-converter merge original.docx edited.md output.docx
        """
    )
    merge_parser.add_argument('original', type=str, help='Original DOCX file')
    merge_parser.add_argument('edited', type=str, help='Edited Markdown file')
    merge_parser.add_argument('output', type=str, help='Output DOCX file')
    merge_parser.add_argument('--meta', type=str, default=None,
                              help='Path to metadata file (auto-detected if not specified)')
    add_common_args(merge_parser)

    # Create-template command
    template_parser = subparsers.add_parser(
        'create-template',
        help='Create a template from an existing DOCX',
        epilog="""
Examples:
  document-converter create-template report.docx --name corporate-report
  document-converter create-template report.docx --name corporate --templates-dir /shared/templates
        """
    )
    template_parser.add_argument('source', type=str, help='Source DOCX file')
    template_parser.add_argument('--name', type=str, required=True,
                                 help='Name for the template')
    template_parser.add_argument('--non-interactive', action='store_true',
                                 help='Skip interactive variable selection')
    template_parser.add_argument('--no-cover-page', action='store_true',
                                 help='Do not include cover page in template')
    template_parser.add_argument('--cover-boundary', type=str, default=None,
                                 help='Paragraph number where cover page ends (e.g., "5")')
    add_common_args(template_parser)

    # Analyze command
    analyze_parser = subparsers.add_parser(
        'analyze',
        help='Analyze DOCX for potential template variables',
        epilog="""
Examples:
  document-converter analyze proposal.docx
  document-converter analyze proposal.docx --json
        """
    )
    analyze_parser.add_argument('input', type=str, help='Input DOCX file to analyze')
    analyze_parser.add_argument('--json', action='store_true',
                                help='Output results as JSON')

    # List-templates command
    list_parser = subparsers.add_parser(
        'list-templates',
        help='List available templates'
    )
    add_common_args(list_parser)

    # Convert-pdf command
    pdf_parser = subparsers.add_parser(
        'convert-pdf',
        help='Convert documents to PDF',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Single file conversion
  document-converter convert-pdf input.docx output.pdf
  document-converter convert-pdf input.md output.pdf
  document-converter convert-pdf input.adoc output.pdf

  # With options
  document-converter convert-pdf input.docx output.pdf --pdf-format pdf/a
  document-converter convert-pdf input.md output.pdf --page-size letter

  # Batch conversion
  document-converter convert-pdf "*.docx" --output-dir ./pdfs
  document-converter convert-pdf file1.md file2.adoc --output-dir ./pdfs

  # With template for Markdown/AsciiDoc
  document-converter convert-pdf input.md output.pdf --template corporate
        """
    )
    pdf_parser.add_argument('inputs', nargs='+',
                            help='Input file(s) or glob pattern (e.g., "*.docx")')
    pdf_parser.add_argument('output', nargs='?', default=None,
                            help='Output PDF file (for single file conversion)')
    pdf_parser.add_argument('--output-dir', type=str, default=None,
                            help='Output directory for batch conversion')
    pdf_parser.add_argument('--pdf-format', type=str, choices=['pdf', 'pdf/a'],
                            default='pdf', help='PDF format (default: pdf)')
    pdf_parser.add_argument('--page-size', type=str, choices=['a4', 'letter', 'legal', 'a3', 'a5'],
                            default='a4', help='Page size (default: a4)')
    pdf_parser.add_argument('--no-keep-docx', action='store_true',
                            help='Delete intermediate DOCX file after conversion')
    pdf_parser.add_argument('--template', type=str, default=None,
                            help='Template name for Markdown/AsciiDoc conversion')
    pdf_parser.add_argument('--diagram-format', type=str, default='png',
                            choices=['png', 'svg', 'auto'],
                            help='Diagram output format (default: png)')
    add_common_args(pdf_parser)

    # Parse arguments
    args = parser.parse_args()

    # Handle no command (backward compatibility - treat as convert)
    if args.command is None:
        # Check if old-style positional args were provided
        if len(sys.argv) > 1 and not sys.argv[1].startswith('-'):
            # Backward compatibility: treat as convert command
            print("Note: Using legacy syntax. Consider using 'document-converter convert' instead.")
            # Re-parse with convert command
            sys.argv.insert(1, 'convert')
            args = parser.parse_args()
        else:
            parser.print_help()
            return 0

    # Dispatch to command handler
    handlers = {
        'convert': cmd_convert,
        'extract': cmd_extract,
        'merge': cmd_merge,
        'create-template': cmd_create_template,
        'analyze': cmd_analyze,
        'list-templates': cmd_list_templates,
        'convert-pdf': cmd_convert_pdf,
    }

    handler = handlers.get(args.command)
    if handler:
        return handler(args)
    else:
        parser.print_help()
        return 0


if __name__ == '__main__':
    sys.exit(main())
