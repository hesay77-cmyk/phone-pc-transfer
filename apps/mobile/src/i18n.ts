// 手机网页上给用户看的文字：中文、英文两份。跟随手机的语言（中文手机中文，其他都英文）。

import { currentLang } from '@hutong/core';

const zh = {
  confirmRepair: '要换成新的配对吗？\n电脑上刚换了新码、或者要连另一台电脑，点「好」；不知道这个链接是哪来的，点「取消」。',
  confirmClear: '清空「电脑发来的」记录？',
  androidPhone: '安卓手机',
  phone: '手机',
  nChars: (n: number) => `${n} 个字`,
  photoSize: (size: string) => `照片 ${size}`,
  fileSize: (name: string, size: string) => `「${name}」${size}`,
  notYet: (n: number) => `还没连上电脑，连上后会自动发出（${n} 个）`,
  clipUnreadable: '读不到剪贴板。可以在下面的框里长按粘贴，再点发送',
  clipEmpty: '剪贴板是空的，先去别的 App 里复制一段字',
  tooBig: (name: string, size: string, max: string) => `「${name}」太大了（${size}），一次最多发 ${max}`,
  file: '文件',
  copied: '已复制',
  copyFailed: '复制失败',

  // 连接状态
  notPaired: '还没配对',
  connected: (pc: string) => '已连上' + (pc || '电脑'),
  pcOffline: '电脑不在线',
  blocked: '连不上电脑：这个网络不让直连',
  netConnecting: '正在连接网络…',
  pcConnecting: '正在连接电脑…',
  blockedHint: '电脑找到了，但这个 Wi-Fi 不让手机和电脑直接连（有些公司或公共场所的 Wi-Fi 会这样）。手机和电脑换成同一个家里的 Wi-Fi 就能用。这边会一直自动重试。',
  offlineHint: '电脑上的 Chrome 开着吗？手机和电脑连的是同一个 Wi-Fi 吗？会一直自动重试。',
  newerPeer: '电脑上的插件版本比这个网页新，请刷新一下这个网页',

  // 第一次打开
  helloSub: '手机和电脑，点一下就到另一边。',
  helloStandalone: '第一次用，扫一下电脑上的二维码配对（只用扫这一次）。',
  helloBrowser: '用 iPhone 自带的相机扫一下电脑上「Tapaste」插件里的二维码，或者点下面的按钮在这里扫。',
  scanToPair: '扫码配对',
  noQr: '电脑上没看到二维码？点开 Tapaste 侧边栏，在最下面点「换一台手机 / 显示二维码」。',

  // 放到手机桌面
  homeTitle: '把 Tapaste 放到手机桌面',
  homeSub: '下次点图标就能用，不用再找网页。',
  howTo: '怎么放？',
  noThanks: '不用了',
  homeSteps: '放到手机桌面',
  stepShareChrome: '点地址栏右边的「分享」按钮（方框带向上的箭头）。找不到就点右下角「…」，再点「分享」。',
  stepShareSafari: '点屏幕下方的「分享」按钮（方框带向上的箭头）。',
  stepAdd: '往下滑，点「添加到主屏幕」。',
  stepConfirm: '右上角点「添加」。',
  stepOpen: '从桌面打开「Tapaste」，如果提示配对，点「扫码配对」扫一下电脑上的码（只用扫这一次）。',
  done: '放好了',
  later: '先收起',

  // 发送
  pasteSend: '粘贴并发送到电脑',
  sendFiles: '发照片或文件到电脑',
  typeHere: '或者在这里打字',
  send: '发送',
  stDone: '电脑已收到 ✓',
  stCancelled: '已取消，不发了',
  stExpired: '放了一天也没送到，不发了',
  stFailed: '没发出去',
  stSending: (pct?: number) => `发送中${pct !== undefined ? ` ${pct}%` : '…'}`,
  stWaiting: '等连上电脑后自动发',
  dontSend: '不发了',
  deleteOne: '删除这一条',

  // 电脑发来的
  fromPc: '电脑发来的',
  recvDone: '收好了，正在保存…',
  recvLost: '连接断了，电脑会重新发…',
  receiving: '正在接收',
  empty: '还没有。电脑上可以在网页里右键「发到手机」，或者在 Tapaste 侧边栏里发文字、网址、图片、文件过来。',
  cutNote: '太长了，记录里只留了开头',
  openLink: '打开网址',
  copy: '复制',
  clearHistory: '清空记录',
  rescan: '重新扫码配对',
  version: (v: string) => `版本 ${v}`,

  // 照片
  saveToPhotos: '存到相册',
  saveTipImage: '长按上面的图片，选「存储到照片」或「保存图片」',
  copyTipImage: '长按上面的图片，选「拷贝」',
  altImage: '电脑发来的图片',
  imageGone: '图片已经不在了（只保留最近 20 张）',

  // 文件
  saveOrOpen: '存到手机 / 打开',
  fileHint: '点了之后选「存储到文件」，或者选一个 App 打开',
  fileDownloadTip: '如果没反应，在浏览器的「下载」里能找到它',
  fileGone: '文件已经不在了（只保留最近 20 个）',

  // 扫码
  cameraFail: '打不开摄像头。请在弹出的提示里点「允许」；如果之前点了不允许，到手机「设置」里把相机权限打开。',
  notOurQr: '这不是 Tapaste 的二维码。请扫电脑上 Tapaste 侧边栏里的码。',
  aimQr: '把电脑上 Tapaste 侧边栏里的二维码对准上面的框。',
  cancel: '取消'
};

const en: typeof zh = {
  confirmRepair: 'Switch to this new pairing?\nTap OK if you just made a new code on your computer or want to connect to another computer. Tap Cancel if you don\'t know where this link came from.',
  confirmClear: 'Clear everything under "From computer"?',
  androidPhone: 'Android phone',
  phone: 'Phone',
  nChars: (n: number) => `${n} ${n === 1 ? 'character' : 'characters'}`,
  photoSize: (size: string) => `Photo ${size}`,
  fileSize: (name: string, size: string) => `"${name}" ${size}`,
  notYet: (n: number) => `Not connected to your computer yet. ${n === 1 ? 'It' : `All ${n}`} will be sent once connected.`,
  clipUnreadable: "Couldn't read the clipboard. Long-press the box below to paste, then tap Send.",
  clipEmpty: 'Your clipboard is empty. Copy some text in another app first.',
  tooBig: (name: string, size: string, max: string) => `"${name}" is too big (${size}). The limit is ${max} per file.`,
  file: 'File',
  copied: 'Copied',
  copyFailed: 'Copy failed',

  notPaired: 'Not paired yet',
  connected: (pc: string) => `Connected to ${pc || 'your computer'}`,
  pcOffline: 'Computer offline',
  blocked: "Can't reach your computer: this network blocks direct connections",
  netConnecting: 'Connecting…',
  pcConnecting: 'Connecting to your computer…',
  blockedHint: "Found your computer, but this Wi-Fi doesn't let your phone and computer connect directly (some office and public Wi-Fi networks do this). Put both on the same home Wi-Fi and it will work. Tapaste keeps retrying.",
  offlineHint: 'Is Chrome open on your computer? Are your phone and computer on the same Wi-Fi? Tapaste keeps retrying.',
  newerPeer: 'The extension on your computer is newer than this page. Please reload this page.',

  helloSub: 'Phone and computer. One tap and it\'s on the other side.',
  helloStandalone: 'First time here? Scan the QR code on your computer to pair (you only do this once).',
  helloBrowser: 'Scan the QR code in the Tapaste extension on your computer with your iPhone\'s Camera app, or tap the button below to scan here.',
  scanToPair: 'Scan to pair',
  noQr: 'No QR code on your computer? Open the Tapaste side panel and tap "Switch phone / show QR code" at the bottom.',

  homeTitle: 'Add Tapaste to your Home Screen',
  homeSub: 'Next time just tap the icon. No need to find this page.',
  howTo: 'How?',
  noThanks: 'No thanks',
  homeSteps: 'Add to Home Screen',
  stepShareChrome: 'Tap the Share button to the right of the address bar (a box with an arrow pointing up). If you can\'t find it, tap "…" at the bottom right, then "Share".',
  stepShareSafari: 'Tap the Share button at the bottom of the screen (a box with an arrow pointing up).',
  stepAdd: 'Scroll down and tap "Add to Home Screen".',
  stepConfirm: 'Tap "Add" at the top right.',
  stepOpen: 'Open Tapaste from your Home Screen. If it asks you to pair, tap "Scan to pair" and scan the code on your computer (only once).',
  done: 'Done',
  later: 'Later',

  pasteSend: 'Paste & send to computer',
  sendFiles: 'Send photos or files to computer',
  typeHere: 'Or type here',
  send: 'Send',
  stDone: 'Delivered ✓',
  stCancelled: 'Cancelled',
  stExpired: 'Not delivered within a day, gave up',
  stFailed: "Couldn't send",
  stSending: (pct?: number) => (pct !== undefined ? `Sending ${pct}%` : 'Sending…'),
  stWaiting: 'Sends when your computer connects',
  dontSend: "Don't send",
  deleteOne: 'Delete',

  fromPc: 'From computer',
  recvDone: 'Received, saving…',
  recvLost: 'Connection lost, your computer will resend…',
  receiving: 'Receiving',
  empty: 'Nothing yet. On your computer, right-click "Send to phone" on any page, or send text, links, photos and files from the Tapaste side panel.',
  cutNote: 'Too long, so only the beginning is kept here',
  openLink: 'Open link',
  copy: 'Copy',
  clearHistory: 'Clear history',
  rescan: 'Scan to pair again',
  version: (v: string) => `Version ${v}`,

  saveToPhotos: 'Save to Photos',
  saveTipImage: 'Long-press the image above and choose "Save to Photos" or "Save Image".',
  copyTipImage: 'Long-press the image above and choose "Copy".',
  altImage: 'Image from your computer',
  imageGone: 'This image is gone (only the latest 20 are kept)',

  saveOrOpen: 'Save / Open',
  fileHint: 'Then choose "Save to Files", or pick an app to open it',
  fileDownloadTip: "If nothing happens, look for it in your browser's Downloads",
  fileGone: 'This file is gone (only the latest 20 are kept)',

  cameraFail: "Couldn't open the camera. Tap \"Allow\" when asked. If you tapped Don't Allow before, turn on camera access for your browser in Settings.",
  notOurQr: "This isn't a Tapaste QR code. Scan the code in the Tapaste side panel on your computer.",
  aimQr: 'Point the frame above at the QR code in the Tapaste side panel on your computer.',
  cancel: 'Cancel'
};

export const lang = currentLang();
export const L = lang === 'zh' ? zh : en;
