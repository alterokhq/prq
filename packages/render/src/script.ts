export const imageScript = `
document.querySelectorAll('.evidence-image').forEach(img => {
  const unavailable = () => {
    if (!img.isConnected) return;
    const figure = img.closest('figure');
    const note = document.createElement('p');
    note.className = 'muted missing-image';
    note.textContent = 'Screenshot unavailable. Keep the evidence folder beside this report.';
    img.parentElement.replaceWith(note);
    figure.querySelector('figcaption').textContent = 'screenshot unavailable';
  };
  img.addEventListener('error', unavailable);
  if (img.complete && img.naturalWidth === 0) unavailable();
});
`;

/** Local-only interactions. Evidence and source text never become executable markup. */
export const script =
  String.raw`
const notice = document.querySelector('.copy-notice');
let noticeTimer;
async function copy(text) {
  try {
    if (!navigator.clipboard) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(text);
    notice.textContent = 'Copied';
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.textContent = ''; }, 2200);
  } catch {
    const dialog = document.querySelector('.copy-fallback');
    const field = dialog.querySelector('textarea');
    field.value = text;
    dialog.showModal();
    field.focus();
    field.select();
  }
}
document.querySelectorAll('[data-copy]').forEach(button => {
  button.addEventListener('click', () => copy(button.dataset.copy));
});
document.querySelector('[data-theme-toggle]')?.addEventListener('click', event => {
  const light = document.documentElement.dataset.theme !== 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  event.currentTarget.textContent = light ? 'dark theme' : 'light theme';
  event.currentTarget.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
});
document.querySelector('[data-download]')?.addEventListener('click', () => {
  const data = JSON.parse(document.querySelector('#proof-data').textContent);
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], {type: 'application/json'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'proof-request.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
document.querySelectorAll('.signoff-form').forEach(form => {
  form.addEventListener('submit', event => {
    event.preventDefault();
    const values = new FormData(form);
    const name = String(values.get('by') ?? '').trim();
    if (!name) return;
    const decision = values.get('decision') === 'reject' ? '--reject' : '--accept';
    const reason = String(values.get('reason') ?? '').trim();
    const command = 'prq signoff ' + quote(form.dataset.claim) + ' --by ' + quote(name) + ' ' + decision + (reason ? ' --reason ' + quote(reason) : '');
    const prepared = form.querySelector('.prepared-command');
    prepared.hidden = false;
    prepared.querySelector('pre').textContent = command;
    prepared.querySelector('[data-copy-command]').onclick = () => copy(command);
  });
});
` + imageScript;
