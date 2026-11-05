// 写剪贴板（在引擎里用）。引擎页面永远不是「当前窗口」，
// 新式的写法会报「页面没有焦点」，所以先用老办法：放进输入框、全选、复制。实测在别的软件在前面时也能用。

export async function copyText(text: string): Promise<{ ok: boolean; how: string }> {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  if (ok) return { ok, how: 'execCommand' };
  try {
    await Promise.race([navigator.clipboard.writeText(text), new Promise((_, rej) => setTimeout(() => rej(new Error('超时')), 1500))]);
    return { ok: true, how: 'clipboard API' };
  } catch (e) {
    return { ok: false, how: (e as Error).message };
  }
}

/**
 * 读剪贴板（在引擎里用，Chrome 不在前台时也行）：同样用老办法触发一次「粘贴」，从粘贴事件里拿文字和图片。
 * 需要插件有 clipboardRead 权限。
 */
export function readClipboard(withFiles = true): { ok: boolean; text: string; files: File[] } {
  const box = document.createElement('div');
  box.contentEditable = 'true';
  document.body.appendChild(box);
  box.focus();
  let text = '';
  let files: File[] = [];
  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    text = e.clipboardData?.getData('text/plain') ?? '';
    if (!withFiles) return;
    files = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
  };
  document.addEventListener('paste', onPaste, true);
  let ok = false;
  try { ok = document.execCommand('paste'); } catch { ok = false; }
  document.removeEventListener('paste', onPaste, true);
  box.remove();
  return { ok, text, files };
}
