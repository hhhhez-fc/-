// @vitest-environment node

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const versionPath = new URL('../print-helper/version.json', import.meta.url);
const workflowPath = new URL('../.github/workflows/release-print-helper.yml', import.meta.url);

describe('versioned print helper release', () => {
  it('has one repository source for helper and protocol versions', () => {
    const version = JSON.parse(readFileSync(versionPath, 'utf8'));
    expect(version).toEqual({ helperVersion: '0.1.0', protocolVersion: 1 });
  });

  it('packages and publishes immutable Windows installer assets after tests', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toMatch(/runs-on:\s*windows-latest/);
    expect(workflow).toMatch(/dotnet-version:\s*['"]?10\.0\.x/);
    expect(workflow).toMatch(/dotnet test print-helper[\\/]LabelPrintHelper\.sln/);
    expect(workflow).toMatch(/choco install innosetup/);
    expect(workflow).toMatch(/build-installer\.ps1[\s\S]*-Version[\s\S]*-OutputDirectory/);
    expect(workflow).toContain('print-helper-v');
    expect(workflow).toContain('LabelPrintHelper-Setup.exe');
    expect(workflow).toContain('LabelPrintHelper-Setup.exe.sha256');
    expect(workflow).toMatch(/Get-FileHash[\s\S]*SHA256/);
    expect(workflow).toMatch(/permissions:\s*\r?\n\s+contents:\s*read/);
    expect(workflow).toMatch(/release:[\s\S]*permissions:\s*\r?\n\s+contents:\s*write/);

    const testIndex = workflow.indexOf('dotnet test');
    const buildIndex = workflow.indexOf('build-installer.ps1');
    const publishIndex = workflow.indexOf('gh release');
    expect(testIndex).toBeGreaterThan(-1);
    expect(buildIndex).toBeGreaterThan(testIndex);
    expect(publishIndex).toBeGreaterThan(buildIndex);
  });
});
