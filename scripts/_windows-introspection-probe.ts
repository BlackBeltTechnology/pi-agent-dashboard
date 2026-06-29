/**
 * Probe child for the Windows introspection smoke (see
 * windows-introspection-smoke.ts). Invokes the REAL code paths
 * (`isVirtualMachine`, `defaultGetCmdline`) against live PowerShell
 * Get-CimInstance — no stubs — and prints `RESULT=<json>` to stdout.
 *
 * Run as a subprocess so the driver can capture this process's stderr: a
 * regression back to `execSync` with default stdio would inherit the
 * powershell/cmd child's stderr onto fd 2 here, which the driver detects.
 *
 * See change: replace-wmic-with-powershell.
 */
import { isVirtualMachine } from "../packages/shared/src/platform/commands.js";
import { defaultGetCmdline } from "../packages/server/src/editor-pid-registry.js";

const vm = isVirtualMachine();
const cmdline = defaultGetCmdline(process.pid);

process.stdout.write(`RESULT=${JSON.stringify({ platform: process.platform, vm, cmdline })}\n`);
