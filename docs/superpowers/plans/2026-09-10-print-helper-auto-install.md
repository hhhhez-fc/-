# Print Helper Auto-Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically launch the Windows print helper when direct printing starts, arrange one verified installer download when launch fails, reconnect after installation, publish the installer through GitHub Releases, and deploy the matching website manifest to Cloudflare Pages.

**Architecture:** Keep installation metadata and download mechanics in a framework-free service, and put timers/cancellation in a focused React hook that consumes the existing print-helper connection state. The existing print dialog renders the hook state without owning network or timer behavior. A Windows GitHub Actions workflow builds a versioned Inno Setup installer and publishes immutable release assets; the Pages app ships a same-origin manifest that points to that exact release and hash.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest 4, .NET 10 Windows Forms, Inno Setup 6, GitHub Actions, GitHub Releases, Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-09-10-print-helper-auto-install-design.md`

## Global Constraints

- Auto-launch and auto-download begin only after the user clicks “检查并打印”; page load remains read-only.
- Browser code may download but never silently execute or install an EXE.
- Support remains Windows x64, Xprinter XP-420B, 203 DPI, `100 × 75 mm` labels, protocol version `1`.
- Download only an immutable HTTPS asset from `github.com/hhhhez-fc/-/releases/download/print-helper-v<version>/LabelPrintHelper-Setup.exe` after validating the same-origin manifest.
- Attempt protocol launch once per dialog lifecycle and auto-download once per browser session and helper version.
- Cancel timers and requests on connection, dialog close, and unmount.
- Keep browser printing emergency-only; normal direct printing must never call `window.print()`.
- Do not claim code signing or physical XP-420B production approval without evidence.

---

### Task 1: Versioned installer manifest and safe download service

**Files:**
- Create: `src/services/printHelperInstaller.ts`
- Create: `tests/print-helper-installer.spec.ts`
- Create: `public/print-helper/latest.json`
- Modify: `src/vite-env.d.ts`

**Interfaces:**
- Produces `PrintHelperInstallerManifest`, `PrintHelperInstallerError`, `loadPrintHelperInstallerManifest()`, `requestPrintHelperDownload()`, `hasDownloadedInstallerThisSession()`, and `markInstallerDownloadedThisSession()`.
- The bootstrap hook in Task 2 consumes these functions and never accepts an unvalidated URL.

- [x] **Step 1: Write failing service tests**

Add tests that construct a valid manifest and assert strict rejection of foreign hosts, wrong repository paths, moving `latest` URLs, malformed SHA-256 values, protocol versions other than `1`, unsupported platforms, non-JSON responses, and aborted fetches. Assert that the download anchor uses the validated fixed URL, `rel="noopener noreferrer"`, the manifest filename, and is removed after one click. Assert session deduplication uses `label-printing-local:helper-installer-download:v1:<helperVersion>`.

```ts
const manifest = {
  schemaVersion: 1,
  helperVersion: '0.1.0',
  protocolVersion: 1,
  platform: 'windows-x64',
  fileName: 'LabelPrintHelper-Setup.exe',
  downloadUrl: 'https://github.com/hhhhez-fc/-/releases/download/print-helper-v0.1.0/LabelPrintHelper-Setup.exe',
  sha256: 'a'.repeat(64),
  releaseNotesUrl: 'https://github.com/hhhhez-fc/-/releases/tag/print-helper-v0.1.0',
  publishedAtUtc: '2026-09-10T00:00:00.000Z',
};

await expect(loadPrintHelperInstallerManifest({
  fetcher: vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })),
})).resolves.toEqual(manifest);
```

- [x] **Step 2: Run the targeted test and verify RED**

Run: `pnpm exec vitest run tests/print-helper-installer.spec.ts`

Expected: FAIL because `src/services/printHelperInstaller.ts` does not exist.

- [x] **Step 3: Implement strict manifest parsing and download mechanics**

Use exact literal checks for `schemaVersion`, `protocolVersion`, and `platform`; semantic `x.y.z` validation for `helperVersion`; strict ISO UTC round-trip validation for `publishedAtUtc`; and `^[a-f0-9]{64}$` for `sha256`. Construct `new URL(downloadUrl)` and require origin `https://github.com`, path `/hhhhez-fc/-/releases/download/print-helper-v${helperVersion}/LabelPrintHelper-Setup.exe`, and no username, password, search, or hash.

```ts
export interface PrintHelperInstallerManifest {
  schemaVersion: 1;
  helperVersion: string;
  protocolVersion: 1;
  platform: 'windows-x64';
  fileName: 'LabelPrintHelper-Setup.exe';
  downloadUrl: string;
  sha256: string;
  releaseNotesUrl: string;
  publishedAtUtc: string;
}

export async function loadPrintHelperInstallerManifest(options: {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  manifestUrl?: string;
} = {}): Promise<PrintHelperInstallerManifest>;

export function requestPrintHelperDownload(
  manifest: PrintHelperInstallerManifest,
  documentRef?: Document,
): void;
```

Fetch `/print-helper/latest.json` with `cache: 'no-store'`, `credentials: 'same-origin'`, `Accept: application/json`, and the caller signal. Add a real manifest with the release URL schema but use the actual release hash only in Task 5; builds before that task use a syntactically valid 64-character sentinel explicitly rejected from release deployment by Task 4 validation.

- [x] **Step 4: Run the targeted test and verify GREEN**

Run: `pnpm exec vitest run tests/print-helper-installer.spec.ts`

Expected: all installer-service tests PASS.

- [x] **Step 5: Commit Task 1**

```powershell
git add -- src/services/printHelperInstaller.ts src/vite-env.d.ts tests/print-helper-installer.spec.ts public/print-helper/latest.json
git diff --cached --check
git commit -m "feat(print): validate helper installer downloads"
```

### Task 2: Cancellable automatic launch and installation bootstrap

**Files:**
- Create: `src/features/usePrintHelperBootstrap.ts`
- Create: `tests/print-helper-bootstrap.spec.tsx`
- Modify: `src/services/printHelperLaunch.ts`

**Interfaces:**
- Consumes `PrintHelperConnectionState`, `refresh(): Promise<void>`, `launchPrintHelper('start')`, and all installer-service functions from Task 1.
- Produces `PrintHelperBootstrapState` plus `start()`, `retryConnection()`, and `downloadInstaller()` actions for App and dialog integration.

- [x] **Step 1: Write failing hook tests with fake timers**

Cover these exact scenarios:

```ts
it('launches once, probes at 0/1500/3000/5000 ms, then downloads once', async () => {
  vi.useFakeTimers();
  const launch = vi.fn();
  const refresh = vi.fn().mockResolvedValue(undefined);
  const download = vi.fn();
  const { result } = renderHook(() => usePrintHelperBootstrap({
    open: true,
    connectionState: { kind: 'not-installed' },
    refresh,
    launch,
    loadManifest: vi.fn().mockResolvedValue(manifest),
    requestDownload: download,
    sessionStorage: window.sessionStorage,
  }));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(launch).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(4);
  expect(download).toHaveBeenCalledTimes(1);
  expect(result.current.state.kind).toBe('waiting-for-install');
});
```

Also prove that ready/pairing states cancel pending work, a connection before 5 seconds prevents download, reopening the same dialog does not relaunch until a close/open boundary, the same version does not auto-download twice in one session, a new version may download, version mismatch skips protocol launch and downloads the update, invalid manifest yields a safe error, manual download bypasses deduplication, timeout occurs after 120 seconds, and unmount produces no late state update.

- [x] **Step 2: Run the hook test and verify RED**

Run: `pnpm exec vitest run tests/print-helper-bootstrap.spec.tsx`

Expected: FAIL because the bootstrap hook does not exist.

- [x] **Step 3: Implement the finite bootstrap state and cancellation**

```ts
export type PrintHelperBootstrapState =
  | { kind: 'idle' }
  | { kind: 'launching' }
  | { kind: 'loading-installer' }
  | { kind: 'waiting-for-install'; manifest: PrintHelperInstallerManifest; downloadAttempted: boolean }
  | { kind: 'timed-out'; manifest: PrintHelperInstallerManifest }
  | { kind: 'error'; message: string };

export interface UsePrintHelperBootstrapResult {
  state: PrintHelperBootstrapState;
  start: () => void;
  retryConnection: () => Promise<void>;
  downloadInstaller: () => Promise<void>;
}
```

Use one `AbortController` and owned timeout set per dialog run. Start only when `open` is true and `start()` is deliberately called by the “检查并打印” handler. Launch once for `not-installed`; do not launch on `version-mismatch`. Probe with cancellable timeouts, load/validate the manifest only after the final failed probe, mark the session key immediately before requesting download, then poll every 2 seconds until connection changes or 120 seconds elapse. Refs hold mutable callbacks so effects do not restart because of render identity changes.

Update `launchPrintHelper()` only as needed to make its document dependency injectable; retain the fixed `labelprint://start` and `labelprint://calibrate` lookup and never accept arbitrary URLs.

- [x] **Step 4: Run hook and launch tests and verify GREEN**

Run: `pnpm exec vitest run tests/print-helper-bootstrap.spec.tsx tests/direct-print-dialog.spec.tsx`

Expected: all bootstrap and existing direct-dialog tests PASS.

- [x] **Step 5: Commit Task 2**

```powershell
git add -- src/features/usePrintHelperBootstrap.ts src/services/printHelperLaunch.ts tests/print-helper-bootstrap.spec.tsx
git diff --cached --check
git commit -m "feat(print): automate helper startup and installer recovery"
```

### Task 3: Integrate installation progress into the direct-print dialog

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/features/PrintReviewDialog.tsx`
- Modify: `src/styles.css`
- Modify: `tests/direct-print-dialog.spec.tsx`
- Modify: `tests/app.spec.tsx`
- Modify: `tests/accessibility.spec.tsx`
- Modify: `DESIGN.md`
- Modify: `UX-CONTRACT.md`
- Modify: `premium-ui.json`

**Interfaces:**
- App owns `usePrintHelperBootstrap()` and passes `bootstrapState`, `onRetryHelper`, and `onDownloadInstaller` to direct mode.
- `PrintReviewDialog` renders the state and existing helper/printer state without starting timers itself.

- [x] **Step 1: Add failing integration and accessibility tests**

Assert that clicking “检查并打印” calls bootstrap `start()` once. Render the direct dialog for every bootstrap state and assert:

- “正在启动打印助手” while launching;
- a four-step semantic ordered list with current-step text;
- version, filename, complete SHA-256, “下载安装包”, “复制 SHA-256”, and “已安装，立即检测” in the waiting state;
- unsigned/test status warning and no instruction to bypass SmartScreen;
- errors and timeout remain recoverable;
- existing pairing, printer, calibration, range, preview, and emergency-print controls still work;
- the install region is announced through `aria-live`, all buttons have accessible names, and narrow viewport content remains reachable.

```tsx
expect(screen.getByRole('list', { name: '打印助手设置进度' })).toBeVisible();
expect(screen.getByRole('button', { name: '下载安装包' })).toBeEnabled();
expect(screen.getByText(manifest.sha256)).toBeVisible();
```

- [x] **Step 2: Run targeted UI tests and verify RED**

Run: `pnpm exec vitest run tests/direct-print-dialog.spec.tsx tests/app.spec.tsx tests/accessibility.spec.tsx`

Expected: FAIL because bootstrap props and installation UI are absent.

- [x] **Step 3: Wire App and render the installation stage**

In the existing check-and-print event, open the dialog and call `bootstrap.start()` from the same user event. Replace the lone “未检测到打印助手” action row with a compact stepper and conditional install card. Preserve the existing status line, printer selector, pairing action, and calibration controls.

Use an inline copy status for SHA-256 with the existing clipboard pattern. Do not use `alert`, `confirm`, `prompt`, toast-only errors, or a second modal. Keep the fixed dialog layout; at narrow widths stack the install metadata and buttons without horizontal overflow.

- [x] **Step 4: Update product contracts**

Document the four stages, one-launch/one-download invariant, manual-install boundary, safe error states, and GitHub Release ownership in `DESIGN.md` and `UX-CONTRACT.md`. Add `Print Helper Bootstrap` to `premium-ui.json` with `tests/print-helper-bootstrap.spec.tsx` as evidence.

- [x] **Step 5: Run targeted UI tests and verify GREEN**

Run: `pnpm exec vitest run tests/print-helper-bootstrap.spec.tsx tests/direct-print-dialog.spec.tsx tests/app.spec.tsx tests/accessibility.spec.tsx`

Expected: all targeted tests PASS.

- [x] **Step 6: Commit Task 3**

```powershell
git add -- src/App.tsx src/features/PrintReviewDialog.tsx src/styles.css tests/direct-print-dialog.spec.tsx tests/app.spec.tsx tests/accessibility.spec.tsx DESIGN.md UX-CONTRACT.md premium-ui.json
git diff --cached --check
git commit -m "feat(print): guide automatic helper installation"
```

### Task 4: Reproducible versioned installer and release workflow

**Files:**
- Create: `print-helper/version.json`
- Create: `.github/workflows/release-print-helper.yml`
- Modify: `print-helper/scripts/build-installer.ps1`
- Modify: `print-helper/installer/LabelPrintHelper.iss`
- Modify: `print-helper/src/LabelPrintHelper/LabelPrintHelper.csproj`
- Modify: `print-helper/tests/LabelPrintHelper.Tests/InstallerContractTests.cs`
- Create: `tests/release-workflow.spec.ts`

**Interfaces:**
- `print-helper/version.json` is the one repository source for helper semantic version and protocol version.
- `build-installer.ps1 -Version <x.y.z> -OutputDirectory <absolute-path>` builds `LabelPrintHelper-Setup.exe`, writes `LabelPrintHelper-Setup.exe.sha256`, and rejects version mismatch.
- The release workflow consumes tag `print-helper-v<x.y.z>` and uploads both files.

- [x] **Step 1: Add failing installer and workflow contract tests**

Extend the .NET installer test to require an externally injected Inno version define, consistent assembly version injection, per-user install/protocol/startup entries, and scoped uninstall cleanup. Add a Vitest contract test that parses `version.json` and workflow text, asserting Windows execution, .NET 10 setup, helper tests before packaging, Inno Setup installation, tag/version equality gate, SHA-256 creation, immutable asset names, and least GitHub permission `contents: write`.

- [x] **Step 2: Run contract tests and verify RED**

Run:

```powershell
dotnet test print-helper/LabelPrintHelper.sln --filter InstallerContractTests
pnpm exec vitest run tests/release-workflow.spec.ts
```

Expected: FAIL because shared version metadata and the workflow do not exist.

- [x] **Step 3: Make installer version injection explicit**

Use this repository version file:

```json
{
  "helperVersion": "0.1.0",
  "protocolVersion": 1
}
```

Change the Inno header to:

```iss
#ifndef MyAppVersion
  #error MyAppVersion must be supplied by build-installer.ps1
#endif
```

Make the PowerShell script validate `x.y.z`, compare it with `version.json`, pass `/DMyAppVersion=<version>` to ISCC, publish with `/p:Version=<version>`, use an explicit output directory under the repository, and write a lowercase `sha256  filename` checksum file. `-CheckPrerequisiteOnly` remains non-mutating.

- [x] **Step 4: Add the Windows release workflow**

Trigger on `workflow_dispatch` with a required version and on tags matching `print-helper-v*`. Use a Windows runner, `actions/setup-dotnet` for `10.0.x`, `dotnet test`, Chocolatey Inno Setup 6 installation, the repository build script, checksum verification, and GitHub CLI release creation/upload. Reject an existing asset with different bytes rather than overwriting it. Set top-level permissions to `contents: read` and job-level release permission to `contents: write`.

- [x] **Step 5: Run contract tests and verify GREEN**

Run:

```powershell
dotnet test print-helper/LabelPrintHelper.sln --filter InstallerContractTests
pnpm exec vitest run tests/release-workflow.spec.ts
```

Expected: both contract suites PASS.

- [x] **Step 6: Commit Task 4**

```powershell
git add -- print-helper/version.json .github/workflows/release-print-helper.yml print-helper/scripts/build-installer.ps1 print-helper/installer/LabelPrintHelper.iss print-helper/src/LabelPrintHelper/LabelPrintHelper.csproj print-helper/tests/LabelPrintHelper.Tests/InstallerContractTests.cs tests/release-workflow.spec.ts
git diff --cached --check
git commit -m "ci(print): publish versioned helper installer"
```

### Task 5: Produce the release, bind the real hash, and deploy

**Files:**
- Modify: `public/print-helper/latest.json`
- Modify: `docs/direct-printing-setup.md`
- Modify: `docs/superpowers/specs/2026-09-10-print-helper-auto-install-design.md`
- Modify: `docs/superpowers/plans/2026-09-10-print-helper-auto-install.md`

**Interfaces:**
- The published Release asset URL and SHA-256 become immutable inputs to the Pages manifest.
- Deployment consumes only a Release that passed Task 4 and installer smoke checks.

- [x] **Step 1: Run full local verification before release**

Run:

```powershell
pnpm test
pnpm run test:a11y
pnpm run typecheck
pnpm run build
dotnet test print-helper/LabelPrintHelper.sln
git diff --check
```

Expected: all tests, typecheck, build, .NET tests, and diff check PASS.

- [ ] **Step 2: Build and smoke-test the installer**

The GitHub Windows runner built and checksum-verified the installer. Interactive install, protocol launch, localhost health, login-startup, and uninstall smoke checks remain pending on a disposable Windows user context.

If Inno Setup 6 is present locally, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File print-helper/scripts/build-installer.ps1 -Version 0.1.0 -OutputDirectory artifacts
```

Otherwise push the release workflow commit and dispatch the Windows workflow for `0.1.0`. In either path, install in a disposable Windows user context and verify install, tray start, `labelprint://start`, `https://localhost:17653/v1/health`, login startup registration, and clean uninstall. Record that code signing and physical XP-420B tests remain unverified unless actual evidence is produced.

- [x] **Step 3: Publish immutable GitHub Release assets**

Create tag `print-helper-v0.1.0` from the verified commit. Publish `LabelPrintHelper-Setup.exe` and `LabelPrintHelper-Setup.exe.sha256` to the matching GitHub Release. Read the published asset back, calculate SHA-256, and compare it byte-for-byte with the workflow/local checksum before continuing.

- [x] **Step 4: Replace the manifest sentinel with the real release hash**

Update `public/print-helper/latest.json` with the actual lowercase SHA-256 and published UTC time. Update `docs/direct-printing-setup.md` so first install comes from the website-driven download card, with GitHub Release/manual recovery and integrity checking described accurately. Mark the spec and this plan implemented only after the online checks pass.

- [x] **Step 5: Re-run web verification with the final manifest**

Run:

```powershell
pnpm exec vitest run tests/print-helper-installer.spec.ts tests/print-helper-bootstrap.spec.tsx tests/direct-print-dialog.spec.tsx tests/accessibility.spec.tsx
pnpm run typecheck
pnpm run build
git diff --check
```

Expected: all targeted tests, typecheck, build, and diff check PASS; `dist/print-helper/latest.json` contains the exact published hash and fixed release URL.

- [x] **Step 6: Commit and push the web manifest and implementation**

```powershell
git add -- public/print-helper/latest.json docs/direct-printing-setup.md docs/superpowers/specs/2026-09-10-print-helper-auto-install-design.md docs/superpowers/plans/2026-09-10-print-helper-auto-install.md
git diff --cached --check
git commit -m "docs(print): publish helper installer release details"
git push origin codex/print-workflow-improvements
git push origin HEAD:main
```

- [ ] **Step 7: Verify the Cloudflare Pages deployment**

Production HTTP, manifest, immutable download URL, JS/CSS hashes, automatic launch state, installation card, console health, and desktop/390px layout passed. Running the downloaded EXE, completing pairing, and exercising the physical printer remain pending and are intentionally not claimed.

Confirm the production URL returns HTTP 200. Fetch `/print-helper/latest.json` with cache bypass, assert it matches the committed manifest, follow `downloadUrl`, assert the response is the EXE asset rather than HTML, and recompute SHA-256. Compare production JS/CSS hashes against the local `dist` build. In a real Windows browser, click “检查并打印” and verify one launch attempt, one installer download, install recovery, and pairing. Report hardware calibration as pending unless an XP-420B and `100 × 75 mm` media were actually used.

## Final Verification Checklist

- [x] All spec sections map to Tasks 1–5.
- [x] `pnpm test`, `pnpm run test:a11y`, `pnpm run typecheck`, and `pnpm run build` pass.
- [x] `dotnet test print-helper/LabelPrintHelper.sln` passes.
- [x] Premium UI strict audit and anti-pattern scan pass.
- [ ] Installer install/launch/health/uninstall smoke test passes on Windows x64.
- [x] Release asset bytes match the website SHA-256.
- [x] Production manifest and JS/CSS match the verified local build.
- [x] No automated claim is made about code signing or physical XP-420B verification.
