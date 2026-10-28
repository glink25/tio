// A tiny entry: the SVG shell does not wait for the app chunk or translations.
const boot = document.getElementById('boot');
try {
  const preference = JSON.parse(localStorage.getItem('tio.presentation') ?? '{}');
  if (boot && (preference?.theme === 'light' || preference?.theme === 'dark'))
    boot.dataset.theme = preference.theme;
} catch {
  /* Optional preferences must never block startup. */
}

void import('./main').catch((error: unknown) => {
  console.error('Tio startup failed', error);
  if (boot) {
    boot.dataset.failed = '';
    boot.setAttribute('aria-busy', 'false');
  }
});
