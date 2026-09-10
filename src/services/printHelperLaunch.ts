export type PrintHelperLaunchTarget = 'start' | 'calibrate';

const PRINT_HELPER_LAUNCH_URLS: Record<PrintHelperLaunchTarget, string> = {
  start: 'labelprint://start',
  calibrate: 'labelprint://calibrate',
};

export function launchPrintHelper(target: PrintHelperLaunchTarget, documentRef: Document = document): void {
  const anchor = documentRef.createElement('a');
  anchor.href = PRINT_HELPER_LAUNCH_URLS[target];
  anchor.hidden = true;
  anchor.rel = 'noopener noreferrer';
  documentRef.body.append(anchor);
  anchor.click();
  anchor.remove();
}
