# Parse every .ps1 the way the Windows PowerShell 5.1 script loader decodes it:
# ANSI code page unless a BOM is present (ReadAllText(path, enc) still honours BOMs).
param([string]$Dir)
$bad = 0
foreach ($f in Get-ChildItem $Dir -Filter *.ps1) {
  $text = [IO.File]::ReadAllText($f.FullName, [Text.Encoding]::Default)
  $tokens = $null; $errs = $null
  [void][Management.Automation.Language.Parser]::ParseInput($text, [ref]$tokens, [ref]$errs)
  if ($errs.Count) { $bad++; "PARSE-FAIL $($f.Name): $($errs[0].Message) @line $($errs[0].Extent.StartLineNumber)" }
}
"ansi=$([Text.Encoding]::Default.WebName) parse failures: $bad"
