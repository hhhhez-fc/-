# XP-420B Website Direct Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an app-owned website print dialog and a once-installed Windows helper that sends each `100 × 75 mm` label to an Xprinter XP-420B as one exact TSPL bitmap, without opening the browser print dialog.

**Architecture:** The React app renders each label at the printer's exact `800 × 600` dot geometry, stages a versioned print job through a TLS loopback API, and shows all printer/settings/progress UI. A self-contained .NET 10 Windows tray helper validates the job, converts PNG assets to 1-bit TSPL bitmaps, enforces idempotency, and writes one `PRINT 1,1` command per physical label to the Windows RAW spooler.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest 4, Testing Library, `html-to-image` 1.11.13, .NET 10 Windows Forms/Kestrel, xUnit, Windows Winspool API, Inno Setup 6.

**Spec:** `docs/superpowers/specs/2026-09-08-xprinter-direct-printing-design.md`

## Global Constraints

- Target hardware is Xprinter XP-420B over its installed Windows USB print queue.
- The first production profile is exactly `100 × 75 mm`, 203 DPI, `8 dots/mm`, `800 × 600 dots`.
- Browser zoom, CSS pixels, device pixel ratio, and the Windows driver's copy count must not affect the physical page count.
- Existing `PrintPlan` remains the source for business quantity and posting-side expansion; direct-print copies default to 1.
- Every physical label is submitted with one `PRINT 1,1`; no automatic retry is allowed after an unknown or partial submission.
- The helper listens only on loopback TLS, validates exact allowed origins, requires pairing, and accepts no arbitrary commands, paths, or URLs.
- Label bitmaps remain local and are deleted after completion or timeout; persisted history contains metadata only.
- The website owns the normal print dialog. The helper remains in the tray except for first pairing, diagnostics, or explicit user action.
- Existing browser printing remains only under `更多操作 > 浏览器打印（应急）`.
- Target `net10.0-windows` and publish the helper self-contained for `win-x64`; no separate .NET Runtime install.
- Follow TDD for every behavior change: failing focused test, minimal implementation, passing focused test, then relevant regression tests.
- Project instructions prohibit automatic Git commits. Replace every normal commit checkpoint with a diff/test report and leave changes uncommitted.

---

## File Structure

### Shared protocol

- Create `print-protocol/v1.schema.json` as the language-neutral job/API contract.
- Create `print-protocol/examples/xp420b-100x75-job.json` as a sanitized contract fixture with no real label data.

### Website

- Create `src/domain/directPrinting.ts` for exact geometry, ranges, copy order, manifest types, and validation.
- Create `src/features/PrintBitmapSurface.tsx` for the canonical `800 × 600` render surface.
- Create `src/features/PrintBitmapPreview.tsx` for the visible preview of that same surface.
- Create `src/services/printBitmapRenderer.ts` for DOM-to-PNG rendering and SHA-256 asset creation.
- Create `src/services/printHelperClient.ts` for the loopback API.
- Create `src/features/usePrintHelper.ts` for discovery, pairing, printer state, job submission, and progress.
- Modify `src/features/PrintReviewDialog.tsx` to become the app-owned direct-print dialog.
- Modify `src/App.tsx` to orchestrate direct print and preserve explicit emergency browser printing.
- Modify `src/styles.css`, `DESIGN.md`, `UX-CONTRACT.md`, and `premium-ui.json` for the new canonical capability.
- Create `tests/direct-printing.spec.ts`, `tests/print-bitmap.spec.tsx`, `tests/print-helper-client.spec.ts`, and `tests/direct-print-dialog.spec.tsx`.
- Modify `tests/print-layout.spec.tsx`, `tests/print-rotation.spec.tsx`, `tests/accessibility.spec.tsx`, and `tests/app.spec.tsx`.

### Windows helper

- Create `global.json` to pin SDK `10.0.400` with latest-patch roll-forward.
- Create `print-helper/LabelPrintHelper.sln`, `print-helper/src/LabelPrintHelper/LabelPrintHelper.csproj`, and `print-helper/tests/LabelPrintHelper.Tests/LabelPrintHelper.Tests.csproj`.
- Create focused folders under `print-helper/src/LabelPrintHelper/`: `Protocol`, `Printing`, `Jobs`, `Security`, `Api`, `Tray`, and `Configuration`.
- Create `print-helper/installer/LabelPrintHelper.iss` and `print-helper/scripts/build-installer.ps1`.
- Create `docs/direct-printing-setup.md` for installation, pairing, calibration, troubleshooting, and uninstall.

---

### Task 1: Lock the versioned protocol and website print-domain rules

**Files:**
- Create: `print-protocol/v1.schema.json`
- Create: `print-protocol/examples/xp420b-100x75-job.json`
- Create: `src/domain/directPrinting.ts`
- Create: `tests/direct-printing.spec.ts`

**Interfaces:**
- Produces: `XP420B_100X75_PROFILE`, `millimetersToDots`, `normalizePrintRange`, `expandPrintSequence`, `createPrintJobManifest`, and all `DirectPrint*` TypeScript interfaces.
- Produces protocol JSON fields consumed verbatim by Tasks 2, 4, 6, and 8.

- [ ] **Step 1: Write failing geometry, range, copy-order, and manifest tests**

```ts
expect(millimetersToDots(100, 8)).toBe(800);
expect(millimetersToDots(75, 8)).toBe(600);
expect(normalizePrintRange({ from: 2, to: 4 }, 5)).toEqual({ from: 2, to: 4 });
expect(expandPrintSequence(['A', 'B'], 2, true)).toEqual(['A', 'B', 'A', 'B']);
expect(expandPrintSequence(['A', 'B'], 2, false)).toEqual(['A', 'A', 'B', 'B']);
expect(() => normalizePrintRange({ from: 0, to: 3 }, 5)).toThrow('打印起始页必须在 1–5 之间');
```

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

Run: `pnpm vitest run tests/direct-printing.spec.ts`

Expected: FAIL because `src/domain/directPrinting.ts` does not exist.

- [ ] **Step 3: Define the exact profile and protocol types**

```ts
export const PRINT_PROTOCOL_VERSION = 1 as const;
export const XP420B_100X75_PROFILE = {
  id: 'xp420b-100x75-203dpi', widthMm: 100, heightMm: 75,
  dotsPerMm: 8, widthDots: 800, heightDots: 600,
} as const;

export interface PrintSequenceEntry {
  ordinal: number;
  assetId: string;
  labelId: string;
  sourcePageNumber: number;
  copyNumber: number;
}

export interface DirectPrintAsset {
  assetId: string;
  labelId: string;
  widthDots: 800;
  heightDots: 600;
  rotation: 0 | 90 | 180 | 270;
  pngBase64: string;
  sha256: string;
}

export interface DirectPrintJobManifest {
  protocolVersion: 1;
  jobId: string;
  createdAtUtc: string;
  websiteVersion: string;
  printerId: string;
  printerName: string;
  profileId: typeof XP420B_100X75_PROFILE.id;
  printerProfileVersion: string;
  widthMm: 100;
  heightMm: 75;
  widthDots: 800;
  heightDots: 600;
  layout: 'landscape' | 'portrait';
  range: { from: number; to: number };
  copies: number;
  collate: boolean;
  horizontalOffsetMm: number;
  verticalOffsetMm: number;
  threshold: { mode: 'text' | 'auto' | 'custom'; value?: number };
  expectedLabels: number;
  sequence: PrintSequenceEntry[];
}
```

- [ ] **Step 4: Implement the pure functions and explicit validation messages**

Implement `millimetersToDots(mm, dotsPerMm)`, `normalizePrintRange(range, totalPages)`, `expandPrintSequence(assetIds, copies, collate)`, and `createPrintJobManifest(input)`. Reject non-integers, reversed ranges, copies outside `1–100`, offsets outside `-10–10 mm`, non-100×75 groups, sequence gaps, and expected-label mismatches.

- [ ] **Step 5: Write the JSON Schema and sanitized example from the same field names**

The schema must set `additionalProperties: false` at every object boundary and constrain `protocolVersion` to `1`, profile ID to `xp420b-100x75-203dpi`, millimeter dimensions to `100` and `75`, dot dimensions to `800` and `600`, offsets to `-10..10`, copies to `1..100`, threshold to `0..255`, and each `ordinal`/`copyNumber` to a positive integer. The fixture uses labels `EXAMPLE-A` and `EXAMPLE-B` only.

- [ ] **Step 6: Run focused and print-planning regressions**

Run: `pnpm vitest run tests/direct-printing.spec.ts tests/printing.spec.ts`

Expected: PASS.

- [ ] **Step 7: Report checkpoint without committing**

Run: `git diff --stat` and `git diff --check`. Report protocol/domain changes and test results; do not commit.

---

### Task 2: Scaffold the .NET 10 helper and mirror the protocol safely

**Files:**
- Create: `global.json`
- Create: `print-helper/LabelPrintHelper.sln`
- Create: `print-helper/src/LabelPrintHelper/LabelPrintHelper.csproj`
- Create: `print-helper/src/LabelPrintHelper/Program.cs`
- Create: `print-helper/src/LabelPrintHelper/Protocol/PrintProtocol.cs`
- Create: `print-helper/src/LabelPrintHelper/Protocol/ProtocolValidator.cs`
- Create: `print-helper/tests/LabelPrintHelper.Tests/ProtocolValidatorTests.cs`

**Interfaces:**
- Consumes: protocol field names and constraints from Task 1.
- Produces: `PrintJobManifest`, `PrintSequenceEntry`, `PrintAssetUpload`, `ProtocolValidator.ValidateManifest`, and `ProtocolValidator.ValidateAsset` for Tasks 3 and 4.

- [ ] **Step 1: Add failing C# protocol validation tests**

```csharp
[Fact]
public void Rejects_wrong_dot_geometry() {
    var asset = TestData.ValidAsset() with { WidthDots = 801 };
    var error = ProtocolValidator.ValidateAsset(asset);
    Assert.Equal("位图必须为 800 × 600 点", error);
}

[Fact]
public void Rejects_unknown_protocol_version() {
    var manifest = TestData.ValidManifest() with { ProtocolVersion = 2 };
    Assert.Equal("不支持的打印协议版本 2", ProtocolValidator.ValidateManifest(manifest));
}
```

- [ ] **Step 2: Scaffold solution and verify tests fail for missing types**

Run:

```powershell
dotnet new sln -n LabelPrintHelper -o print-helper --format sln
dotnet new winforms -n LabelPrintHelper -o print-helper/src/LabelPrintHelper -f net10.0
dotnet new xunit -n LabelPrintHelper.Tests -o print-helper/tests/LabelPrintHelper.Tests -f net10.0
dotnet sln print-helper/LabelPrintHelper.sln add print-helper/src/LabelPrintHelper/LabelPrintHelper.csproj print-helper/tests/LabelPrintHelper.Tests/LabelPrintHelper.Tests.csproj
dotnet add print-helper/tests/LabelPrintHelper.Tests/LabelPrintHelper.Tests.csproj reference print-helper/src/LabelPrintHelper/LabelPrintHelper.csproj
dotnet test print-helper/LabelPrintHelper.sln
```

Expected: FAIL after adding the test because protocol types are missing.

- [ ] **Step 3: Configure the helper as a Windows tray/Kestrel host**

Use `net10.0-windows`, `OutputType=WinExe`, `UseWindowsForms=true`, nullable/implicit usings enabled, and a `FrameworkReference` to `Microsoft.AspNetCore.App`. Pin SDK `10.0.400` in `global.json` with `rollForward: latestPatch`.

- [ ] **Step 4: Implement immutable DTOs and validators**

```csharp
public sealed record PrintRange(int From, int To);
public sealed record ThresholdOptions(string Mode, int? Value);
public sealed record PrintSequenceEntry(
    int Ordinal, string AssetId, string LabelId, int SourcePageNumber, int CopyNumber);

public sealed record PrintJobManifest(
    int ProtocolVersion, string JobId, DateTimeOffset CreatedAtUtc, string WebsiteVersion,
    string PrinterId, string PrinterName, string ProfileId, string PrinterProfileVersion,
    decimal WidthMm, decimal HeightMm, int WidthDots, int HeightDots,
    string Layout, PrintRange Range, int Copies, bool Collate,
    decimal HorizontalOffsetMm, decimal VerticalOffsetMm, ThresholdOptions Threshold,
    int ExpectedLabels, IReadOnlyList<PrintSequenceEntry> Sequence);

public sealed record PrintAssetUpload(
    string AssetId, string LabelId, int WidthDots, int HeightDots,
    int Rotation, string PngBase64, string Sha256);
```

Serialize with `JsonNamingPolicy.CamelCase`, reject unknown fields, and return one stable Chinese validation message per failure.

- [ ] **Step 5: Run helper tests**

Run: `dotnet test print-helper/LabelPrintHelper.sln`

Expected: PASS.

- [ ] **Step 6: Report checkpoint without committing**

Report the scaffold, protocol parity, restore result, and test count; do not commit.

---

### Task 3: Encode one exact monochrome page as one TSPL print

**Files:**
- Create: `print-helper/src/LabelPrintHelper/Printing/PrinterProfile.cs`
- Create: `print-helper/src/LabelPrintHelper/Printing/MonochromeRasterizer.cs`
- Create: `print-helper/src/LabelPrintHelper/Printing/TsplEncoder.cs`
- Create: `print-helper/src/LabelPrintHelper/Printing/IRawPrintSpooler.cs`
- Create: `print-helper/src/LabelPrintHelper/Printing/WindowsRawPrintSpooler.cs`
- Create: `print-helper/tests/LabelPrintHelper.Tests/MonochromeRasterizerTests.cs`
- Create: `print-helper/tests/LabelPrintHelper.Tests/TsplEncoderTests.cs`

**Interfaces:**
- Consumes: `PrintAssetUpload` from Task 2.
- Produces: `PackedMonochromeBitmap`, `TsplEncoder.EncodePage`, and `IRawPrintSpooler.SubmitAsync` for Task 4.

- [ ] **Step 1: Write failing bit-packing and TSPL framing tests**

```csharp
[Fact]
public void Packs_eight_pixels_most_significant_bit_first() {
    var packed = MonochromeRasterizer.Pack(new[] { true, false, true, false, false, false, false, true }, 8, 1);
    Assert.Equal(new byte[] { 0b1010_0001 }, packed.Data);
}

[Fact]
public void Emits_one_100x75_page_and_one_print_command() {
    var bytes = TsplEncoder.EncodePage(TestData.White800x600(), PrinterProfile.TestGap2Mm);
    var text = Encoding.ASCII.GetString(bytes);
    Assert.Contains("SIZE 100 mm,75 mm\r\n", text);
    Assert.Contains("BITMAP 0,0,100,600,0,", text);
    Assert.Equal(1, Regex.Matches(text, "PRINT 1,1").Count);
    Assert.DoesNotContain("PRINT 2", text);
}
```

- [ ] **Step 2: Run tests and verify missing implementation failures**

Run: `dotnet test print-helper/LabelPrintHelper.sln --filter "Rasterizer|TsplEncoder"`

Expected: FAIL.

- [ ] **Step 3: Implement deterministic PNG decoding and 1-bit packing**

Decode only PNG data, composite transparency onto white, convert pixels with an explicit `0..255` threshold, and pack 8 horizontal dots into each byte. Require exactly `800 × 600`; do not resize in the helper.

- [ ] **Step 4: Implement the TSPL encoder with profile-owned media settings**

```csharp
public static byte[] EncodePage(PackedMonochromeBitmap bitmap, PrinterProfile profile) {
    // SIZE, media sensing, DIRECTION, REFERENCE, CLS,
    // BITMAP header + raw bytes, then exactly PRINT 1,1.
}
```

Keep gap/black-mark commands in `PrinterProfile`; use a `2 mm` gap only in unit fixtures. Production profile creation must remain blocked until Task 10 calibration stores a verified sensor setting.

- [ ] **Step 5: Implement the Winspool RAW boundary**

`IRawPrintSpooler.SubmitAsync(string printerName, ReadOnlyMemory<byte> document, string documentName, CancellationToken)` returns the Windows job ID. `WindowsRawPrintSpooler` wraps `OpenPrinter`, `StartDocPrinter` with datatype `RAW`, `StartPagePrinter`, `WritePrinter`, and guaranteed cleanup. A short write is an error.

- [ ] **Step 6: Add a fake spooler test proving one call per physical label**

Use an in-memory `IRawPrintSpooler` test double; never address a real printer in automated tests.

- [ ] **Step 7: Run all helper tests and report without committing**

Run: `dotnet test print-helper/LabelPrintHelper.sln`

Expected: PASS. Report TSPL byte geometry and that each encoded page contains one `PRINT 1,1`; do not commit.

---

### Task 4: Stage, validate, deduplicate, and submit helper jobs

**Files:**
- Create: `print-helper/src/LabelPrintHelper/Jobs/PrintJobStatus.cs`
- Create: `print-helper/src/LabelPrintHelper/Jobs/IPrintJobStore.cs`
- Create: `print-helper/src/LabelPrintHelper/Jobs/FilePrintJobStore.cs`
- Create: `print-helper/src/LabelPrintHelper/Jobs/PrintJobService.cs`
- Create: `print-helper/src/LabelPrintHelper/Printing/IPrinterCatalog.cs`
- Create: `print-helper/src/LabelPrintHelper/Printing/WindowsPrinterCatalog.cs`
- Create: `print-helper/src/LabelPrintHelper/Api/PrintEndpoints.cs`
- Create: `print-helper/tests/LabelPrintHelper.Tests/PrintJobServiceTests.cs`
- Create: `print-helper/tests/LabelPrintHelper.Tests/PrintEndpointsTests.cs`

**Interfaces:**
- Consumes: protocol validators from Task 2 and TSPL/spooler interfaces from Task 3.
- Produces: `/v1/health`, `/v1/printers`, staged job endpoints, `PrintJobService`, and job-state DTOs for Task 6.

- [ ] **Step 1: Write failing idempotency, all-assets-before-print, and partial-submit tests**

```csharp
[Fact]
public async Task Duplicate_job_id_returns_existing_state_without_respooling() { /* fake spooler count stays 1 */ }

[Fact]
public async Task Commit_rejects_missing_asset_before_any_spool_write() { /* count stays 0 */ }

[Fact]
public async Task Second_page_failure_records_first_submitted_and_second_failed() { /* status Partial */ }
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `dotnet test print-helper/LabelPrintHelper.sln --filter "PrintJobService|PrintEndpoints"`

Expected: FAIL.

- [ ] **Step 3: Implement staged job storage**

Use `%LOCALAPPDATA%\LabelPrintHelper\jobs\<jobId>` for temporary PNG assets and one JSON metadata record. Persist only job ID, page ordinals, hashes, Windows job IDs, timestamps, and status after completion. Delete bitmap files after `submitted`, after terminal failure, or after a 24-hour abandoned-upload timeout.

- [ ] **Step 4: Implement the three-stage API**

```text
POST /v1/jobs                         create validated manifest
PUT  /v1/jobs/{jobId}/assets/{id}     idempotently upload one unique PNG asset
POST /v1/jobs/{jobId}/commit          validate all assets, then submit sequence
GET  /v1/jobs/{jobId}                 return current status and per-page outcomes
```

Return `409` for a changed payload under an existing ID, `422` for domain validation, and the original state for an identical retry.

- [ ] **Step 5: Implement printer discovery**

Return stable printer ID, display name, default flag, and best available queue status. Mark names containing `XP-420B` as compatible, but do not silently select an incompatible printer.

- [ ] **Step 6: Implement sequential submission with no automatic retry**

Validate every referenced asset and hash before the first spool write. Submit sequence entries one at a time, storing the Windows job ID immediately. On failure, mark `partial` when at least one page was submitted; otherwise `failed`. Use `unknown` if the helper cannot determine whether `WritePrinter` completed.

- [ ] **Step 7: Run all helper tests and report without committing**

Run: `dotnet test print-helper/LabelPrintHelper.sln`

Expected: PASS. Include idempotency and partial-failure evidence; do not commit.

---

### Task 5: Render the existing label layout to the exact printer bitmap

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/features/PrintBitmapSurface.tsx`
- Create: `src/features/PrintBitmapPreview.tsx`
- Create: `src/services/printBitmapRenderer.ts`
- Create: `tests/print-bitmap.spec.tsx`
- Modify: `src/features/PrintTextLayer.tsx`

**Interfaces:**
- Consumes: `XP420B_100X75_PROFILE`, existing `PrintTextLayer`, `resolvePrintArea`, `PrintLayout`, and `PrintRotation`.
- Produces: `PrintBitmapSurface`, `PrintBitmapPreview`, and `renderPrintAsset(page, layout, rotation, threshold)` returning `{ assetId, labelId, widthDots, heightDots, pngBase64, sha256 }`.

- [ ] **Step 1: Add `html-to-image` with an exact version**

Run: `pnpm add html-to-image@1.11.13`

Expected: `package.json` and lockfile record version `1.11.13`.

- [ ] **Step 2: Write failing static-render and rasterizer-adapter tests**

```ts
const html = renderToStaticMarkup(<PrintBitmapSurface page={page} layout="landscape" rotation={0} />);
expect(html).toContain('width:800px');
expect(html).toContain('height:600px');
expect(html).not.toContain('@page');

expect(toPng).toHaveBeenCalledWith(node, expect.objectContaining({
  width: 800, height: 600, canvasWidth: 800, canvasHeight: 600, pixelRatio: 1,
}));
```

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm vitest run tests/print-bitmap.spec.tsx`

Expected: FAIL because the bitmap components do not exist.

- [ ] **Step 4: Implement the canonical dot-sized surface**

Render a white `800 × 600 px` surface. Convert millimeter offsets and print-area geometry with `8 dots/mm`. Reuse `PrintTextLayer` with a scale that maps physical points to printer dots. Apply content/layout rotation inside the fixed physical surface; never swap the output bitmap away from 800×600.

- [ ] **Step 5: Implement PNG capture and hashing**

Wait for `document.fonts.ready`, reject missing font faces and out-of-bounds content, call `toPng` with `pixelRatio: 1`, explicit canvas dimensions, white background, and no cache-busting network fetches. Convert the data URL to bytes and compute SHA-256 using `crypto.subtle.digest`.

- [ ] **Step 6: Make preview consume the same surface**

`PrintBitmapPreview` scales the canonical surface with CSS only. Page navigation changes which real surface is shown; it must not recalculate positions independently.

- [ ] **Step 7: Run focused, layout, and rotation tests**

Run: `pnpm vitest run tests/print-bitmap.spec.tsx tests/print-layout.spec.tsx tests/print-rotation.spec.tsx`

Expected: PASS.

- [ ] **Step 8: Report checkpoint without committing**

Report the dependency, exact bitmap size, and regression results; do not commit.

---

### Task 6: Connect the website to the helper without retrying print submission

**Files:**
- Create: `src/services/printHelperClient.ts`
- Create: `src/features/usePrintHelper.ts`
- Create: `tests/print-helper-client.spec.ts`

**Interfaces:**
- Consumes: Task 1 manifests/assets and Task 4 endpoint shapes.
- Produces: `PrintHelperClient`, `PrintHelperConnectionState`, and `usePrintHelper()` for Tasks 7 and 8.

- [ ] **Step 1: Write failing client tests for discovery, timeout, upload, commit, and no retry**

```ts
await expect(client.health()).resolves.toMatchObject({ protocolVersion: 1 });
await expect(client.submitJob(manifest, assets, signal)).resolves.toMatchObject({ status: 'submitted' });
expect(fetchMock).toHaveBeenCalledTimes(2 + assets.length); // create + one request per asset + commit
expect(commitCalls).toBe(1);
```

Also assert that a failed or timed-out commit is surfaced once and never automatically called again.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm vitest run tests/print-helper-client.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement a typed loopback client**

Use `https://localhost:17653/v1`, `AbortController`, JSON content types, bearer pairing token, and stable error codes. Health/printer/status reads may retry only on explicit refresh; `POST /jobs`, asset uploads, and commit never retry automatically.

- [ ] **Step 4: Implement the connection hook state machine**

```ts
type PrintHelperConnectionState =
  | { kind: 'checking' }
  | { kind: 'not-installed' }
  | { kind: 'pairing-required'; requestId: string }
  | { kind: 'version-mismatch'; helperVersion: string }
  | { kind: 'ready'; printers: PrinterSummary[] }
  | { kind: 'error'; message: string };
```

Store only the pairing token and selected printer ID in versioned local storage keys. Clear them when the helper returns `401`.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run tests/print-helper-client.spec.ts`

Expected: PASS.

- [ ] **Step 6: Report checkpoint without committing**

Report state coverage and prove commit is never retried; do not commit.

---

### Task 7: Redesign the print review dialog as the website-owned direct-print UI

**Files:**
- Modify: `src/features/PrintReviewDialog.tsx`
- Modify: `src/styles.css`
- Create: `tests/direct-print-dialog.spec.tsx`
- Modify: `tests/print-rotation.spec.tsx`
- Modify: `tests/accessibility.spec.tsx`

**Interfaces:**
- Consumes: `PrintBitmapPreview`, `PrintHelperConnectionState`, printers, group/layout/rotation state.
- Produces: validated `DirectPrintDialogSubmission` through `onDirectPrint(settings)` and `onEmergencyBrowserPrint(group, layout)`.

- [ ] **Step 1: Write failing interaction tests for the approved fields**

Assert the open dialog contains helper status, XP-420B printer selector, fixed `100 × 75 mm`, all/custom range, from/to, copies default 1, collate, direction, horizontal/vertical offsets, threshold mode, calibration, bitmap preview, page navigation, final count formula, and `直接打印`.

- [ ] **Step 2: Write failing state/error tests**

Verify `直接打印` is disabled for not installed, not paired, no compatible printer, non-100×75 group, invalid range, rendering error, and submitting. Verify settings remain after a refresh or submission error.

- [ ] **Step 3: Write failing keyboard/focus tests**

Tab must loop through every enabled button/input/select, Escape closes only when not submitting, initial focus goes to Close/Cancel, and close restores the trigger. Live regions announce connection and submission status.

- [ ] **Step 4: Run focused tests and verify failure**

Run: `pnpm vitest run tests/direct-print-dialog.spec.tsx tests/accessibility.spec.tsx`

Expected: FAIL.

- [ ] **Step 5: Implement the two-column dialog without browser-owned controls**

Use native inputs/selects consistent with `DESIGN.md`. Keep the left settings column and right canonical bitmap preview. On narrow screens stack settings above preview. Do not call `alert`, `confirm`, `prompt`, or `window.print` from the component.

- [ ] **Step 6: Implement submit summary and error recovery copy**

Show `所选 N 张 × M 份 = 将发送 K 张实体标签`. On `partial` or `unknown`, show submitted ordinals and a deliberate `从第 X 张创建新任务` action; never label it “重试”.

- [ ] **Step 7: Add explicit emergency printing disclosure**

Place `浏览器打印（应急）` under `更多操作`; activating it must require one app-owned confirmation explaining that the browser dialog may again split pages if paper settings differ.

- [ ] **Step 8: Run dialog, accessibility, and rotation tests**

Run: `pnpm vitest run tests/direct-print-dialog.spec.tsx tests/accessibility.spec.tsx tests/print-rotation.spec.tsx`

Expected: PASS.

- [ ] **Step 9: Report checkpoint without committing**

Provide a screenshot/diff summary and focused test result; do not commit.

---

### Task 8: Orchestrate rendering, staged upload, progress, and emergency fallback in App

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/features/PrintPages.tsx`
- Modify: `tests/app.spec.tsx`
- Modify: `tests/print-layout.spec.tsx`

**Interfaces:**
- Consumes: `usePrintHelper`, bitmap renderer, direct-print manifest functions, and dialog submission.
- Produces: the complete user workflow from `检查并打印` to helper job status.

- [ ] **Step 1: Write a failing app test proving normal print never calls `window.print`**

```ts
await user.click(screen.getByRole('button', { name: '检查并打印' }));
await user.click(screen.getByRole('button', { name: '直接打印' }));
expect(window.print).not.toHaveBeenCalled();
expect(fakeHelper.submittedManifest.expectedLabels).toBe(1);
```

- [ ] **Step 2: Write failing tests for progress, deduplicated assets, and emergency fallback**

Two copies of the same label should upload one hashed asset but create two sequence entries. Emergency print should be the only path that calls `window.print`.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm vitest run tests/app.spec.tsx tests/print-layout.spec.tsx`

Expected: FAIL.

- [ ] **Step 4: Replace the primary `activePrintJob` browser effect**

Keep browser print state only as `emergencyBrowserPrintJob`. The normal submit handler renders unique label/layout/rotation combinations sequentially, builds the manifest and sequence, uploads assets, commits once, then polls only the created job status.

- [ ] **Step 5: Prevent duplicate user submissions**

Generate the job ID once per deliberate click, store it in component state before rendering starts, disable controls through terminal/unknown state, and reuse the same ID when reconnecting to query status. Never generate a new ID as part of error handling.

- [ ] **Step 6: Preserve existing print history semantics**

Record the selected `100 × 75 mm` size only after the helper accepts the manifest. Update the global status with `正在生成`, `正在上传 X/Y`, `已提交 N 张`, `部分提交`, or `状态不明`.

- [ ] **Step 7: Run app and print regressions**

Run: `pnpm vitest run tests/app.spec.tsx tests/print-layout.spec.tsx tests/printing.spec.ts tests/print-rotation.spec.tsx`

Expected: PASS.

- [ ] **Step 8: Report checkpoint without committing**

Report that normal printing makes zero `window.print` calls and that asset deduplication preserves physical sequence count; do not commit.

---

### Task 9: Add loopback TLS, exact-origin authorization, and one-time pairing

**Files:**
- Create: `print-helper/src/LabelPrintHelper/Security/LoopbackCertificateManager.cs`
- Create: `print-helper/src/LabelPrintHelper/Security/PairingStore.cs`
- Create: `print-helper/src/LabelPrintHelper/Security/OriginAuthorizationMiddleware.cs`
- Create: `print-helper/src/LabelPrintHelper/Api/PairingEndpoints.cs`
- Create: `print-helper/src/LabelPrintHelper/Tray/PairingApprovalForm.cs`
- Create: `print-helper/tests/LabelPrintHelper.Tests/SecurityTests.cs`
- Modify: `print-helper/src/LabelPrintHelper/Program.cs`

**Interfaces:**
- Consumes: helper endpoints from Task 4 and bearer token behavior from Task 6.
- Produces: trusted `https://localhost:17653`, pairing request/approval/token flow, and endpoint authorization.

- [ ] **Step 1: Write failing security tests**

Test exact production origin acceptance, lookalike/subdomain rejection, absent Origin rejection outside health, arbitrary-path JSON rejection, invalid/expired token `401`, and same-origin token success.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `dotnet test print-helper/LabelPrintHelper.sln --filter SecurityTests`

Expected: FAIL.

- [ ] **Step 3: Implement a scoped localhost certificate**

Create an ECDSA certificate with SAN `localhost` and `127.0.0.1`, server-auth EKU only, a non-exportable private key, and a product-specific marker. Store it in the current user's certificate stores, bind Kestrel only to loopback port `17653`, and remove only the marked certificate during explicit uninstall.

- [ ] **Step 4: Implement exact-origin middleware**

Production allowlist contains only `https://label-printing-workbench.pages.dev`. Development builds may add the configured Vite origin. Return CORS headers only after exact URI-origin comparison; never use suffix matching or `*`.

- [ ] **Step 5: Implement one-time pairing**

`POST /v1/pairing-requests` creates a short-lived request and displays `PairingApprovalForm` with the exact origin. Approval returns a random 256-bit bearer token once. Store only a SHA-256 token hash protected with DPAPI and an approved-origin record. Denial and expiry return stable states.

- [ ] **Step 6: Protect every printer, asset, job, status, and calibration endpoint**

Health and pairing-request creation are the only unauthenticated endpoints. Rate-limit pairing attempts and reject payloads over configured bounds before JSON deserialization.

- [ ] **Step 7: Run all helper tests**

Run: `dotnet test print-helper/LabelPrintHelper.sln`

Expected: PASS.

- [ ] **Step 8: Report checkpoint without committing**

Report origin/token/TLS coverage and certificate cleanup behavior; do not commit.

---

### Task 10: Add tray lifecycle, printer calibration, protocol launch, and installer

**Files:**
- Create: `print-helper/src/LabelPrintHelper/Tray/TrayApplicationContext.cs`
- Create: `print-helper/src/LabelPrintHelper/Tray/DiagnosticsForm.cs`
- Create: `print-helper/src/LabelPrintHelper/Configuration/PrinterProfileStore.cs`
- Create: `print-helper/src/LabelPrintHelper/Printing/CalibrationService.cs`
- Create: `print-helper/installer/LabelPrintHelper.iss`
- Create: `print-helper/scripts/build-installer.ps1`
- Create: `print-helper/tests/LabelPrintHelper.Tests/CalibrationServiceTests.cs`
- Modify: `print-helper/src/LabelPrintHelper/Program.cs`

**Interfaces:**
- Consumes: TLS/pairing host, printer catalog, RAW spooler, and profile model.
- Produces: background startup, `labelprint://start`, diagnostics, verified media profile, and install/uninstall package.

- [ ] **Step 1: Write failing calibration/profile tests**

Verify that production printing is blocked without a verified sensor profile, calibration stores media type/gap/offset with a version and timestamp, and generated calibration commands never include `PRINT` unless the user explicitly selects test print.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `dotnet test print-helper/LabelPrintHelper.sln --filter CalibrationServiceTests`

Expected: FAIL.

- [ ] **Step 3: Implement tray and single-instance startup**

Use a named mutex. A second launch signals the running instance and exits. The tray menu exposes connection status, selected printer, open diagnostics, test print, start calibration, and exit. Normal HTTP print requests never open a native print dialog.

- [ ] **Step 4: Implement explicit calibration**

Support gap, black-mark, and continuous media profiles. Generate the XP-420B TSPL sensor-calibration command through `CalibrationService`, then require one explicit `100 × 75 mm` border/test print before marking the profile verified. Store the exact command dialect proven by hardware testing.

- [ ] **Step 5: Register the helper launch protocol**

`labelprint://start` only starts or focuses diagnostics; it cannot carry print content or arbitrary arguments. The website uses it only when the health endpoint is unavailable.

- [ ] **Step 6: Publish the self-contained helper**

Run:

```powershell
dotnet publish print-helper/src/LabelPrintHelper/LabelPrintHelper.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false
```

Expected: a runnable helper that requires no separately installed .NET Runtime.

- [ ] **Step 7: Create the Inno Setup package**

The installer installs per-user under `%LOCALAPPDATA%\Programs\LabelPrintHelper`, registers Start Menu/uninstall, HKCU startup, and `labelprint://start`. Uninstall stops the helper, removes only product files/registry entries, calls certificate cleanup, and retains no label bitmaps.

- [ ] **Step 8: Build or document the tool prerequisite**

Run: `print-helper/scripts/build-installer.ps1`. If Inno Setup is absent, the script must stop with the exact official download/install instruction; do not download it silently. Once available, output `artifacts/LabelPrintHelper-Setup.exe`.

- [ ] **Step 9: Run helper tests and installer smoke checks**

Run: `dotnet test print-helper/LabelPrintHelper.sln` and install/uninstall in a disposable Windows user profile. Confirm startup, protocol launch, localhost health, and certificate removal.

- [ ] **Step 10: Report checkpoint without committing**

Report publish size, installer hash, install/uninstall evidence, and unsigned/code-signing status; do not commit.

---

### Task 11: Reconcile product contracts, perform end-to-end verification, and run XP-420B acceptance

**Files:**
- Modify: `DESIGN.md`
- Modify: `UX-CONTRACT.md`
- Modify: `premium-ui.json`
- Create: `docs/direct-printing-setup.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: release-ready documentation, static/runtime verification evidence, and a hardware acceptance record.

- [ ] **Step 1: Update the canonical UI and workflow contracts**

Add `Direct Printer Bridge` to `premium-ui.json` with evidence in `tests/direct-print-dialog.spec.tsx`. Update `DESIGN.md` and `UX-CONTRACT.md` so direct print is primary, browser print is emergency-only, helper states are canonical, and `100 × 75 mm` bitmap preview owns final output geometry.

- [ ] **Step 2: Write the operator setup guide**

Document download, first install, pairing, XP-420B selection, sensor calibration, test print, normal printing, offline/partial/unknown recovery, version upgrade, emergency browser print, and complete uninstall. Include no passwords, tokens, certificate private keys, or real labels.

- [ ] **Step 3: Ignore only generated helper artifacts**

Add narrow entries for `print-helper/**/bin/`, `print-helper/**/obj/`, and `/artifacts/`; do not ignore source, installer script, schemas, or fixtures.

- [ ] **Step 4: Run complete automated verification**

Run:

```powershell
pnpm test
pnpm run test:a11y
pnpm run typecheck
pnpm run build
dotnet test print-helper/LabelPrintHelper.sln -c Release
dotnet publish print-helper/src/LabelPrintHelper/LabelPrintHelper.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false
```

Expected: every command exits 0.

- [ ] **Step 5: Run strict UI audit and anti-pattern scan**

Run the frontend-design-premium strict audit against the worktree, then search changed code for native `alert/confirm/prompt`, normal-flow `window.print`, wildcard CORS, submit retries, and non-semantic click targets. Fix every blocking finding in direct-printing scope and rerun.

- [ ] **Step 6: Exercise the real website/helper flow in Edge or Chrome**

Verify install detection, launch, pairing, printer list, 100×75-only validation, page range, copies, collate, offsets, threshold, keyboard focus, 390px layout, helper restart, and page refresh recovery. Confirm normal `直接打印` never opens the browser dialog.

- [ ] **Step 7: Run the real XP-420B hardware acceptance sequence**

With actual `100 × 75 mm` media, print and photograph/log:

1. calibration/test border;
2. one text label → exactly one physical label;
3. ten labels → exactly ten physical labels;
4. multiline/max-size/border/rotation/image/positive and negative offset cases;
5. two copies with collated and uncollated order;
6. offline, out-of-paper, disconnect, partial submit, and status-unknown recovery;
7. Windows restart → helper autostarts → website reconnects.

- [ ] **Step 8: Gate production default on hardware evidence**

If any single content still spans two labels, keep browser/direct-print defaults unchanged, retain the generated `.prn` task artifact without label content, and investigate the first differing boundary: 800×600 PNG, packed bitmap, TSPL `SIZE`, sensor profile, spool bytes, or physical media calibration.

- [ ] **Step 9: Produce the final diff and verification report without committing**

Run `git status --short`, `git diff --stat`, and `git diff --check`. Report changed files, exact command results, installer path/hash, hardware results, and unresolved risks. Leave all changes uncommitted unless the user separately requests a commit.
