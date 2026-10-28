// Drag the bottom sheet by its header: its height follows the finger (so the map
// grows or shrinks with it and nothing empty shows between them), then it snaps to
// the expanded or the collapsed state. Only the header is a grab area (touch-action: none
// in CSS), so scrolling the list inside the sheet is untouched.

const MOVE_START_PX = 6;      // below this a press is a tap and the button's click handles it
const SNAP_DISTANCE_PX = 60;  // dragged this far (or half the way, if shorter): switch state
const FLICK_PX_PER_MS = 0.5;  // faster than this: switch state in the flick's direction
const SNAP_MS = 200;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** isCollapsed() -> boolean; setCollapsed(boolean) updates the state and re-renders the sheet. */
export function initSheetDrag(sheet, { isCollapsed, setCollapsed }) {
  let drag = null;
  let suppressClick = false;

  function collapsedHeight() {
    const head = sheet.querySelector('.sheet-head');
    return (head?.offsetHeight ?? 0) + parseFloat(getComputedStyle(sheet).paddingBottom);
  }

  function setHeight(full, y) {
    sheet.style.height = `${full - y}px`;
  }

  function settle(target) {
    const { travel, y, full } = drag;
    const finalY = target ? travel : 0;
    drag = null;
    const done = () => {
      sheet.style.transition = '';
      sheet.style.height = '';
      sheet.style.overflow = '';
      setCollapsed(target);
    };
    if (reducedMotion() || Math.abs(finalY - y) < 1) {
      done();
      return;
    }
    sheet.style.transition = `height ${SNAP_MS}ms ease-out`;
    setHeight(full, finalY);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      done();
    };
    sheet.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, SNAP_MS + 80);
  }

  sheet.addEventListener('pointerdown', (e) => {
    if (drag || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (!e.target.closest('.sheet-head') || e.target.closest('.icon-button')) return;
    drag = {
      id: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, v: 0,
      started: false, startCollapsed: isCollapsed(), travel: 0, y: 0, full: 0,
    };
  });

  sheet.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.startY;
    if (!drag.started) {
      if (Math.abs(dy) < MOVE_START_PX) return;
      if (drag.startCollapsed && dy > 0) return; // already collapsed: nothing to pull down
      drag.started = true;
      const small = collapsedHeight();
      if (drag.startCollapsed) setCollapsed(false); // render the content so it can slide in
      drag.full = sheet.offsetHeight;
      drag.travel = Math.max(0, drag.full - small);
      drag.y = drag.startCollapsed ? drag.travel : 0;
      sheet.style.transition = 'none';
      sheet.style.overflow = 'hidden';
      setHeight(drag.full, drag.y); // from collapsed: same height as before, before the first paint
      try { sheet.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    }
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) drag.v = 0.6 * drag.v + 0.4 * ((e.clientY - drag.lastY) / dt);
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    const base = drag.startCollapsed ? drag.travel : 0;
    drag.y = Math.min(drag.travel, Math.max(0, base + dy));
    setHeight(drag.full, drag.y);
  });

  function end(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.started) {
      drag = null;
      return;
    }
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    const base = drag.startCollapsed ? drag.travel : 0;
    const moved = drag.y - base; // positive = downwards
    const threshold = Math.min(SNAP_DISTANCE_PX, drag.travel / 2);
    let target = drag.startCollapsed;
    if (Math.abs(drag.v) > FLICK_PX_PER_MS) target = drag.v > 0;
    else if (Math.abs(moved) > threshold) target = moved > 0;
    settle(target);
  }
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);

  // A drag that ends on the header button must not also toggle it.
  sheet.addEventListener('click', (e) => {
    if (!suppressClick) return;
    e.stopPropagation();
    e.preventDefault();
  }, true);
}
