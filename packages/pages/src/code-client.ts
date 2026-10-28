/** HTML examples alone need runtime code: initialize an isolated iframe when preview is selected. */
for (const block of document.querySelectorAll<HTMLElement>('[data-code-preview="html"]')) {
  const preview = block.querySelector<HTMLElement>('.tio-code-preview')!;
  const initialize = () => {
    if (
      block.querySelector<HTMLInputElement>('input:checked')?.value === 'code' ||
      preview.firstChild
    )
      return;
    const frame = document.createElement('iframe');
    frame.title = preview.dataset.previewTitle!;
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.referrerPolicy = 'no-referrer';
    frame.srcdoc = block.querySelector('code')!.textContent ?? '';
    preview.replaceChildren(frame);
    block.dataset.htmlReady = '';
  };
  block.addEventListener('change', initialize);
  initialize();
}
