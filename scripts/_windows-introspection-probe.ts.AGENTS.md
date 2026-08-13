# _windows-introspection-probe.ts — index

Probe child for Windows introspection smoke. Imports real `isVirtualMachine` + `defaultGetCmdline` (relative `.js`→`.ts` imports). Calls them against live PowerShell Get-CimInstance, prints `RESULT=<json>` (`{platform,vm,cmdline}`) to stdout. Run as subprocess so driver captures its stderr. See change: replace-wmic-with-powershell.
