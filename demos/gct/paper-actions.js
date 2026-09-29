'use strict';
// The BibTeX follows the paper details shown on the page: journal and year only,
// with no volume, pages, or DOI until they are published.
(() => {
  const button = document.getElementById('copy-bibtex');
  const bibtex = document.getElementById('bibtex');
  const status = document.getElementById('copy-status');
  if (!button || !bibtex) return;
  let timer = 0;
  function showManualCopy() {
    bibtex.hidden = false;
    const range = document.createRange();
    range.selectNodeContents(bibtex);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    status.textContent = 'The BibTeX is shown and selected for copying.';
  }
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(bibtex.textContent);
      button.textContent = 'Copied';
      status.textContent = 'BibTeX copied to the clipboard.';
      clearTimeout(timer);
      timer = setTimeout(() => { button.textContent = 'Copy BibTeX'; status.textContent = ''; }, 2000);
    } catch {
      showManualCopy();
    }
  });
})();
