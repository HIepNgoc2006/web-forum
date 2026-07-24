export type AnyRecord = Record<string, any>;

export type HCaptchaApi = {
  render: (...args: any[]) => any;
  reset: (...args: any[]) => void;
};

declare global {
  interface Window {
    hcaptcha?: HCaptchaApi;
  }

  interface Element {
    alt: string;
    checked: boolean;
    dataset: DOMStringMap;
    disabled: boolean;
    files: FileList | null;
    focus: () => void;
    href: string;
    maxLength: number;
    reset: () => void;
    searchTimer: number;
    selectionEnd: number | null;
    selectionStart: number | null;
    setRangeText: (...args: any[]) => void;
    setSelectionRange: (...args: any[]) => void;
    src: string;
    title: string;
    value: string;
  }

  interface Event {
    clientX: number;
    clientY: number;
  }

  interface EventTarget {
    closest: (selectors: string) => any;
  }

  interface ParentNode {
    querySelector(selectors: string): any;
    querySelectorAll(selectors: string): NodeListOf<any>;
  }

  interface Error {
    requires2FA?: boolean;
    setupRequired?: boolean;
    statusCode?: number;
    timedOut?: boolean;
  }
}
