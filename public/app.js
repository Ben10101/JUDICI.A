import { createRequestPages } from './pages/requests.js';
import { createTicketPages } from './pages/tickets.js';
import { createQualityPage } from './pages/quality.js';
import { createTriageSettingsPage } from './pages/triage-settings.js';
import { createPilotPage } from './pages/pilot.js';
import { createIntegrationPage } from './pages/integration.js';
import { createTicketDetailPage } from './pages/ticket-detail.js';
import { createUserManagementPage } from './pages/user-management.js';
import { triageQuestionLabels } from './pages/triage-labels.js';

(() => {
  const $ = (s) => document.querySelector(s);
  const api = window.judiciaApi;
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const categoryPt = {
    ACCESS: 'Acesso',
    SYSTEM: 'Sistemas',
    NETWORK: 'Rede',
    HARDWARE: 'Hardware',
    SOFTWARE: 'Software',
    PRINTING: 'Impressão',
    OTHER: 'Outros',
  };
  const systemPt = {
    PJE: 'PJe',
    SEI: 'SEI',
    EMAIL: 'E-mail',
    INTERNET: 'Internet',
    COMPUTER: 'Computador',
    PRINTER: 'Impressora',
    OTHER: 'Outro',
    UNKNOWN: 'Não identificado',
  };
  const levelPt = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', CRITICAL: 'Crítica' };
  const ticketStatusPt = {
    NEW: 'Novo', ASSIGNED: 'Em atendimento', PLANNED: 'Planejado', WAITING: 'Pendente',
    SOLVED: 'Solucionado', CLOSED: 'Fechado', UNKNOWN: 'Indisponível',
  };
  const fmtTime = (x) =>
    new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(x));
  const fmtDate = (x) =>
    new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(x));
  const state = { cache: { tickets: [], incidents: [], events: [], articles: [] }, currentUser: null, currentRequest: null, currentTicket: null, health: null, triageCases: [], triageSettingsBase: null, triageSettingsRequiresKey: false, triageSettingsKey: '' };
  const roleViews = {
    solicitante: new Set(['inicio', 'analysis', 'selfservice', 'ticket-created', 'tickets', 'detail']),
    tic: new Set(['inicio', 'analysis', 'selfservice', 'ticket-created', 'dashboard', 'tickets', 'incidents', 'integration', 'quality', 'pilot', 'triage-settings', 'detail']),
    gestor: new Set(['dashboard', 'tickets', 'incidents', 'pilot', 'users', 'detail']),
  };
  const roleNames = { solicitante: 'Solicitante', tic: 'Equipe de TIC', gestor: 'Gestor' };
  const sharedPageContext = {
    $, api, esc, categoryPt, systemPt, levelPt, ticketStatusPt, fmtTime, fmtDate,
    state, toast, navigate, selectOptions, reviewForm, triageQuestionLabels,
  };
  const settingsPage = createTriageSettingsPage(sharedPageContext);
  const ticketPages = createTicketPages(sharedPageContext);
  const pageContext = { ...sharedPageContext, triageSettingsAuthHeaders: settingsPage.triageSettingsAuthHeaders, renderTickets: ticketPages.renderTickets };
  const pages = {
    requests: createRequestPages(pageContext),
    tickets: ticketPages,
    quality: createQualityPage(pageContext),
    settings: settingsPage,
    pilot: createPilotPage(pageContext),
    integration: createIntegrationPage(pageContext),
    detail: createTicketDetailPage(pageContext),
    users: createUserManagementPage({ $, api, esc, toast, getCurrentUserId: () => state.currentUser?.id }),
  };
  const { renderAnalysis, openSelfService, renderTicketCreated } = pages.requests;
  const { renderDashboard, renderTickets, renderIncidents } = pages.tickets;
  const { renderQuality } = pages.quality;
  const { renderTriageSettings, saveTriageSettings, triageSettingsAuthHeaders, previewTriageDraft } = pages.settings;
  const { renderPilot, savePilotSettings, syncPilotStatuses, syncTicketStatuses } = pages.pilot;
  const { renderIntegration, saveIntegrationSettings } = pages.integration;
  const { showDetail, refreshTicketStatus } = pages.detail;
  const { renderUsers, createUser, saveUserRole, createLocality, toggleLocality } = pages.users;

  function hasViewAccess(view) {
    return Boolean(state.currentUser && roleViews[state.currentUser.role]?.has(view));
  }
  async function activateAuthenticatedApp(user, csrfToken) {
    state.currentUser = user;
    window.judiciaSetCsrfToken(csrfToken);
    $('#current-user-name').textContent = user.displayName;
    $('#current-user-role').textContent = roleNames[user.role] || user.role;
    $('#current-user-avatar').textContent = user.displayName.trim().slice(0, 1).toUpperCase();
    document.querySelectorAll('.nav-item[data-roles]').forEach((item) => {
      item.hidden = !item.dataset.roles.split(',').includes(user.role);
    });
    $('#auth-screen').hidden = true;
    $('.app-shell').hidden = false;
    await reload();
    navigate(user.role === 'gestor' ? 'dashboard' : 'inicio');
  }
  async function initializeAuthentication() {
    try {
      const { user } = await api('/api/auth/me');
      const { csrfToken } = await api('/api/auth/csrf');
      await activateAuthenticatedApp(user, csrfToken);
    } catch (error) {
      state.currentUser = null;
      window.judiciaSetCsrfToken('');
      $('.app-shell').hidden = true;
      $('#auth-screen').hidden = false;
      if (error.status !== 401) {
        $('#auth-error').textContent = error.message;
        $('#auth-error').hidden = false;
      }
    }
  }
  async function reload() {
    const [data, h] = await Promise.all([api('/api/bootstrap'), api('/api/health')]);
    state.cache = data;
    const localitySelect = $('#locality');
    const selectedLocality = localitySelect.value;
    localitySelect.replaceChildren(new Option('Selecione sua comarca ou município', ''));
    for (const locality of data.localities || [])
      localitySelect.add(new Option(locality.name, locality.name));
    if ((data.localities || []).some((locality) => locality.name === selectedLocality))
      localitySelect.value = selectedLocality;
    localitySelect.disabled = !(data.localities || []).length;
    if (!localitySelect.options.length || localitySelect.options.length === 1)
      localitySelect.title = 'Nenhuma comarca cadastrada. Solicite o cadastro ao gestor.';
    state.health = h;
    updateCounts();
    if (hasViewAccess('dashboard')) void renderDashboard();
    if (hasViewAccess('tickets')) void renderTickets();
    if (hasViewAccess('incidents')) void renderIncidents();
    updateHealthTag();
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 3300);
  }
  function updateCounts() {
    $('#nav-ticket-count').textContent = state.cache.tickets.length;
    $('#nav-incident-count').textContent = state.cache.incidents.filter(
      (i) => i.status === 'INVESTIGATING',
    ).length;
  }
  function updateHealthTag() {
    const tag = $('.demo-tag');
    if (!tag || !state.health) return;
    const providerName =
      state.health.decisionProvider === 'laya'
        ? 'Laya local'
        : state.health.decisionProvider === 'openrouter'
          ? 'OpenRouter'
          : state.health.decisionProvider === 'typesafe'
            ? 'TypeSafe'
            : 'classificador local';
    tag.title = state.health.jevConfigured
      ? providerName + ' configurado; disponibilidade confirmada a cada análise.'
      : 'Classificação local demonstrativa; configure o provedor no servidor.';
    const pulseColor = state.health.database === 'ok' ? '#4aa986' : '#c34d50';
    tag.innerHTML =
      '<span class="pulse" style="background:' +
      pulseColor +
      '"></span> ' +
      (state.health.jevConfigured ? providerName.toUpperCase() + ' CONFIGURADO' : 'DEMONSTRAÇÃO LOCAL');
  }
  function navigate(view) {
    if (!hasViewAccess(view)) {
      toast('Seu perfil não tem acesso a este módulo.');
      return;
    }
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document
      .querySelectorAll('.nav-item')
      .forEach((n) => n.classList.toggle('active', n.dataset.view === view));
    const el = $(`#view-${view}`);
    if (el) el.classList.add('active');
    const names = {
      inicio: 'Atendimento',
      analysis: 'Análise da solicitação',
      selfservice: 'Autoatendimento',
      'ticket-created': 'Chamado criado',
      dashboard: 'Visão geral',
      tickets: 'Chamados',
      incidents: 'Incidentes',
      quality: 'Qualidade da triagem',
      pilot: 'Piloto e SLAs',
      integration: 'Integração GLPI',
      'triage-settings': 'Configuração da triagem',
      users: 'Acessos',
      detail: 'Detalhe',
    };
    $('#page-crumb').textContent = names[view] || 'Atendimento';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function analyze(description, locality) {
    const btn = $('#analyze-button');
    btn.disabled = true;
    btn.querySelector('.button-label').textContent = 'Analisando…';
    try {
      state.currentRequest = await api('/api/requests/analyze', {
        method: 'POST',
        body: JSON.stringify({ description, locality }),
      });
      renderAnalysis();
      navigate('analysis');
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      btn.querySelector('.button-label').textContent = 'Analisar solicitação';
    }
  }
  function selectOptions(labels, selected) {
    return Object.entries(labels)
      .map(
        ([value, label]) =>
          `<option value="${value}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`,
      )
      .join('');
  }
  function reviewForm(d, { hidden = false, requireScope = false } = {}) {
    return `<section id="correction-form" class="review-form" ${hidden ? 'hidden' : ''}><h3>Revisar classificação</h3><p>Confirme os dados antes de encaminhar. A decisão original do modelo será preservada no histórico.</p>${requireScope ? '<label class="scope-confirm"><input id="confirm-support" type="checkbox"> Confirmo que esta é uma solicitação de suporte de TIC.</label>' : ''}<div class="review-fields"><label class="review-field">Categoria<select id="correction-category">${selectOptions(categoryPt, d.category)}</select></label><label class="review-field">Sistema ou equipamento<select id="correction-system">${selectOptions(systemPt, d.system)}</select></label><label class="review-field">Impacto<select id="correction-impact">${selectOptions(levelPt, d.impact)}</select></label><label class="review-field">Urgência<select id="correction-urgency">${selectOptions(levelPt, d.urgency)}</select></label></div><div class="review-checks"><label><input id="correction-incident" type="checkbox" ${d.possibleIncident ? 'checked' : ''}> Afeta outras pessoas ou serviço compartilhado</label><label><input id="correction-human" type="checkbox" ${d.humanRequired ? 'checked' : ''}> Precisa de atendimento humano</label><label><input id="correction-outage" type="checkbox" ${d.outage ? 'checked' : ''}> Há indisponibilidade</label></div><label class="review-field review-reason">Observação da revisão (opcional)<textarea id="correction-reason" maxlength="500" rows="2" placeholder="Explique brevemente a correção"></textarea></label><div class="action-row"><button class="button button-primary" data-action="save-correction">Salvar revisão</button></div></section>`;
  }
  async function saveCorrection() {
    const confirmSupport = $('#confirm-support');
    if (confirmSupport && !confirmSupport.checked) {
      toast('Confirme que a mensagem é uma solicitação de TIC.');
      return;
    }
    const decision = {
      category: $('#correction-category').value,
      system: $('#correction-system').value,
      impact: $('#correction-impact').value,
      urgency: $('#correction-urgency').value,
      possibleIncident: $('#correction-incident').checked,
      humanRequired: $('#correction-human').checked,
      outage: $('#correction-outage').checked,
    };
    try {
      state.currentRequest = await api(
        `/api/requests/${encodeURIComponent(state.currentRequest.id)}/correction`,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            confirmSupport: confirmSupport?.checked === true,
            reason: $('#correction-reason').value,
          }),
        },
      );
      renderAnalysis();
      toast('Revisão salva. Você já pode continuar.');
    } catch (e) {
      toast(e.message);
    }
  }
  async function resolve() {
    try {
      await api(`/api/requests/${encodeURIComponent(state.currentRequest.id)}/resolve`, {
        method: 'POST',
        body: '{}',
      });
      toast('Resolução registrada no banco. Nenhum chamado foi aberto.');
      $('#view-selfservice .action-row')?.remove();
      $('#view-selfservice .result-body')?.insertAdjacentHTML('beforeend', `<form id="request-feedback-form" class="request-feedback"><h3>Como foi esta orientação?</h3><p>Esta nota mede sua satisfação com a orientação. Ela não valida a categoria, o sistema ou a prioridade da triagem; esses dados precisam ser revisados pela equipe de TIC.</p><div class="feedback-ratings">${[1,2,3,4,5].map((value) => `<label><input type="radio" name="rating" value="${value}" required><span>${value}</span></label>`).join('')}</div><label>Comentário (opcional)<textarea name="comment" maxlength="500" rows="2" placeholder="O que ajudou ou faltou?"></textarea></label><div class="action-row"><button class="button button-primary" type="submit">Enviar avaliação</button><button class="button button-secondary" type="button" data-action="home">Agora não</button></div></form>`);
      await reload();
      navigate('selfservice');
    } catch (e) {
      toast(e.message);
    }
  }
  async function saveRequestFeedback(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await api(`/api/requests/${encodeURIComponent(state.currentRequest.id)}/feedback`, {
        method: 'POST', body: JSON.stringify({ rating: Number(values.rating), comment: values.comment }),
      });
      toast('Obrigado pela avaliação.');
      form.innerHTML = '<div class="feedback-thanks"><b>Avaliação registrada.</b><button class="button button-secondary" type="button" data-action="home">Voltar ao início</button></div>';
    } catch (error) {
      toast(error.message);
    }
  }
  async function createTicket() {
    try {
      state.currentTicket = await api('/api/tickets', {
        method: 'POST',
        body: JSON.stringify({ requestId: state.currentRequest.id }),
      });
      await reload();
      renderTicketCreated(state.currentTicket);
      navigate('ticket-created');
      if (state.currentTicket.incidentId)
        toast(`Padrão identificado: possível incidente ${state.currentTicket.incidentId}`);
    } catch (e) {
      toast(e.message);
    }
  }
  async function saveEvaluationCase(requestId) {
    const text = $(`[data-evaluation-text="${requestId}"]`)?.value || '',
      confirmAnonymized = $(`[data-evaluation-confirm="${requestId}"]`)?.checked === true;
    try {
      await api('/api/quality/evaluation-cases', {
        method: 'POST',
        body: JSON.stringify({ requestId, text, confirmAnonymized }),
      });
      toast('Exemplo anonimizado salvo no conjunto de feedback.');
      void renderQuality();
    } catch (e) {
      toast(e.message);
    }
  }
  async function saveQualityCorrection(requestId) {
    const editor = $(`[data-quality-correction="${requestId}"]`);
    if (!editor) return;
    const field = (name) => editor.querySelector(`[data-quality-field="${name}"]`);
    const decision = {
      category: field('category').value,
      system: field('system').value,
      impact: field('impact').value,
      urgency: field('urgency').value,
      possibleIncident: field('possibleIncident').checked,
      humanRequired: field('humanRequired').checked,
      outage: field('outage').checked,
    };
    try {
      await api(`/api/requests/${encodeURIComponent(requestId)}/correction`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason: field('reason').value }),
      });
      toast('Classificação corrigida. Se já havia um exemplo salvo, ele voltou para pendente de avaliação.');
      await renderQuality();
    } catch (error) {
      toast(error.message);
    }
  }
  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
    } catch (error) {
      toast(error.message);
    } finally {
      state.currentUser = null;
      window.judiciaSetCsrfToken('');
      $('.app-shell').hidden = true;
      $('#auth-screen').hidden = false;
      $('#login-form').reset();
      $('#auth-error').hidden = true;
    }
  }
  async function runFeedbackEvaluation() {
    const button = $('[data-action="run-feedback-evaluation"]');
    if (!button || button.disabled) return;
    button.disabled = true;
    button.textContent = 'Avaliando casos…';
    try {
      const report = await api('/api/quality/feedback-evaluation', {
        method: 'POST',
        headers: triageSettingsAuthHeaders(),
        body: '{}',
      });
      const message = report.status === 'completed'
        ? `Avaliação concluída: ${report.exactMatchCount}/${report.totalCases} casos conferem integralmente.`
        : `Avaliação ${report.status === 'partial' ? 'parcial' : 'com falhas'}: ${report.evaluatedCount}/${report.totalCases} casos avaliados.`;
      toast(message);
      await renderQuality();
    } catch (error) {
      toast(error.message);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = 'Avaliar casos';
      }
    }
  }
  async function downloadEvaluationCases() {
    try {
      const cases = await api('/api/quality/evaluation-cases');
      if (!cases.length) {
        toast('Ainda não há exemplos revisados para baixar.');
        return;
      }
      const link = document.createElement('a'),
        url = URL.createObjectURL(
          new Blob([JSON.stringify(cases, null, 2)], { type: 'application/json' }),
        );
      link.href = url;
      link.download = 'judicia-casos-feedback.json';
      link.click();
      URL.revokeObjectURL(url);
      toast(`${cases.length} casos revisados exportados.`);
    } catch (e) {
      toast(e.message);
    }
  }
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#login-button');
    const errorBox = $('#auth-error');
    button.disabled = true;
    button.textContent = 'Entrando…';
    errorBox.hidden = true;
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: $('#login-email').value, password: $('#login-password').value }),
      });
      $('#login-form').reset();
      await activateAuthenticatedApp(result.user, result.csrfToken);
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Entrar';
    }
  });
  window.addEventListener('judicia:unauthorized', () => {
    state.currentUser = null;
    window.judiciaSetCsrfToken('');
    $('.app-shell').hidden = true;
    $('#auth-screen').hidden = false;
    $('#auth-error').textContent = 'Sua sessão expirou. Entre novamente.';
    $('#auth-error').hidden = false;
  });
  $('#description').addEventListener('input', (e) => ($('#char-count').textContent = `${e.target.value.length} / 1000`));
  $('#analyze-button').addEventListener('click', () => {
    const text = $('#description').value.trim();
    if (text.length < 8) { toast('Descreva o problema com pelo menos 8 caracteres.'); $('#description').focus(); return; }
    const locality = $('#locality').value.trim();
    if (locality.length < 2) { toast('Selecione sua comarca ou município. Se não houver opções, peça o cadastro ao gestor.'); $('#locality').focus(); return; }
    void analyze(text, locality);
  });
  document.querySelectorAll('[data-example]').forEach((button) => button.addEventListener('click', () => {
    $('#description').value = button.dataset.example;
    $('#char-count').textContent = `${button.dataset.example.length} / 1000`;
    $('#description').focus();
  }));
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
    const view = button.dataset.view;
    if (!hasViewAccess(view)) return toast('Seu perfil não tem acesso a este módulo.');
    if (view === 'dashboard') void renderDashboard();
    if (view === 'tickets') void renderTickets();
    if (view === 'incidents') void renderIncidents();
    if (view === 'quality') void renderQuality();
    if (view === 'pilot') void renderPilot();
    if (view === 'integration') void renderIntegration();
    if (view === 'triage-settings') void renderTriageSettings();
    if (view === 'users') void renderUsers();
    navigate(view);
  }));
  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'logout') void logout();
    if (action === 'home') navigate('inicio');
    if (action === 'continue') openSelfService();
    if (action === 'show-correction') $('#correction-form')?.removeAttribute('hidden');
    if (action === 'save-correction') void saveCorrection();
    if (action === 'save-evaluation-case') void saveEvaluationCase(event.target.closest('[data-request]')?.dataset.request);
    if (action === 'save-quality-correction') void saveQualityCorrection(event.target.closest('[data-request]')?.dataset.request);
    if (action === 'run-feedback-evaluation') void runFeedbackEvaluation();
    if (action === 'download-evaluation-cases') void downloadEvaluationCases();
    if (action === 'refresh-integration') void renderIntegration();
    if (action === 'refresh-triage-settings') void renderTriageSettings();
    if (action === 'refresh-users') void renderUsers();
    if (action === 'save-user-role') void saveUserRole(event.target.closest('[data-user]')?.dataset.user);
    if (action === 'toggle-locality') void toggleLocality(event.target.closest('[data-locality]')?.dataset.locality, event.target.closest('[data-locality]')?.dataset.active === 'true');
    if (action === 'sync-pilot-status') void syncPilotStatuses();
    if (action === 'sync-tickets') void syncTicketStatuses();
    if (action === 'save-integration') void saveIntegrationSettings($('#integration-form'));
    if (action === 'back-analysis') navigate('analysis');
    if (action === 'resolved') void resolve();
    if (action === 'not-resolved') void createTicket();
    if (action === 'ticket-detail') void showDetail(state.currentTicket);
    if (action === 'refresh-ticket-status') void refreshTicketStatus();
    if (action === 'dashboard') { void renderDashboard(); navigate('dashboard'); }
    if (action === 'tickets') { void renderTickets(); navigate('tickets'); }
    if (action === 'incidents') { void renderIncidents(); navigate('incidents'); }
    const ticketRow = event.target.closest('[data-ticket]');
    if (ticketRow) void showDetail(state.cache.tickets.find((ticket) => ticket.id === ticketRow.dataset.ticket));
    if (event.target.closest('[data-incident]')) { void renderIncidents(); navigate('incidents'); }
  });
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form.id === 'integration-form') { event.preventDefault(); void saveIntegrationSettings(form); }
    if (form.id === 'triage-settings-form') { event.preventDefault(); void saveTriageSettings(form); }
    if (form.id === 'triage-preview-form') { event.preventDefault(); void previewTriageDraft(form); }
    if (form.id === 'pilot-settings-form') { event.preventDefault(); void savePilotSettings(form); }
    if (form.id === 'request-feedback-form') { event.preventDefault(); void saveRequestFeedback(form); }
    if (form.id === 'user-create-form') { event.preventDefault(); void createUser(form); }
    if (form.id === 'locality-create-form') { event.preventDefault(); void createLocality(form); }
  });
  $('#reset-data').addEventListener('click', () => reload().then(() => toast('Dados atualizados do PostgreSQL.')).catch((error) => toast(error.message)));
  void initializeAuthentication();
})();
