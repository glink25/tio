// A tiny entry: the SVG shell does not wait for the app chunk or translations.
const boot = document.getElementById('boot');

void import('./main').catch((error: unknown) => {
  console.error('Tio startup failed', error);
  if (boot) {
    boot.dataset.failed = '';
    boot.setAttribute('aria-busy', 'false');
  }
});
