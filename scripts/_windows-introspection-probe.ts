/**
 * Probe child for the Windows introspection smoke (see
 * windows-introspection-smoke.ts). Invokes the REAL code path
 * (`isVirtualMachine`) against live PowerShell Get-CimInstance — no
 * stubs — and prints `RESULT=<json>` to stdout.
 *
 * Run as a subprocess so the driver can capture this process's stderr: a
 * regression back to `execSync` with default stdio would inherit the
 * powershell/cmd child's stderr onto fd 2 here, which the driver detects.
 *
 * See change: replace-wmic-with-powershell.
 */
import { isVirtualMachine } from "../packages/shared/src/platform/commands.js";

const vm = isVirtualMachine();

process.stdout.write(`RESULT=${JSON.stringify({ platform: process.platform, vm })}\n`);
