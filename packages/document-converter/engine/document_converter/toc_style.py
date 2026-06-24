"""TOC style configuration module.

Provides dataclasses and functions for configuring Table of Contents styling.

Frontmatter example:
```yaml
toc:
  mode: static  # or "dynamic" (default: static)
  max_level: 3  # Maximum heading level to include (1-9, default: 3)
  heading: "Table of Contents"  # TOC heading text
  tab_leader: dots  # dots, dashes, underline, none
  hyperlinks: true  # Whether TOC entries are hyperlinks
  styles:
    1:
      bold: true
      font_size: 12
      indent: 0
    2:
      bold: false
      font_size: 11
      indent: 12
    3:
      italic: true
      font_size: 10
      indent: 24
```
"""
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class TocMode(Enum):
    """TOC generation mode."""
    STATIC = "static"    # Generate actual TOC entries (works for PDF)
    DYNAMIC = "dynamic"  # Generate Word field code (requires Word to update)


@dataclass
class TocLevelStyle:
    """Style configuration for a specific TOC level.

    Attributes:
        font_name: Font name for this level.
        font_size: Font size in points.
        bold: Whether text is bold.
        italic: Whether text is italic.
        color: Text color as hex string (without #).
        indent: Indentation in points.
        spacing_before: Spacing before in points.
        spacing_after: Spacing after in points.
    """
    font_name: Optional[str] = None
    font_size: Optional[int] = None
    bold: Optional[bool] = None
    italic: Optional[bool] = None
    color: Optional[str] = None
    indent: Optional[int] = None
    spacing_before: Optional[int] = None
    spacing_after: Optional[int] = None


@dataclass
class TocStyleConfig:
    """Configuration for Table of Contents styling.

    Attributes:
        max_level: Maximum heading level to include (1-9).
        show_page_numbers: Whether to show page numbers.
        right_align_page_numbers: Whether to right-align page numbers.
        tab_leader: Tab leader character type (dots, dashes, underline, none).
        hyperlinks: Whether TOC entries are hyperlinks.
        indent_per_level: Indentation per level in points.
        level_styles: Per-level style configurations.
    """
    max_level: int = 3
    show_page_numbers: bool = True
    right_align_page_numbers: bool = True
    tab_leader: str = "dots"  # dots, dashes, underline, none
    hyperlinks: bool = True
    indent_per_level: int = 12
    level_styles: Dict[int, TocLevelStyle] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, style_dict: Dict[str, Any]) -> 'TocStyleConfig':
        """Create TocStyleConfig from a dictionary.

        Args:
            style_dict: Dictionary with style properties.

        Returns:
            TocStyleConfig with values from dict.
        """
        level_styles = {}
        levels_dict = style_dict.get('levels', {})
        for level_key, level_dict in levels_dict.items():
            try:
                level_num = int(level_key)
                level_styles[level_num] = TocLevelStyle(
                    font_name=level_dict.get('font_name'),
                    font_size=level_dict.get('font_size'),
                    bold=level_dict.get('bold'),
                    italic=level_dict.get('italic'),
                    color=level_dict.get('color'),
                    indent=level_dict.get('indent'),
                    spacing_before=level_dict.get('spacing_before'),
                    spacing_after=level_dict.get('spacing_after'),
                )
            except (ValueError, TypeError):
                pass

        return cls(
            max_level=style_dict.get('max_level', 3),
            show_page_numbers=style_dict.get('show_page_numbers', True),
            right_align_page_numbers=style_dict.get('right_align_page_numbers', True),
            tab_leader=style_dict.get('tab_leader', 'dots'),
            hyperlinks=style_dict.get('hyperlinks', True),
            indent_per_level=style_dict.get('indent_per_level', 12),
            level_styles=level_styles,
        )

    def merge(self, override: 'TocStyleConfig') -> 'TocStyleConfig':
        """Merge this config with an override config.

        Args:
            override: TocStyleConfig with override values.

        Returns:
            New TocStyleConfig with merged values.
        """
        default = TocStyleConfig()

        # Merge level styles
        merged_levels = {**self.level_styles}
        for level, style in override.level_styles.items():
            merged_levels[level] = style

        return TocStyleConfig(
            max_level=override.max_level if override.max_level != default.max_level else self.max_level,
            show_page_numbers=override.show_page_numbers if override.show_page_numbers != default.show_page_numbers else self.show_page_numbers,
            right_align_page_numbers=override.right_align_page_numbers if override.right_align_page_numbers != default.right_align_page_numbers else self.right_align_page_numbers,
            tab_leader=override.tab_leader if override.tab_leader != default.tab_leader else self.tab_leader,
            hyperlinks=override.hyperlinks if override.hyperlinks != default.hyperlinks else self.hyperlinks,
            indent_per_level=override.indent_per_level if override.indent_per_level != default.indent_per_level else self.indent_per_level,
            level_styles=merged_levels,
        )


@dataclass
class TocConfig:
    """Complete TOC configuration including mode and styles.

    Attributes:
        enabled: Whether TOC is enabled.
        mode: TOC generation mode (static or dynamic).
        heading: TOC heading text.
        style: Style configuration for the TOC.
    """
    enabled: bool = True
    mode: TocMode = TocMode.STATIC
    heading: str = "Tartalomjegyzék"
    style: TocStyleConfig = field(default_factory=TocStyleConfig)

    @classmethod
    def from_dict(cls, toc_dict: Dict[str, Any]) -> 'TocConfig':
        """Create TocConfig from a dictionary (frontmatter).

        Args:
            toc_dict: Dictionary with TOC configuration.

        Returns:
            TocConfig with values from dict.
        """
        if not toc_dict:
            return cls()

        # Parse mode
        mode_str = toc_dict.get('mode', 'static').lower()
        mode = TocMode.DYNAMIC if mode_str == 'dynamic' else TocMode.STATIC

        # Parse style configuration
        style_dict = {
            'max_level': toc_dict.get('max_level', 3),
            'tab_leader': toc_dict.get('tab_leader', 'dots'),
            'hyperlinks': toc_dict.get('hyperlinks', True),
            'show_page_numbers': toc_dict.get('show_page_numbers', True),
            'right_align_page_numbers': toc_dict.get('right_align_page_numbers', True),
            'indent_per_level': toc_dict.get('indent_per_level', 12),
        }

        # Parse level styles from 'styles' key
        if 'styles' in toc_dict and isinstance(toc_dict['styles'], dict):
            style_dict['levels'] = toc_dict['styles']

        style = TocStyleConfig.from_dict(style_dict)

        return cls(
            enabled=toc_dict.get('enabled', True),
            mode=mode,
            heading=toc_dict.get('heading', 'Tartalomjegyzék'),
            style=style,
        )


# Default TOC style configuration
DEFAULT_TOC_STYLE = TocStyleConfig()

# Default TOC configuration
DEFAULT_TOC_CONFIG = TocConfig()


def get_tab_leader_char(leader_type: str) -> str:
    """Get the tab leader character for a given type.

    Args:
        leader_type: Type of tab leader (dots, dashes, underline, none).

    Returns:
        Character to use for tab leader.
    """
    leaders = {
        'dots': '.',
        'dashes': '-',
        'underline': '_',
        'none': ' ',
    }
    return leaders.get(leader_type.lower(), '.')


def extract_toc_style(frontmatter: Dict[str, Any]) -> Optional[TocStyleConfig]:
    """Extract TOC style configuration from frontmatter.

    Args:
        frontmatter: Parsed frontmatter dictionary.

    Returns:
        TocStyleConfig if toc_style is present, None otherwise.
    """
    toc_style_dict = frontmatter.get('toc_style')
    if toc_style_dict and isinstance(toc_style_dict, dict):
        return TocStyleConfig.from_dict(toc_style_dict)
    return None


def extract_toc_config(frontmatter: Dict[str, Any]) -> TocConfig:
    """Extract complete TOC configuration from frontmatter.

    Supports the 'toc' key in frontmatter with the following structure:
    ```yaml
    toc:
      mode: static  # or "dynamic"
      max_level: 3
      heading: "Table of Contents"
      tab_leader: dots
      hyperlinks: true
      styles:
        1:
          bold: true
          font_size: 12
        2:
          bold: false
          font_size: 11
    ```

    Args:
        frontmatter: Parsed frontmatter dictionary.

    Returns:
        TocConfig with values from frontmatter, or defaults.
    """
    toc_dict = frontmatter.get('toc')

    # Also check for legacy 'toc_style' key and merge
    legacy_style = frontmatter.get('toc_style')

    if toc_dict and isinstance(toc_dict, dict):
        config = TocConfig.from_dict(toc_dict)

        # Merge legacy toc_style if present
        if legacy_style and isinstance(legacy_style, dict):
            legacy_config = TocStyleConfig.from_dict(legacy_style)
            config.style = config.style.merge(legacy_config)

        return config
    elif legacy_style and isinstance(legacy_style, dict):
        # Only legacy toc_style present
        style = TocStyleConfig.from_dict(legacy_style)
        return TocConfig(style=style)

    return DEFAULT_TOC_CONFIG
