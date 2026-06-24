"""Utility functions for document converter."""
import subprocess
from pathlib import Path
import tempfile
import shutil
from typing import Dict, List, Tuple


def check_dependencies() -> bool:
    """Check if required external dependencies are installed.

    Returns:
        bool: True if mmdc (Mermaid CLI) is available, False otherwise.
    """
    try:
        subprocess.run(
            ['mmdc', '--version'],
            capture_output=True,
            text=True
        )
        return True
    except FileNotFoundError:
        return False


def check_all_dependencies() -> Dict[str, bool]:
    """Check all external dependencies and return their status.

    Returns:
        Dict mapping dependency name to availability status.
    """
    dependencies = {}

    # Check mmdc (Mermaid CLI)
    try:
        subprocess.run(['mmdc', '--version'], capture_output=True, text=True)
        dependencies['mmdc'] = True
    except FileNotFoundError:
        dependencies['mmdc'] = False

    # Check pandoc
    try:
        subprocess.run(['pandoc', '--version'], capture_output=True, text=True)
        dependencies['pandoc'] = True
    except FileNotFoundError:
        dependencies['pandoc'] = False

    return dependencies


def get_missing_dependencies() -> List[Tuple[str, str]]:
    """Get list of missing dependencies with installation instructions.

    Returns:
        List of tuples (dependency_name, installation_instructions).
    """
    deps = check_all_dependencies()
    missing = []

    if not deps.get('mmdc'):
        missing.append((
            'mmdc (Mermaid CLI)',
            'npm install -g @mermaid-js/mermaid-cli'
        ))

    if not deps.get('pandoc'):
        missing.append((
            'pandoc',
            'macOS: brew install pandoc\n'
            '  Linux (Debian/Ubuntu): sudo apt-get install pandoc\n'
            '  Linux (Fedora): sudo dnf install pandoc\n'
            '  Or download from: https://pandoc.org/installing.html'
        ))

    return missing


def print_dependency_status() -> bool:
    """Print dependency status and return True if all are installed.

    Returns:
        bool: True if all dependencies are available.
    """
    deps = check_all_dependencies()
    all_ok = True

    print("Dependency Status:")
    print("-" * 40)

    for name, installed in deps.items():
        status = "✓ installed" if installed else "✗ MISSING"
        print(f"  {name}: {status}")
        if not installed:
            all_ok = False

    if not all_ok:
        print("\nInstallation Instructions:")
        print("-" * 40)
        for name, instructions in get_missing_dependencies():
            print(f"\n{name}:")
            print(f"  {instructions}")

    return all_ok


def validate_file(path: Path) -> bool:
    """Validate that a file exists and is readable.

    Args:
        path: Path to the file to validate.

    Returns:
        bool: True if file exists and is readable, False otherwise.
    """
    return path.exists() and path.is_file() and path.stat().st_size > 0


def create_temp_dir() -> Path:
    """Create a temporary directory for intermediate files.

    Returns:
        Path: Path to the created temporary directory.
    """
    return Path(tempfile.mkdtemp(prefix='docconv_'))


def cleanup_temp_files(temp_dir: Path) -> None:
    """Remove temporary directory and all its contents.

    Args:
        temp_dir: Path to temporary directory to remove.
    """
    if temp_dir.exists() and temp_dir.is_dir():
        shutil.rmtree(temp_dir)
