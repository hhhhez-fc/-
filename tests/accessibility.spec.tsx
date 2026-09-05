// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { createInitialDraft } from '../src/domain/draft';
import ConfirmDialog from '../src/features/ConfirmDialog';

afterEach(cleanup);

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>打开清空确认</button>
    <ConfirmDialog
      open={open}
      title="清空当前草稿？"
      message="删除后无法撤销。"
      confirmLabel="清空草稿"
      onCancel={() => setOpen(false)}
      onConfirm={() => setOpen(false)}
    />
  </>;
}

describe('可访问性关键路径', () => {
  it('确认对话框约束 Tab 焦点，Escape 关闭后恢复触发按钮焦点', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const trigger = screen.getByRole('button', { name: '打开清空确认' });
    await user.click(trigger);
    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '清空草稿' });
    expect(document.activeElement).toBe(cancel);

    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('应用状态变化通过 polite live region 公布', async () => {
    const user = userEvent.setup();
    render(<App initialState={createInitialDraft()} />);

    await user.click(screen.getByRole('button', { name: '手动新增' }));
    const status = screen.getByText('已新增一条手动唛头');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });
});
