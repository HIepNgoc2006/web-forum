import { els } from './dom';

export function eventInTextInput(event) {
  const target = event.target;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  );
}

function keyboardNavigationTargets() {
  const hash = window.location.hash || '#home';
  if (hash.startsWith('#thread/')) {
    return [...els.threadDetail.querySelectorAll('article.post[id^="p"]')];
  }
  if (hash.startsWith('#catalog/')) {
    return [...els.catalogGrid.querySelectorAll('.catalog-thread')];
  }
  if (hash.startsWith('#archive/')) {
    return [...els.archiveList.querySelectorAll('.archive-row')];
  }
  if (hash.startsWith('#board/')) {
    return [...els.threadList.querySelectorAll('.thread[id^="p"]')];
  }
  return [];
}

function currentNavigationIndex(targets) {
  const top = 12;
  const firstBelowTop = targets.findIndex((target) => target.getBoundingClientRect().bottom > top);
  return firstBelowTop === -1 ? targets.length - 1 : firstBelowTop;
}

function focusNavigationTarget(target) {
  if (!target) {
    return;
  }
  if (!target.hasAttribute('tabindex')) {
    target.setAttribute('tabindex', '-1');
  }
  target.scrollIntoView({ block: 'start', behavior: 'smooth' });
  target.focus({ preventScroll: true });
}

export function moveKeyboardNavigation(direction) {
  const targets = keyboardNavigationTargets().filter((target) => target.offsetParent !== null);
  if (!targets.length) {
    return false;
  }
  const currentIndex = currentNavigationIndex(targets);
  const nextIndex = Math.max(0, Math.min(targets.length - 1, currentIndex + direction));
  focusNavigationTarget(targets[nextIndex]);
  return true;
}
