import { triageQuestionLabels, criterionLabels } from './triage-labels.js';
export function createTriageSettingsPage(ctx) {
  const { $, api, esc, toast, state } = ctx;
  async function renderTriageSettings() {
    const container = $('#view-triage-settings');
    container.innerHTML = '<div class="integration-loading">Carregando instruções da triagem…</div>';
    try {
      const [settingsResponse, cases] = await Promise.all([
        api('/api/triage/settings'),
        api('/api/triage/benchmark-cases'),
      ]);
      const settings = settingsResponse.questions;
      state.triageSettingsRequiresKey = settingsResponse.requiresKey === true;
      state.triageCases = cases;
      state.triageSettingsBase = settings;
      const fields = Object.entries(triageQuestionLabels).map(([key, [label, help]]) => {
        const question = settings[key] || {};
        const criteria = Array.isArray(question.criteria)
          ? question.criteria.map((text, index) => [index, text])
          : Object.entries(question.criteria || {});
        const criterionFields = criteria.map(([criterion, text]) => {
          const name = criterionLabels[criterion] || `Nível ${Number(criterion) + 1}`;
          return `<label class="triage-criterion"><span>${esc(name)}</span><input data-criterion-key="${esc(key)}" data-criterion="${esc(criterion)}" maxlength="240" value="${esc(text)}" required></label>`;
        }).join('');
        return `<section class="triage-question"><label class="triage-prompt-field"><span><b>${esc(label)}</b><small>${esc(help)}</small></span><textarea data-question-key="${esc(key)}" rows="2" maxlength="800" required>${esc(question.instructions || '')}</textarea></label>${criterionFields ? `<div class="triage-criteria"><h4>Critérios e descrições das opções</h4>${criterionFields}</div>` : ''}</section>`;
      }).join('');
      const caseOptions = state.triageCases.map((item, index) => `<option value="${index}">${esc(item.id)}</option>`).join('');
      const securityBanner = state.triageSettingsRequiresKey
        ? `<label class="triage-key-field">Chave de configuração<input id="triage-settings-key" type="password" autocomplete="off" value="${esc(state.triageSettingsKey)}" placeholder="Informe TRIAGE_SETTINGS_KEY"></label>`
        : '<div class="quality-banner triage-security-warning"><b>Configuração sem chave de proteção</b><span>Defina TRIAGE_SETTINGS_KEY no .env antes de disponibilizar a API fora de um ambiente local controlado.</span></div>';
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> MODELO DE DECISÃO</div><h1>Configuração da triagem</h1><p class="page-subtitle">Ajuste as instruções e os critérios enviados ao Laya para classificar cada solicitação.</p></div></div><div class="quality-banner"><b>Configure e compare antes de salvar</b><span>Isso não treina o modelo. As opções e regras do sistema continuam fixas; as descrições dos critérios podem ser ajustadas.</span></div>${securityBanner}<form id="triage-settings-form"><div class="panel triage-settings-panel"><div class="triage-prompt-list">${fields}</div><div class="integration-form-footer"><p>Use critérios observáveis e evite dados pessoais.</p><button class="button button-primary" type="submit">Salvar configuração</button></div></div></form><section class="panel triage-preview-panel"><div class="panel-head"><div><h3>Prévia com o benchmark</h3><span>As instruções ainda não salvas serão usadas nesta simulação.</span></div></div><form id="triage-preview-form"><div class="triage-preview-controls"><label>Exemplo do benchmark<select id="triage-benchmark-select"><option value="">Escolha um caso</option>${caseOptions}</select></label><button class="button button-secondary" type="submit">Analisar rascunho</button></div><label class="triage-example-label" for="triage-preview-text">Texto da solicitação</label><textarea id="triage-preview-text" maxlength="1000" placeholder="Selecione um exemplo ou escreva um texto de teste (mínimo 8 caracteres)." required></textarea></form><div id="triage-preview-result" aria-live="polite"></div></section>`;
      $('#triage-settings-key')?.addEventListener('input', (event) => { state.triageSettingsKey = event.target.value; });
      $('#triage-benchmark-select').addEventListener('change', (event) => {
        const item = event.target.value === '' ? null : state.triageCases[Number(event.target.value)];
        $('#triage-preview-text').value = item?.text || '';
        $('#triage-preview-result').innerHTML = '';
      });
    } catch (error) {
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> MODELO DE DECISÃO</div><h1>Configuração da triagem</h1><p class="page-subtitle">Não foi possível carregar as instruções: ${esc(error.message)}</p></div><button class="button button-secondary" data-action="refresh-triage-settings">Tentar novamente</button></div>`;
    }
  }

  async function saveTriageSettings(form) {
    try {
      const payload = readTriageDraft();
      await api('/api/triage/settings', { method: 'PUT', body: JSON.stringify(payload), headers: triageSettingsAuthHeaders() });
      toast('Instruções salvas. As próximas análises já usarão esta configuração.');
      void renderTriageSettings();
    } catch (error) {
      toast(error.message);
    }
  }

  function readTriageDraft() {
    const payload = {};
    for (const key of Object.keys(triageQuestionLabels)) {
      const original = state.triageSettingsBase[key] || {};
      payload[key] = { ...original, instructions: $(`[data-question-key="${key}"]`)?.value || '' };
      const fields = [...document.querySelectorAll(`[data-criterion-key="${key}"]`)];
      if (Array.isArray(original.criteria)) {
        payload[key].criteria = fields.map((field) => field.value);
      } else if (original.criteria) {
        payload[key].criteria = Object.fromEntries(fields.map((field) => [field.dataset.criterion, field.value]));
      }
    }
    return payload;
  }

  function triageSettingsAuthHeaders() {
    const key = $('#triage-settings-key')?.value || $('#pilot-settings-key')?.value || $('#quality-settings-key')?.value || state.triageSettingsKey;
    if (key) state.triageSettingsKey = key;
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  async function previewTriageDraft(form) {
    const button = form.querySelector('button[type="submit"]');
    const result = $('#triage-preview-result');
    const caseIndex = $('#triage-benchmark-select').value;
    const selectedCase = caseIndex === '' ? null : state.triageCases[Number(caseIndex)];
    button.disabled = true;
    button.textContent = 'Analisando…';
    result.innerHTML = '<p class="triage-preview-loading">Consultando o modelo com as alterações do rascunho…</p>';
    try {
      const data = await api('/api/triage/preview', {
        method: 'POST',
        body: JSON.stringify({
          description: $('#triage-preview-text').value,
          questions: readTriageDraft(),
          expected: selectedCase?.text === $('#triage-preview-text').value ? selectedCase.expected : null,
        }),
        headers: triageSettingsAuthHeaders(),
      });
      const comparison = data.comparison
        ? Object.entries(data.comparison).map(([field, row]) => `<div class="triage-preview-row"><span>${esc(field)}</span><b>${esc(String(row.actual))}</b><small class="${row.matches ? 'match' : 'mismatch'}">${row.matches ? 'Confere' : `Esperado: ${esc(String(row.expected))}`}</small></div>`).join('')
        : '';
      const isLocalFallback = c === 'local_rules';
      const providerLabel = isLocalFallback ? 'Classificador local' : String(data.provider).startsWith('laya:') ? `Laya · ${data.provider.slice(5)}` : data.provider;
      const fallbackNotice = isLocalFallback ? '<div class="triage-provider-warning"><b>O rascunho não foi aplicado ao modelo.</b> O Laya não está configurado ou não foi selecionado; o classificador local não usa estas instruções nem critérios.</div>' : '';
      result.innerHTML = `<div class="triage-preview-output"><div class="triage-preview-head"><b>Resultado da prévia</b><span>${esc(providerLabel)} · ${Math.round((data.decision.confidence || 0) * 100)}% de confiança</span></div>${fallbackNotice}<div class="triage-preview-grid"><div><small>CATEGORIA</small><b>${esc(data.decision.category)}</b></div><div><small>SISTEMA</small><b>${esc(data.decision.system)}</b></div><div><small>IMPACTO / URGÊNCIA</small><b>${esc(data.decision.impact)} / ${esc(data.decision.urgency)}</b></div><div><small>STATUS</small><b>${esc(data.triageStatus)}</b></div><div><small>PRIORIDADE / FILA</small><b>${esc(data.priority)} / ${esc(data.queue)}</b></div></div>${comparison ? `<h4>Comparação com o rótulo do benchmark</h4><div class="triage-preview-comparison">${comparison}</div>` : ''}</div>`;
    } catch (error) {
      result.innerHTML = `<p class="triage-preview-error">${esc(error.message)}</p>`;
    } finally {
      button.disabled = false;
      button.textContent = 'Analisar rascunho';
    }
  }
  return { renderTriageSettings, saveTriageSettings, readTriageDraft, triageSettingsAuthHeaders, previewTriageDraft };
}
