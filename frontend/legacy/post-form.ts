import { mediaList } from './format';
import type { AnyRecord } from './types';

export function formValue(form, name) {
  return String(new FormData(form).get(name) || '');
}

export function displayNameValue(form, account: AnyRecord = null) {
  if (form?.elements?.useAccountName?.checked && account?.username) {
    return account.username;
  }
  return formValue(form, 'displayName');
}

export function clearDisplayName(form) {
  if (form?.elements?.displayName) {
    form.elements.displayName.value = '';
  }
  if (form?.elements?.useAccountName) {
    form.elements.useAccountName.checked = false;
  }
}

export function hasOption(value, option) {
  return String(value)
    .toLowerCase()
    .split(/[\s,]+/)
    .includes(option);
}

// Attaches the per-post "hide image (spoiler)" choice to the upload payload.
export function withImageSpoiler(image, form) {
  return mediaList(image).map((item) => ({ ...item, spoiler: Boolean(form?.elements?.imageSpoiler?.checked) }));
}

// Whether the poster opted to stamp this post with their staff capcode. Only
// honored server-side for verified admin/moderator accounts.
export function capcodeValue(form, { isCapcodeEligible }: AnyRecord) {
  return Boolean(isCapcodeEligible?.()) && Boolean(form?.elements?.capcode?.checked);
}
