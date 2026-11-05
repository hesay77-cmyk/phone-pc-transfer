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
