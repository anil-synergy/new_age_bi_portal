import { useEffect, useState } from 'react';

const canMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

function detectTheme() {
  if (typeof document === 'undefined') return 'light';
  const root = document.documentElement;
  const attr = root.getAttribute('data-theme') || root.getAttribute('data-bs-theme');
  if (attr === 'dark' || attr === 'light') return attr;
  const cls = `${root.className} ${document.body ? document.body.className : ''}`;
  if (/\bdark\b/.test(cls)) return 'dark';
  if (/\blight\b/.test(cls)) return 'light';
  if (canMatchMedia()) return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return 'light';
}

/** Resolves 'auto' | 'light' | 'dark' to 'light' | 'dark', following the page when 'auto'. */
export function useResolvedTheme(theme) {
  const [detected, setDetected] = useState(detectTheme);

  useEffect(() => {
    if (theme !== 'auto') return undefined;
    const update = () => setDetected(detectTheme());
    update();
    const mq = canMatchMedia() ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    mq?.addEventListener?.('change', update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-bs-theme'],
    });
    return () => {
      mq?.removeEventListener?.('change', update);
      mo.disconnect();
    };
  }, [theme]);

  return theme === 'dark' || theme === 'light' ? theme : detected;
}

/** `setting`: 'auto' follows the OS preference; true/false force it. */
export function useReducedMotion(setting) {
  const [pref, setPref] = useState(
    () => canMatchMedia() && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    if (setting !== 'auto' || !canMatchMedia()) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPref(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, [setting]);

  return setting === 'auto' ? pref : Boolean(setting);
}

/** True while the element intersects the viewport (assumed true without IntersectionObserver). */
export function useInViewport(ref) {
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);

  return inView;
}
