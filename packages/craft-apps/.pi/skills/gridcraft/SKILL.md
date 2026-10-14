---
name: gridcraft
description: Headless spreadsheets with GridCraft (XLSX/CSV/TSV workbooks, formula evaluation, recalculation, PDF export), provisioned on demand by pi-craft. Use for "build a budget spreadsheet with formulas", "convert this xlsx to csv", "what does this formula evaluate to", "change a cell and recalculate the totals", "export the sheet to pdf".
---

# GridCraft — headless spreadsheets

GridCraft is ArtCraft's spreadsheet app (341 commands in 0.7.0, 514 formula functions). `pi-craft` provisions the headless
`gridcraft-cli` on first use (no desktop app). App choice, the loop, hand-off formats and the MCP policy live in
`craft-studio`; tables and numbers go to GridCraft, not WordCraft/DeckCraft.

## What it is for / formats

Create and edit workbooks (cells, formulas, formats, tables, charts, pivots, sheets), evaluate formulas, recalculate,
convert, export. Open: `xlsx xlsm xls xlsb ods csv tsv txt json`. Write (`convert`, `run --out`, `file.saveAs`):
`xlsx csv tsv json html`, and **`pdf` only from `run`** (`--out x.pdf` or `file.saveAs`/`file.exportPdf`; `convert` rejects
`.pdf`). The native project file is the `.xlsx`.

## CLI dialect

`pi-craft gridcraft exec <args…>` passes the arguments to `gridcraft-cli`.

```bash
gridcraft-cli commands [--json] [--search X]          # table by default; --json = id,label,menu,params,shortcut; NO --filter
gridcraft-cli commands --search chart                 # substring filter on the id/label (the "describe" of this app = the params column)
gridcraft-cli run [--in FILE | --sample NAME] [--cmd 'id={json}']... [--script FILE.jsonl] [--out FILE] [--print RANGE] [--quiet]
gridcraft-cli eval <formula> [--in FILE] [--sheet S] [--cell A1] [--json]
gridcraft-cli cat <file> [--range A1:D20] [--sheet S] [--formulas] [--csv]
gridcraft-cli convert <in> <out> [--sheet NAME]       # xlsx/csv/tsv/json/html by extension
gridcraft-cli info <file> [--json]                    # sheets, used ranges, tables, charts, names
gridcraft-cli check <file-or-dir>... [--json]         # cached-value calc oracle + xlsx round-trip; exit 1 on any difference
gridcraft-cli functions [--search X] [--category C]   # formula function catalogue with signatures
```

- There is **no `describe`**; parameters are the `params` column of `commands`.
- `run` takes repeated `--cmd 'id={json}'` (id=JSON, single-quoted; a bare `id` takes no params). All commands run in
  order on one in-memory workbook. `--in FILE` opens a file, `--sample budget|sales|grades` a demo workbook, neither = blank.
- `--script FILE.jsonl`: one step per line, either `{"command":"cell.set","params":{…}}` or a plain `cell.set={…}` line.
- `--print A1:D4` prints that range after the commands; `--quiet` hides per-command JSON.
- Typing model: `cell.set {cell,input}` (input `=…` is a formula), `range.setValues {range,values:[[…]]}` (strings
  starting `=` are formulas, `null` = empty), `sheet.read {range,formulas?}` returns values, `cell.get` one cell.

## State between invocations

None. A `run` edits an in-memory workbook that is lost at exit unless `--out FILE` (or a `file.save`/`file.saveAs` command)
writes it. `--in F` never writes back; use `--out F` to overwrite. Chain steps through files.

## Discovery first

```bash
pi-craft gridcraft exec commands --search sheet        # ids + one-line param schema
pi-craft gridcraft exec commands --json | jq '.[] | select(.id=="home.numberFormat")'
pi-craft gridcraft exec functions --search lookup      # exact function signature before writing a formula
pi-craft gridcraft exec info book.xlsx                 # sheets, used range, tables, charts
```

Id families: `file.*`, `cell.*`/`range.*` (data), `sheet.*`, `home.*` (formats, rows/columns), `formulas.*`, `data.*`
(sort/filter/validation), `insert.*` (tables, charts, pivots), `table.*`, `pivot.*`, `chart.*`, `pageLayout.*`, `review.*`.

## Traps

- **One failing `--cmd` aborts the run, exit 1, nothing written** (`unknown command \`nosuch.cmd\``).
- `commands --filter` is "unknown option"; the filter is `--search`, and `--search recalc` finds nothing — try `calc`.
- `convert x.xlsx x.pdf` → "unknown output format"; PDF comes from `run --in x.xlsx --out x.pdf` or `file.saveAs`.
- `eval` takes the formula as one quoted word; with a leading `=` or without both work. Without `--in` it has no cells
  (`eval 'SUM(A1:A3)' --in t.xlsx` sums text cells → `0`). Errors print as values (`#NAME?`, `#DIV/0!`) with exit **0**; with
  `--json` an error is `{"error":"#DIV/0!"}`, a value is the bare JSON (`"ab"`, `27.5`).
- A `--script` line with inline keys (`{"command":"cell.set","cell":"A3",…}`) fails: parameters must be under `"params"`.
- `cat` shows cached/computed values; `cat --formulas` shows the source. `--csv` prints CSV to stdout.
- `convert` to csv writes the active sheet only (the last sheet added/activated, not necessarily the first); pass `--sheet NAME` for another.
- `file.exportPdf` honours Page Setup; the PDF text layer is extractable, so `--text-contains` works.
- Verification: `pi-craft verify` has no spreadsheet probe — verify the PDF derivative (`--pages`, `--text-contains`).

## MCP route (opt-in)

`pi-craft gridcraft mcp --register` writes a `craft-gridcraft` entry into `.pi/mcp.json` (21 tools). It is **not**
confined (no read/write root flags): it can touch any file the process can — review before registering. Use it for one long
open workbook; bash for everything here. GUI bridging (`--connect`) is out of scope.

## Recipes

```bash recipe: budget-table-pdf
# Build a table with formulas (values + =formulas in one setValues), save xlsx, read back, export PDF.
pi-craft gridcraft exec run \
  --cmd 'range.setValues={"range":"A1","values":[["Item","Qty","Price","Total"],["Pen",3,2.5,"=B2*C2"],["Ink",2,10,"=B3*C3"],["Sum",null,null,"=SUM(D2:D3)"]]}' \
  --out budget.xlsx
pi-craft gridcraft exec cat budget.xlsx --formulas
pi-craft gridcraft exec check budget.xlsx
pi-craft gridcraft exec run --in budget.xlsx --out budget.pdf
pi-craft verify budget.pdf --pages 1 --text-contains "Ink"
```

```bash recipe: eval-and-csv
# Evaluate a formula against a workbook, then convert xlsx <-> csv and re-export.
pi-craft gridcraft exec run --cmd 'range.setValues={"range":"A1","values":[["n","sq"],[2,"=A2^2"],[3,"=A3^2"]]}' --out sq.xlsx
pi-craft gridcraft exec eval '=SUM(B2:B3)' --in sq.xlsx --json
pi-craft gridcraft exec convert sq.xlsx sq.csv
pi-craft gridcraft exec cat sq.csv --csv
pi-craft gridcraft exec convert sq.csv again.xlsx
pi-craft gridcraft exec run --in again.xlsx --out again.pdf
pi-craft verify again.pdf --pages 1 --text-contains "sq"
```

```bash recipe: recalc-after-edit
# Open a workbook, change an input with cell.set, the formulas recalculate; print and export the new totals.
pi-craft gridcraft exec run --cmd 'range.setValues={"range":"A1","values":[["Qty","Price","Total"],[3,2.5,"=A2*B2"]]}' --out base.xlsx
pi-craft gridcraft exec run --in base.xlsx --cmd 'cell.set={"cell":"A2","input":"10"}' --print A1:C2 --out edited.xlsx
pi-craft gridcraft exec eval '=C2' --in edited.xlsx
pi-craft gridcraft exec run --in edited.xlsx --out edited.pdf
pi-craft verify edited.pdf --pages 1 --text-contains "25"
```

```bash recipe: jsonl-script-sample
# A jsonl script (both line shapes) on top of the sales demo workbook; ids from `commands`.
printf '%s\n' '{"command":"sheet.rename","params":{"name":"Annual"}}' 'cell.set={"cell":"A20","input":"Checked"}' > steps.jsonl
pi-craft gridcraft exec run --sample sales --script steps.jsonl --quiet --out sales.xlsx
pi-craft gridcraft exec info sales.xlsx
pi-craft gridcraft exec run --in sales.xlsx --out sales.pdf
pi-craft verify sales.pdf --text-contains "Checked"
```
