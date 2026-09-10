// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createLabel, type SizePreset } from '../src/domain/labels';
import { createPrintPlan } from '../src/domain/printing';
import PrintReviewDialog, {
  type DirectPrintDialogSubmission,
  type DirectPrintLifecycleState,
  type PrintReviewDialogModeProps,
} from '../src/features/PrintReviewDialog';
import type { PrintHelperCalibrationState, PrintHelperConnectionState } from '../src/features/usePrintHelper';
import styles from '../src/styles.css?raw';

const preset100x75: SizePreset = {
  id: 'xp420b', name: 'XP-420B 标签', widthMm: 100, heightMm: 75,
  paddingMm: 5, maxFontSize: 56, minFontSize: 12, paperSize: 'custom',
};

function makePlan(count = 3) {
  return createPrintPlan([createLabel({
    content: 'MECHE\n08065289076', quantity: count, source: 'manual',
    sizePresetId: preset100x75.id, needsReview: false,
  })], [preset100x75]);
}

const ready = { kind: 'ready', printers: [{
  id: 'xp-420b-usb', displayName: 'Xprinter XP-420B', isDefault: true,
  isCompatible: true, isAvailable: true, queueStatus: 'Ready',
}] } satisfies PrintHelperConnectionState;

const verifiedCalibration: PrintHelperCalibrationState = {
  kind: 'verified', printerId: 'xp-420b-usb', profileRevision: '11111111111111111111111111111111',
};

function directProps(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'direct' as const,
    open: true,
    plan: makePlan(),
    rotations: {},
    layouts: {},
    onClose: vi.fn(),
    onEditLabel: vi.fn(),
    onRotateLabel: vi.fn(),
    onLayoutChange: vi.fn(),
    onPrintGroup: vi.fn(),
    connectionState: ready,
    calibrationState: verifiedCalibration,
    selectedPrinterId: 'xp-420b-usb',
    onLaunchHelper: vi.fn(),
    onSelectedPrinterIdChange: vi.fn(),
    onRefreshHelper: vi.fn(),
    onPairHelper: vi.fn(),
    onCalibratePrinter: vi.fn(),
    directPrintState: { kind: 'idle' } satisfies DirectPrintLifecycleState,
    onDirectPrint: vi.fn(),
    onCreateRemainingTask: vi.fn(),
    onEmergencyBrowserPrint: vi.fn(),
    ...overrides,
  };
}

afterEach(cleanup);

describe('网站直接打印对话框', () => {
  it('显式直打模式在类型层要求所有可见动作都有处理器', () => {
    type DirectMode = Extract<PrintReviewDialogModeProps, { mode: 'direct' }>;
    type RequiredActions = {
      selectedPrinterId: string | null;
      onSelectedPrinterIdChange: (printerId: string | null) => void;
      onLaunchHelper: () => void;
      onRefreshHelper: () => void;
      onPairHelper: () => void;
      onCalibratePrinter: (printer: (typeof ready.printers)[number]) => void;
      onCreateRemainingTask: (nextOrdinal: number) => void;
      onEmergencyBrowserPrint: (...args: never[]) => void;
    };
    expectTypeOf<DirectMode>().toMatchTypeOf<RequiredActions>();
  });

  it('显式直打模式在未选打印机时仍显示安装恢复界面', () => {
    render(<PrintReviewDialog {...directProps({
      connectionState: { kind: 'not-installed' },
      calibrationState: { kind: 'not-selected' },
      selectedPrinterId: null,
    })} />);

    expect(screen.getByRole('dialog', { name: '直接打印标签' })).toBeTruthy();
    expect(screen.getByText('未检测到打印助手')).toBeTruthy();
    expect(screen.getByRole('button', { name: '启动/打开打印助手' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新连接' })).toBeTruthy();
  });

  it('校准未验证时显示原因并禁止提交，验证后才允许直接打印', () => {
    const { rerender } = render(<PrintReviewDialog {...directProps({
      calibrationState: { kind: 'unverified', printerId: 'xp-420b-usb' },
    })} />);

    expect(screen.getByText(/校准未验证/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '直接打印' }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<PrintReviewDialog {...directProps({ calibrationState: verifiedCalibration })} />);
    expect(screen.queryByText(/校准未验证/)).toBeNull();
    expect((screen.getByRole('button', { name: '直接打印' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('显示已确认的设置、位图预览、页码和准确的最终张数', async () => {
    const user = userEvent.setup();
    const onDirectPrint = vi.fn<(submission: DirectPrintDialogSubmission) => void>();
    render(<PrintReviewDialog {...directProps({ onDirectPrint })} />);

    expect(screen.getByRole('dialog', { name: '直接打印标签' })).toBeTruthy();
    expect(screen.getByText('打印助手已连接')).toBeTruthy();
    expect((screen.getByRole('combobox', { name: '打印机' }) as HTMLSelectElement).value).toBe('xp-420b-usb');
    expect(screen.getByText('100 × 75 mm')).toBeTruthy();
    expect(screen.getByRole('img', { name: /100 × 75 mm 标签预览/ })).toBeTruthy();
    expect(screen.getByText('第 1 / 共 3 张')).toBeTruthy();
    expect(screen.getByText('所选 3 张 × 1 份 = 将发送 3 张实体标签')).toBeTruthy();

    await user.click(screen.getByRole('radio', { name: '自定义范围' }));
    await user.clear(screen.getByRole('spinbutton', { name: '起始页' }));
    await user.type(screen.getByRole('spinbutton', { name: '起始页' }), '2');
    await user.clear(screen.getByRole('spinbutton', { name: '结束页' }));
    await user.type(screen.getByRole('spinbutton', { name: '结束页' }), '3');
    await user.clear(screen.getByRole('spinbutton', { name: '打印份数' }));
    await user.type(screen.getByRole('spinbutton', { name: '打印份数' }), '2');
    await user.click(screen.getByRole('checkbox', { name: '逐份打印' }));
    await user.click(screen.getByRole('radio', { name: '纵向' }));
    await user.clear(screen.getByRole('spinbutton', { name: '水平偏移' }));
    await user.type(screen.getByRole('spinbutton', { name: '水平偏移' }), '1.5');
    await user.selectOptions(screen.getByRole('combobox', { name: '黑白阈值' }), 'custom');
    await user.clear(screen.getByRole('spinbutton', { name: '自定义阈值' }));
    await user.type(screen.getByRole('spinbutton', { name: '自定义阈值' }), '140');

    expect(screen.getByText('所选 2 张 × 2 份 = 将发送 4 张实体标签')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '直接打印' }));
    expect(onDirectPrint).toHaveBeenCalledWith(expect.objectContaining({
      printerId: 'xp-420b-usb', printerName: 'Xprinter XP-420B', range: { from: 2, to: 3 },
      copies: 2, collate: true, layout: 'portrait', horizontalOffsetMm: 1.5,
      threshold: { mode: 'custom', value: 140 },
    }));
  });

  it('连接、纸张、字段和提交状态不安全时禁用直接打印且刷新不清空设置', async () => {
    const user = userEvent.setup();
    const onRefreshHelper = vi.fn();
    const { rerender } = render(<PrintReviewDialog {...directProps({
      connectionState: { kind: 'not-installed' }, selectedPrinterId: null, onRefreshHelper,
    })} />);
    expect((screen.getByRole('button', { name: '直接打印' }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(screen.getByRole('spinbutton', { name: '打印份数' }));
    await user.type(screen.getByRole('spinbutton', { name: '打印份数' }), '4');
    await user.click(screen.getByRole('button', { name: '刷新连接' }));
    expect(onRefreshHelper).toHaveBeenCalledOnce();
    expect((screen.getByRole('spinbutton', { name: '打印份数' }) as HTMLInputElement).value).toBe('4');

    rerender(<PrintReviewDialog {...directProps({ directPrintState: { kind: 'submitting' } })} />);
    expect((screen.getByRole('button', { name: '正在提交' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '正在提交' }).getAttribute('aria-busy')).toBe('true');
  });

  it.each<PrintHelperConnectionState>([
    { kind: 'checking' },
    { kind: 'not-installed' },
    { kind: 'pairing-required', requestId: 'pair-1' },
    { kind: 'version-mismatch', helperVersion: '0.9.0' },
    { kind: 'error', message: '连接超时' },
  ])('每一种未就绪助手状态都会说明原因并禁止直接打印：$kind', (connectionState) => {
    render(<PrintReviewDialog {...directProps({ connectionState, selectedPrinterId: null })} />);
    expect((screen.getByRole('button', { name: '直接打印' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('.direct-print-live')?.textContent).not.toBe('');
  });

  it('无兼容打印机、无目标纸张或不合法范围、偏移和阈值时禁止直接打印', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PrintReviewDialog {...directProps({
      connectionState: { kind: 'ready', printers: [{ ...ready.printers[0], isAvailable: false }] },
      selectedPrinterId: 'xp-420b-usb',
    })} />);
    expect((screen.getByRole('button', { name: '直接打印' }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<PrintReviewDialog {...directProps()} />);
    await user.click(screen.getByRole('radio', { name: '自定义范围' }));
    await user.clear(screen.getByRole('spinbutton', { name: '起始页' }));
    await user.type(screen.getByRole('spinbutton', { name: '起始页' }), '3');
    await user.clear(screen.getByRole('spinbutton', { name: '结束页' }));
    await user.type(screen.getByRole('spinbutton', { name: '结束页' }), '2');
    expect((screen.getByRole('button', { name: '直接打印' }) as HTMLButtonElement).disabled).toBe(true);

    await user.clear(screen.getByRole('spinbutton', { name: '结束页' }));
    await user.type(screen.getByRole('spinbutton', { name: '结束页' }), '3');
    await user.clear(screen.getByRole('spinbutton', { name: '水平偏移' }));
    await user.type(screen.getByRole('spinbutton', { name: '水平偏移' }), '11');
    expect((screen.getByRole('button', { name: '直接打印' }) as HTMLButtonElement).disabled).toBe(true);

    await user.clear(screen.getByRole('spinbutton', { name: '水平偏移' }));
    await user.type(screen.getByRole('spinbutton', { name: '水平偏移' }), '0');
    await user.selectOptions(screen.getByRole('combobox', { name: '黑白阈值' }), 'custom');
    await user.clear(screen.getByRole('spinbutton', { name: '自定义阈值' }));
    await user.type(screen.getByRole('spinbutton', { name: '自定义阈值' }), '256');
    expect((screen.getByRole('button', { name: '直接打印' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('字段错误通过关联说明暴露给辅助技术', async () => {
    const user = userEvent.setup();
    render(<PrintReviewDialog {...directProps()} />);
    const copies = screen.getByRole('spinbutton', { name: '打印份数' });
    await user.clear(copies);
    expect(copies.getAttribute('aria-invalid')).toBe('true');
    const errorId = copies.getAttribute('aria-describedby');
    expect(errorId).not.toBeNull();
    expect(document.getElementById(errorId!)).toBeTruthy();
  });

  it('预览导航、打印机选择与校准回调均作用于当前标签', async () => {
    const user = userEvent.setup();
    const onSelectedPrinterIdChange = vi.fn();
    const onCalibratePrinter = vi.fn();
    render(<PrintReviewDialog {...directProps({ onSelectedPrinterIdChange, onCalibratePrinter })} />);
    await user.click(screen.getByRole('button', { name: '下一张' }));
    expect(screen.getByText('第 2 / 共 3 张')).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: '打印机' }), '');
    expect(onSelectedPrinterIdChange).toHaveBeenCalledWith(null);
    await user.click(screen.getByRole('button', { name: '校准打印机' }));
    expect(onCalibratePrinter).toHaveBeenCalledWith(ready.printers[0]);
  });

  it('局部或未知结果明确列出已提交序号并创建剩余新任务', async () => {
    const user = userEvent.setup();
    const onCreateRemainingTask = vi.fn();
    render(<PrintReviewDialog {...directProps({
      directPrintState: { kind: 'partial', submittedOrdinals: [1, 2], nextOrdinal: 3 },
      onCreateRemainingTask,
    })} />);
    expect(screen.getByText(/已提交实体标签：1、2/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '直接打印' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: '从第 3 张创建新任务' }));
    expect(onCreateRemainingTask).toHaveBeenCalledWith(3);
    expect(screen.queryByRole('button', { name: /重试/ })).toBeNull();
  });

  it('未知提交结果也只允许从下一张创建新任务', async () => {
    const user = userEvent.setup();
    const onCreateRemainingTask = vi.fn();
    render(<PrintReviewDialog {...directProps({
      directPrintState: { kind: 'unknown', submittedOrdinals: [1], nextOrdinal: 2 }, onCreateRemainingTask,
    })} />);
    expect(screen.getByText(/已提交实体标签：1/)).toBeTruthy();
    expect(screen.getByText(/先核对打印机实体输出和打印队列/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '直接打印' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '更多操作' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('combobox', { name: '打印机' }).matches(':disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: '从第 2 张创建新任务' }));
    expect(onCreateRemainingTask).toHaveBeenCalledWith(2);
  });

  it('仅渲染错误阻止重新提交，已确认未提交的上传或提交错误保留安全重试入口', () => {
    const { rerender } = render(<PrintReviewDialog {...directProps({
      directPrintState: { kind: 'error', phase: 'rendering', message: '位图越界' },
    })} />);
    expect((screen.getByRole('button', { name: '直接打印' }) as HTMLButtonElement).disabled).toBe(true);

    rerender(<PrintReviewDialog {...directProps({
      directPrintState: { kind: 'error', phase: 'uploading', message: '上传未开始' },
    })} />);
    expect((screen.getByRole('button', { name: '直接打印' }) as HTMLButtonElement).disabled).toBe(false);

    rerender(<PrintReviewDialog {...directProps({
      directPrintState: { kind: 'error', phase: 'submitting', message: '助手明确拒绝任务' },
    })} />);
    expect((screen.getByRole('button', { name: '直接打印' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('不可逆操作在父状态更新前也会同步防止快速重复激活', async () => {
    const user = userEvent.setup();
    const onDirectPrint = vi.fn();
    const onEmergencyBrowserPrint = vi.fn();
    const { rerender } = render(<PrintReviewDialog {...directProps({ onDirectPrint, onEmergencyBrowserPrint })} />);
    const submit = screen.getByRole('button', { name: '直接打印' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(onDirectPrint).toHaveBeenCalledOnce();

    rerender(<PrintReviewDialog {...directProps({
      directPrintState: { kind: 'partial', submittedOrdinals: [1], nextOrdinal: 2 },
      onCreateRemainingTask: onDirectPrint,
    })} />);
    const remaining = screen.getByRole('button', { name: '从第 2 张创建新任务' });
    fireEvent.click(remaining);
    fireEvent.click(remaining);
    expect(onDirectPrint).toHaveBeenCalledTimes(2);

    cleanup();
    render(<PrintReviewDialog {...directProps({ onEmergencyBrowserPrint })} />);
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('button', { name: '浏览器打印（应急）' }));
    const emergency = screen.getByRole('button', { name: '仍然打开浏览器打印' });
    fireEvent.click(emergency);
    fireEvent.click(emergency);
    expect(onEmergencyBrowserPrint).toHaveBeenCalledOnce();
  });

  it('提交处理中冻结设置、连接、校准、预览和应急打印操作', async () => {
    const user = userEvent.setup();
    const onEmergencyBrowserPrint = vi.fn();
    const { rerender } = render(<PrintReviewDialog {...directProps({ onEmergencyBrowserPrint })} />);
    await user.click(screen.getByRole('button', { name: '更多操作' }));
    await user.click(screen.getByRole('button', { name: '浏览器打印（应急）' }));

    rerender(<PrintReviewDialog {...directProps({
      directPrintState: { kind: 'uploading' }, onEmergencyBrowserPrint,
    })} />);

    const dialog = screen.getByRole('dialog', { name: '直接打印标签' });
    for (const control of dialog.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button,input,select')) {
      expect(control.matches(':disabled'), control.getAttribute('aria-label') ?? control.textContent ?? control.tagName).toBe(true);
    }
    fireEvent.click(screen.getByRole('button', { name: '仍然打开浏览器打印' }));
    expect(onEmergencyBrowserPrint).not.toHaveBeenCalled();
  });

  it('显示当前文字旋转并只旋转当前预览标签', async () => {
    const user = userEvent.setup();
    const onRotateLabel = vi.fn();
    const plan = makePlan();
    const labelId = plan.groups[0].pages[0].label.id;
    render(<PrintReviewDialog {...directProps({ plan, rotations: { [labelId]: 90 }, onRotateLabel })} />);

    expect(screen.getByText('当前 90°')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '旋转当前文字标签 90°' }));
    expect(onRotateLabel).toHaveBeenCalledWith(labelId);
  });

  it('直接打印新增样式只通过设计令牌表达颜色', () => {
    const start = styles.indexOf('.direct-print-dialog');
    const end = styles.indexOf('.shortcut-dialog', start);
    expect(styles.slice(start, end)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(styles.slice(start, end)).not.toMatch(/rgba?\(/i);
  });

  it('应急浏览器打印经过应用内确认，只有确认后才回调', async () => {
    const user = userEvent.setup();
    const onEmergencyBrowserPrint = vi.fn();
    render(<PrintReviewDialog {...directProps({ onEmergencyBrowserPrint })} />);
    await user.click(screen.getByText('更多操作'));
    await user.click(screen.getByRole('button', { name: '浏览器打印（应急）' }));
    expect(screen.getByText(/纸张设置不一致，内容可能再次被拆分到两张纸/)).toBeTruthy();
    expect(onEmergencyBrowserPrint).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '仍然打开浏览器打印' }));
    expect(onEmergencyBrowserPrint).toHaveBeenCalledOnce();
  });
});

describe('直接打印对话框焦点', () => {
  it('打开聚焦关闭按钮，完整约束 Tab；忙碌时 Escape 和背景不关闭', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(<PrintReviewDialog {...directProps({ onClose })} />);
    const close = screen.getByRole('button', { name: '关闭' });
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByText('更多操作'));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    cleanup();
    const busy = render(<PrintReviewDialog {...directProps({ onClose, directPrintState: { kind: 'uploading' } })} />);
    await user.keyboard('{Escape}');
    fireEvent.mouseDown(busy.container.querySelector('.dialog-backdrop')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(container).toBeTruthy();
  });

  it('生命周期切换为忙碌时不重置模态状态，并把外部 Tab 拉回对话框', () => {
    const trigger = document.createElement('button');
    trigger.textContent = '打开打印';
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { rerender } = render(<PrintReviewDialog {...directProps({ onClose })} />);
    const copies = screen.getByRole('spinbutton', { name: '打印份数' });
    copies.focus();

    rerender(<PrintReviewDialog {...directProps({ onClose, directPrintState: { kind: 'uploading' } })} />);
    const dialog = screen.getByRole('dialog', { name: '直接打印标签' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    trigger.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    trigger.remove();
  });
});
