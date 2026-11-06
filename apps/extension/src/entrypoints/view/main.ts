// 「看照片」页面：侧边栏的照片拖进 Chrome（新标签页、标签栏、网页空白处）时打开的就是它，像 Chrome 看图片一样显示原图。
import { getFile } from '../../lib/files';
import { lang, t } from '../../lib/i18n';
import { disarmPageDropSoon, servePageDrop, startPhotoDrag } from '../../lib/pagedrop';

const q = new URLSearchParams(location.search);
const id = q.get('id') || '';
const name = q.get('name') || t.photoTitle;
const msg = document.getElementById('msg')!;
document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
msg.textContent = t.openingPhoto;

// 只在自己的标签页里显示，别的网页嵌不进来
if (window.top === window) {
  document.title = name;
  servePageDrop();
  void getFile(id).then((blob) => {
    if (!blob) { msg.textContent = t.viewGone; return; }
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    img.alt = name;
    img.onclick = () => { img.classList.toggle('full'); document.body.classList.toggle('full'); };
    // 从这里也能接着拖进别的网页
    img.ondragstart = (e) => startPhotoDrag(e, { id, name });
    img.ondragend = () => disarmPageDropSoon();
    msg.replaceWith(img);
  });
} else {
  msg.textContent = '';
}
