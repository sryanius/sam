// DOM 잡일 — 요소 만들기, 모달, 토스트.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

/* ─────────────────────────── 모달 ─────────────────────────── */

let modalResolve = null;

/**
 * showModal({ title, body, buttons })
 * buttons: [{ label, value, primary, disabled }]
 * @returns Promise<value|null>
 */
export function showModal({ title, body, buttons = [{ label: '닫기', value: null }], onOpen }) {
  const wrap = $('#modal');
  $('#modal-title-text').textContent = title || '';
  const b = clear($('#modal-body'));
  if (typeof body === 'string') b.innerHTML = body;
  else if (body) b.append(body);

  const foot = clear($('#modal-foot'));
  return new Promise((resolve) => {
    modalResolve = resolve;
    for (const btn of buttons) {
      foot.append(el('button', {
        class: 'btn' + (btn.primary ? ' primary' : ''),
        disabled: btn.disabled,
        onClick: () => closeModal(btn.value),
      }, btn.label));
    }
    wrap.classList.remove('hidden');
    if (onOpen) onOpen(b, foot);
  });
}

export function closeModal(value = null) {
  $('#modal').classList.add('hidden');
  const r = modalResolve;
  modalResolve = null;
  if (r) r(value);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal(null);
});

/* 창 바깥을 누르면 닫는다 — 버튼줄까지 훑어 내려갈 것 없이.
   상자 안에서 시작한 누름이 바깥에서 끝나는 경우(밀어서 고르다 손이 나감)에는
   닫지 않는다. 그래서 pointerdown 위치를 기억해 둔다. */
let downOnBackdrop = false;
$('#modal').addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === $('#modal'); });
$('#modal').addEventListener('click', (e) => {
  if (e.target === $('#modal') && downOnBackdrop) closeModal(null);
  downOnBackdrop = false;
});
$('#modal-x').addEventListener('click', () => closeModal(null));

/* ─────────────────────────── 토스트 ─────────────────────────── */

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

/* ─────────────────────────── 자잘한 것 ─────────────────────────── */

export function bar(value, max, warnBelow = 0.34, badBelow = 0.16) {
  const p = Math.max(0, Math.min(1, value / max));
  const cls = p < badBelow ? 'bar bad' : p < warnBelow ? 'bar warn' : 'bar';
  return el('div', { class: cls }, el('i', { style: { width: `${p * 100}%` } }));
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** 슬라이더 한 줄. get() 으로 현재 값을 읽는다. */
export function slider(label, min, max, value, fmt = (v) => v) {
  const val = el('span', { class: 'val' }, fmt(value));
  const input = el('input', {
    type: 'range', min, max, value,
    onInput: () => { val.textContent = fmt(+input.value); },
  });
  const row = el('div', { class: 'slider-row' }, el('span', {}, label), input, val);
  row.get = () => +input.value;
  return row;
}
