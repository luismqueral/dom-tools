// Inject Tailwind CDN (async, preflight disabled) so design-mode classes render.
// Called lazily — only when user first enters a mode that needs Tailwind.
export function loadTailwind() {
  if (window.tailwind || document.querySelector('script[src*="tailwindcss"]')) return;
  window.tailwind = { config: { corePlugins: { preflight: false } } };
  const s = document.createElement('script');
  s.src = 'https://cdn.tailwindcss.com';
  document.head.appendChild(s);
}
