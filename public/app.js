const $ = id => document.getElementById(id);
let state, active, loadedVersion, historySignature = '', changesSignature = '', activitySignature = '', previewLoading = false, refreshing = false, catalog;
const terminal = ['succeeded', 'failed', 'cancelled'];
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed.'); return data;
}
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; setTimeout(() => $('toast').hidden = true, 9000); }
function element(tag, text, className) { const e = document.createElement(tag); e.textContent = text; if (className) e.className = className; return e; }
function models() {
  const harness = catalog?.harnesses.find(h => h.id === $('harness').value);
  const base = harness?.base === 'claude-code' ? 'claude' : harness?.base || $('harness').value;
  const backend = catalog?.models[base]; const previous = $('model').value;
  $('model').replaceChildren(new Option('Default model', ''));
  for (const model of backend?.models || []) if (model.available) $('model').add(new Option(model.label || model.id, model.id));
  if ([...$('model').options].some(o => o.value === previous)) $('model').value = previous;
  else if ([...$('model').options].some(o => o.value === 'gpt-5.4-mini')) $('model').value = 'gpt-5.4-mini';
}
async function connection() {
  try {
    catalog = await api('/api/connection');
    $('connection-dot').className = catalog.connected ? 'online' : '';
    $('connection-label').textContent = catalog.connected ? 'Connected locally' : 'Setup needed';
    $('harness-link').href = catalog.consoleUrl;
    $('connection-error').hidden = catalog.connected;
    if (!catalog.connected) $('connection-error').textContent = catalog.error;
    const previous = $('harness').value;
    if (catalog.connected) {
      const harnesses = catalog.harnesses.filter(h => ['codex','claude-code'].includes(h.base || h.id));
      $('harness').replaceChildren(...(harnesses.length ? harnesses.map(h => new Option(h.name || h.id, h.id)) : [new Option('Codex', 'codex'), new Option('Claude Code', 'claude-code')]));
      if ([...$('harness').options].some(o => o.value === previous)) $('harness').value = previous;
      models();
      const available = Object.values(catalog.models).some(b => b.models?.some(m => m.available));
      if (!available) { $('connection-error').hidden = false; $('connection-error').textContent = 'Connect a model provider in local HarnessRouter → Integrations, then refresh this page.'; }
    }
  } catch (e) { $('connection-label').textContent = 'Connection unavailable'; }
}
async function preview() {
  if (previewLoading) return;
  previewLoading = true;
  try {
    const result = await api('/api/preview', {});
    $('preview').src = result.url;
    $('preview').hidden = false; $('preview-empty').hidden = true;
    loadedVersion = state.currentVersion;
  } catch (e) { toast(e.message); } finally { previewLoading = false; }
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    state = await api('/api/state');
    const last = state.runs.at(-1); active = state.runs.find(r => !terminal.includes(r.status));
    $('build').hidden = !!active; $('stop').hidden = !active;
    $('prompt').disabled = !!active;
    $('harness').disabled = !!active; $('model').disabled = !!active;
    $('build').textContent = state.currentVersion === 'initial' ? 'Build app ↗' : 'Make changes ↗';
    $('version').textContent = state.currentVersion === 'initial' ? 'Not built yet' : `Version ${state.runs.filter(r => r.status === 'succeeded').length}`;
    $('runtime-label').textContent = active ? ({ queued: 'Starting…', running: 'Building your app…', validating: 'Checking the changes…', previewing: 'Opening your app…' }[active.status]) : state.preview.ready ? 'Application running' : state.currentVersion === 'initial' ? 'Waiting for your first idea' : 'Preview can be restarted';
    $('open-preview').disabled = state.currentVersion === 'initial';
    document.querySelector('.builder').classList.toggle('has-history', state.runs.length > 0);
    const signature = JSON.stringify(state.runs.map(r => [r.id,r.status,r.summary,r.error]));
    if (signature !== historySignature && state.runs.length) {
      historySignature = signature; $('history').replaceChildren();
      for (const run of state.runs) {
        const card = element('article', '', 'run');
        card.append(element('div', 'YOU', 'message-label'), element('p', run.prompt, 'request'));
        card.append(element('div', `STRATUM · ${{succeeded:'Ready',failed:'Needs attention',cancelled:'Stopped',queued:'Starting',running:'Building',validating:'Checking',previewing:'Opening'}[run.status]}`, `message-label ${run.status}`));
        const message = run.error || (run.status === 'succeeded'
          ? 'Your changes are ready. The application checks passed; try the result in the preview.'
          : run.events.at(-1)?.message || 'Working on your request…');
        card.append(element('p', message, run.error ? 'error' : 'answer'));
        if (run.summary && terminal.includes(run.status)) {
          const notes = element('details', '', 'builder-notes');
          notes.append(element('summary', 'Builder notes'), element('p', run.summary, 'answer'));
          card.append(notes);
        }
        $('history').append(card);
      }
      $('history').scrollTop = $('history').scrollHeight;
    }
    const nextActivity = JSON.stringify([last?.id, last?.events, last?.validation, last?.error]);
    if (nextActivity !== activitySignature) {
      activitySignature = nextActivity;
      $('activity').replaceChildren(...(last?.events || []).map(e => element('p', `${new Date(e.at).toLocaleTimeString()}   ${e.message}`, 'event')));
      $('validation').textContent = last?.validation || last?.error || 'Validation will run after a change is generated.';
    }
    const nextChanges = JSON.stringify([last?.id, last?.changes]);
    if (nextChanges !== changesSignature) {
      changesSignature = nextChanges;
      $('change-count').textContent = last?.changes?.length || 0;
      $('changes').replaceChildren(...(last?.changes || []).map(c => {
        const item = element('details', '', 'change');
        item.append(element('summary', c.path), element('pre', `Before\n${JSON.stringify(c.before,null,2)}\n\nAfter\n${JSON.stringify(c.after,null,2)}`)); return item;
      }));
    }
    if (state.currentVersion !== 'initial' && state.currentVersion !== loadedVersion && !active) {
      const definition = await api('/api/metadata'); $('metadata').textContent = JSON.stringify(definition, null, 2);
      $('app-name').textContent = definition.manifest.name;
      await preview();
    }
  } catch (e) { $('runtime-label').textContent = 'Connection lost — refresh to reconnect'; }
  finally { refreshing = false; }
}
$('harness').addEventListener('change', models);
$('prompt-form').addEventListener('submit', async event => {
  event.preventDefault(); $('build').disabled = true;
  try {
    await api('/api/tasks', { prompt: $('prompt').value, baseVersion: state.currentVersion, harnessId: $('harness').value, model: $('model').value || undefined });
    $('prompt').value = ''; await refresh();
  } catch (e) { toast(e.message); } finally { $('build').disabled = false; }
});
$('stop').addEventListener('click', async () => { if (active) { try { await api(`/api/tasks/${active.id}/cancel`, {}); await refresh(); } catch(e) { toast(e.message); } } });
$('example').addEventListener('click', () => { $('prompt').value = 'Create an app called Credit Review. Give it a list of credit requests with borrower name, requested amount, review status (New, Under review, Approved) and notes. Add five fictional examples so I can try the list and forms.'; $('prompt').focus(); });
$('open-preview').addEventListener('click', () => window.open(state.preview.url, '_blank', 'noopener'));
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b === button));
  document.querySelectorAll('.panel').forEach(p => p.hidden = p.id !== `panel-${button.dataset.tab}`);
}));
await connection(); await refresh();
setInterval(refresh, 1500);
