"""Spacing configuration module for headings and diagrams.

Provides dataclasses and functions for configuring paragraph spacing
for headings (H1-H6) and diagrams/images.

Frontmatter example:
```yaml
spacing:
  # Heading spacing (in points)
  headings:
    h1:
      before: 24
      after: 12
    h2:
      before: 18
      after: 10
    h3:
      before: 14
      after: 8
    h4:
      before: 12
      after: 6
    h5:
      before: 10
      after: 4
    h6:
      before: 8
      after: 4
  # Diagram/image spacing (in points)
  diagrams:
    before: 12
    after: 12
  # General paragraph spacing
  paragraphs:
    before: 0
    after: 8
```

Template config.yaml example:
```yaml
spacing:
  headings:
    h1: { before: 24, after: 12 }
    h2: { before: 18, after: 10 }
  diagrams: { before: 12, after: 12 }
```
"""
from dataclasses import dataclass, field
from typing import Any, Dict, Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class ElementSpacing:
    """Spacing configuration for a single element type.

    Attributes:
        before: Space before element in points.
        after: Space after element in points.
        line: Line spacing multiplier (1.0 = single, 1.5 = 1.5 lines, 2.0 = double).
    """
    before: Optional[int] = None
    after: Optional[int] = None
    line: Optional[float] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ElementSpacing':
        """Create ElementSpacing from a dictionary.

        Args:
            data: Dictionary with spacing properties.

        Returns:
            ElementSpacing instance.
        """
        if not data:
            return cls()
        return cls(
            before=data.get('before'),
            after=data.get('after'),
            line=data.get('line'),
        )


@dataclass
class SpacingConfig:
    """Complete spacing configuration for document elements.

    Attributes:
        headings: Spacing for each heading level (h1-h6).
        diagrams: Spacing for diagrams and images.
        paragraphs: Default paragraph spacing.
        tables: Spacing for tables.
        code_blocks: Spacing for code blocks.
    """
    headings: Dict[str, ElementSpacing] = field(default_factory=dict)
    diagrams: ElementSpacing = field(default_factory=ElementSpacing)
    paragraphs: ElementSpacing = field(default_factory=ElementSpacing)
    tables: ElementSpacing = field(default_factory=ElementSpacing)
    code_blocks: ElementSpacing = field(default_factory=ElementSpacing)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SpacingConfig':
        """Create SpacingConfig from a dictionary.

        Args:
            data: Dictionary with spacing configuration.

        Returns:
            SpacingConfig instance.
        """
        if not data:
            return cls()

        # Parse headings
        headings = {}
        headings_data = data.get('headings', {})
        for level in ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']:
            if level in headings_data:
                headings[level] = ElementSpacing.from_dict(headings_data[level])

        # Parse other elements
        diagrams = ElementSpacing.from_dict(data.get('diagrams', {}))
        paragraphs = ElementSpacing.from_dict(data.get('paragraphs', {}))
        tables = ElementSpacing.from_dict(data.get('tables', {}))
        code_blocks = ElementSpacing.from_dict(data.get('code_blocks', {}))

        return cls(
            headings=headings,
            diagrams=diagrams,
            paragraphs=paragraphs,
            tables=tables,
            code_blocks=code_blocks,
        )

    def get_heading_spacing(self, level: int) -> Optional[ElementSpacing]:
        """Get spacing for a specific heading level.

        Args:
            level: Heading level (1-6).

        Returns:
            ElementSpacing for the level, or None if not configured.
        """
        key = f'h{level}'
        return self.headings.get(key)

    def merge(self, override: 'SpacingConfig') -> 'SpacingConfig':
        """Merge this config with an override config.

        Override values take precedence.

        Args:
            override: SpacingConfig with override values.

        Returns:
            New SpacingConfig with merged values.
        """
        # Merge headings
        merged_headings = {**self.headings}
        for level, spacing in override.headings.items():
            merged_headings[level] = spacing

        # For other elements, use override if it has values
        def merge_element(base: ElementSpacing, over: ElementSpacing) -> ElementSpacing:
            return ElementSpacing(
                before=over.before if over.before is not None else base.before,
                after=over.after if over.after is not None else base.after,
                line=over.line if over.line is not None else base.line,
            )

        return SpacingConfig(
            headings=merged_headings,
            diagrams=merge_element(self.diagrams, override.diagrams),
            paragraphs=merge_element(self.paragraphs, override.paragraphs),
            tables=merge_element(self.tables, override.tables),
            code_blocks=merge_element(self.code_blocks, override.code_blocks),
        )


# Default spacing configuration (in points)
DEFAULT_SPACING = SpacingConfig(
    headings={
        'h1': ElementSpacing(before=24, after=12),
        'h2': ElementSpacing(before=18, after=10),
        'h3': ElementSpacing(before=14, after=8),
        'h4': ElementSpacing(before=12, after=6),
        'h5': ElementSpacing(before=10, after=4),
        'h6': ElementSpacing(before=8, after=4),
    },
    diagrams=ElementSpacing(before=12, after=12),
    paragraphs=ElementSpacing(before=0, after=8),
    tables=ElementSpacing(before=12, after=12),
    code_blocks=ElementSpacing(before=8, after=8),
)


def extract_spacing_config(frontmatter: Dict[str, Any]) -> SpacingConfig:
    """Extract spacing configuration from frontmatter.

    Args:
        frontmatter: Parsed frontmatter dictionary.

    Returns:
        SpacingConfig with values from frontmatter merged with defaults.
    """
    spacing_data = frontmatter.get('spacing', {})
    if not spacing_data:
        return DEFAULT_SPACING

    user_config = SpacingConfig.from_dict(spacing_data)
    return DEFAULT_SPACING.merge(user_config)


def load_template_spacing(template_path: 'Path') -> Optional[SpacingConfig]:
    """Load spacing configuration from template.

    Checks in order:
    1. config.yaml - YAML format spacing configuration
    2. styles.xml - Extract heading spacing from template styles

    Args:
        template_path: Path to template directory.

    Returns:
        SpacingConfig if spacing configuration found, None otherwise.
    """
    from pathlib import Path
    import yaml

    template_path = Path(template_path)

    # First try config.yaml
    config_file = template_path / 'config.yaml'
    if config_file.exists():
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
            if config and 'spacing' in config:
                return SpacingConfig.from_dict(config['spacing'])
        except Exception as e:
            logger.warning(f"Failed to load template config.yaml: {e}")

    # Fall back to styles.xml
    styles_file = template_path / 'styles.xml'
    if styles_file.exists():
        return load_spacing_from_styles_xml(styles_file)

    return None


def load_spacing_from_styles_xml(styles_path: 'Path') -> Optional[SpacingConfig]:
    """Load spacing configuration from template styles.xml.

    Parses the styles.xml format used by template extractor to get
    heading spacing values.

    Args:
        styles_path: Path to styles.xml file.

    Returns:
        SpacingConfig with heading spacing from styles.xml.
    """
    from pathlib import Path
    from xml.etree import ElementTree as ET

    try:
        tree = ET.parse(styles_path)
        root = tree.getroot()

        headings = {}

        # Find paragraph styles
        para_styles = root.find('paragraph-styles')
        if para_styles is None:
            return None

        # Map style names to heading levels
        style_to_level = {
            'Heading 1': 'h1',
            'Heading 2': 'h2',
            'Heading 3': 'h3',
            'Heading 4': 'h4',
            'Heading 5': 'h5',
            'Heading 6': 'h6',
        }

        for style_elem in para_styles.findall('style'):
            style_name = style_elem.get('name', '')
            if style_name not in style_to_level:
                continue

            level_key = style_to_level[style_name]

            # Get spacing element
            spacing_elem = style_elem.find('spacing')
            if spacing_elem is None:
                continue

            before_twips = spacing_elem.get('before')
            after_twips = spacing_elem.get('after')
            line = spacing_elem.get('line')

            # Convert twips to points (20 twips = 1 point)
            before_pts = int(int(before_twips) / 20) if before_twips else None
            after_pts = int(int(after_twips) / 20) if after_twips else None
            line_val = float(line) if line else None

            headings[level_key] = ElementSpacing(
                before=before_pts,
                after=after_pts,
                line=line_val,
            )

        if headings:
            return SpacingConfig(headings=headings)

    except Exception as e:
        logger.warning(f"Failed to load spacing from styles.xml: {e}")

    return None
