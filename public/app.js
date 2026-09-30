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
  let cache = { tickets: [], incidents: [], events: [], articles: [] },
    currentUser = null,
    currentRequest = null,
    currentTicket = null,
    health = null,
    triageCases = [],
    triageSettingsBase = null,
    triageSettingsRequiresKey = false,
    triageSettingsKey = '';
  const roleViews = {
    solicitante: new Set(['inicio', 'analysis', 'selfservice', 'ticket-created', 'tickets', 'detail']),
    tic: new Set(['inicio', 'analysis', 'selfservice', 'ticket-created', 'dashboard', 'tickets', 'incidents', 'integration', 'quality', 'pilot', 'triage-settings', 'detail']),
    gestor: new Set(['dashboard', 'tickets', 'incidents', 'pilot', 'detail']),
  };
  const roleNames = { solicitante: 'Solicitante', tic: 'Equipe de TIC', gestor: 'Gestor' };
  function hasViewAccess(view) {
    return Boolean(currentUser && roleViews[currentUser.role]?.has(view));
  }
  function activateAuthenticatedApp(user, csrfToken) {
    currentUser = user;
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
      currentUser = null;
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
    cache = data;
    health = h;
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
    $('#nav-ticket-count').textContent = cache.tickets.length;
    $('#nav-incident-count').textContent = cache.incidents.filter(
      (i) => i.status === 'INVESTIGATING',
    ).length;
  }
  function updateHealthTag() {
    const tag = $('.demo-tag');
    if (!tag || !health) return;
    const providerName =
      health.decisionProvider === 'laya'
        ? 'Laya local'
        : health.decisionProvider === 'openrouter'
          ? 'OpenRouter'
          : health.decisionProvider === 'typesafe'
            ? 'TypeSafe'
            : 'classificador local';
    tag.title = health.jevConfigured
      ? providerName + ' configurado; disponibilidade confirmada a cada análise.'
      : 'Classificação local demonstrativa; configure o provedor no servidor.';
    const pulseColor = health.database === 'ok' ? '#4aa986' : '#c34d50';
    tag.innerHTML =
      '<span class="pulse" style="background:' +
      pulseColor +
      '"></span> ' +
      (health.jevConfigured ? providerName.toUpperCase() + ' CONFIGURADO' : 'DEMONSTRAÇÃO LOCAL');
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
      currentRequest = await api('/api/requests/analyze', {
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
  function renderAnalysis() {
    const r = currentRequest,
      d = r.decision,
      status = r.triageStatus || 'READY',
      confidence = Math.round(100 * (r.modelConfidence ?? d.confidence ?? 0)),
      outOfScope = status === 'OUT_OF_SCOPE',
      needsReview = status === 'NEEDS_REVIEW';
    const title = outOfScope
      ? 'Solicitação fora do escopo'
      : needsReview
        ? 'Revisão necessária'
        : r.corrected
          ? 'Classificação revisada'
          : 'Análise concluída';
    const notice = outOfScope
      ? '<div class="triage-notice triage-blocked"><b>Não identificamos uma solicitação de suporte de TIC.</b><span>Não será possível abrir chamado com esta classificação. Se a mensagem for sobre tecnologia, confirme abaixo e classifique manualmente.</span><button class="button button-secondary" data-action="show-correction">É uma solicitação de TIC? Revisar</button></div>'
      : needsReview
        ? '<div class="triage-notice triage-review"><b>A classificação precisa de confirmação.</b><span>Revise categoria, sistema, impacto e urgência. O chamado ficará bloqueado até salvar a revisão.</span></div>'
        : '';
    const fields = `<div class="classification-grid"><div class="data-field"><small>Categoria</small><b>${categoryPt[d.category] || d.category}</b></div><div class="data-field"><small>Sistema</small><b>${systemPt[d.system] || d.system}</b></div><div class="data-field"><small>Impacto</small><b>${levelPt[d.impact] || d.impact}</b></div><div class="data-field"><small>Urgência</small><b>${levelPt[d.urgency] || d.urgency}</b></div><div class="data-field"><small>Possível incidente</small><b>${d.possibleIncident ? 'Sim' : 'Não'}</b></div><div class="data-field"><small>Fila sugerida</small><b>${esc(r.queue)}</b></div><div class="data-field"><small>Atendimento humano</small><b>${d.humanRequired ? 'Recomendado' : 'Autoatendimento possível'}</b></div><div class="data-field"><small>Indisponibilidade</small><b>${d.outage ? 'Sinalizada' : 'Não sinalizada'}</b></div><div class="data-field"><small>Prioridade calculada</small><b>${levelPt[r.priority] || r.priority}</b></div></div>`;
    const actions = outOfScope
      ? reviewForm(d, { hidden: true, requireScope: true })
      : needsReview
        ? reviewForm(d)
        : `<div class="action-row"><button class="button button-secondary" data-action="show-correction">Corrigir classificação</button><button class="button button-primary" data-action="continue">Continuar para orientação <span class="button-arrow">→</span></button></div>${reviewForm(d, { hidden: true })}`;
    $('#view-analysis').innerHTML =
      `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> SOLICITAÇÃO ${esc(r.id)}</div><h1>Análise estruturada</h1><p class="page-subtitle">Triagem de suporte de TIC a partir do texto informado.</p></div><button class="button button-secondary" data-action="home">← Nova solicitação</button></div><div class="panel result-card"><div class="result-banner"><span class="result-check">${outOfScope ? '!' : '✓'}</span><div><h2>${title}</h2><p>${r.corrected ? 'Decisão corrigida por revisão humana.' : r.provider?.startsWith('jev:') || r.provider?.startsWith('laya:') ? 'Classificação estruturada pelo provedor de decisões.' : 'Classificador local demonstrativo.'}</p></div></div><div class="result-body">${notice}${outOfScope ? '<div class="rule-note">Nenhuma fila ou artigo de autoatendimento foi recomendado.</div>' : fields}<div class="confidence-row"><span>${r.corrected ? 'Confiança original do modelo' : 'Confiança do modelo'} <small style="color:#a2adb4">· requer validação humana</small></span><b>${confidence}%</b></div>${actions}</div></div>`;
  }
  function openSelfService() {
    const r = currentRequest;
    if (!r) return;
    const a = r.article;
    $('#view-selfservice').innerHTML =
      `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> AUTOATENDIMENTO</div><h1>Vamos tentar resolver?</h1><p class="page-subtitle">Encontramos uma orientação que pode ajudar com sua solicitação.</p></div><button class="button button-secondary" data-action="back-analysis">← Voltar à análise</button></div><div class="panel result-card"><div class="result-banner"><span class="result-check">✳</span><div><h2>Encontramos uma possível solução</h2><p>${a ? `${esc(a.id)} · ${esc(systemPt[a.system] || 'Suporte')}` : 'Não localizamos um artigo específico para essa categoria.'}</p></div></div><div class="result-body">${a ? `<div class="article-card"><div class="article-card-head"><b>${esc(a.title)}</b><span>BASE DE CONHECIMENTO · ${esc(a.id)}</span></div><div class="article-card-body"><p>${esc(a.solution)}</p><ol class="steps-list">${a.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div></div>` : `<div class="rule-note">Sua solicitação pode ser encaminhada diretamente para a equipe técnica. Se preferir, abra um chamado agora.</div>`}<div class="action-row" style="margin-top:18px"><button class="button button-secondary" data-action="resolved">✓ Consegui resolver</button><button class="button button-primary" data-action="not-resolved">Ainda preciso de ajuda <span class="button-arrow">→</span></button></div></div></div>`;
    navigate('selfservice');
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
      currentRequest = await api(
        `/api/requests/${encodeURIComponent(currentRequest.id)}/correction`,
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
      await api(`/api/requests/${encodeURIComponent(currentRequest.id)}/resolve`, {
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
      await api(`/api/requests/${encodeURIComponent(currentRequest.id)}/feedback`, {
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
      currentTicket = await api('/api/tickets', {
        method: 'POST',
        body: JSON.stringify({ requestId: currentRequest.id }),
      });
      await reload();
      renderTicketCreated(currentTicket);
      navigate('ticket-created');
      if (currentTicket.incidentId)
        toast(`Padrão identificado: possível incidente ${currentTicket.incidentId}`);
    } catch (e) {
      toast(e.message);
    }
  }
  function renderTicketCreated(t) {
    $('#view-ticket-created').innerHTML =
      `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> SOLICITAÇÃO ENCAMINHADA</div><h1>Chamado criado</h1><p class="page-subtitle">Seu chamado foi salvo no PostgreSQL e ${t.integration?.provider === 'glpi' ? 'registrado no GLPI.' : 'encaminhado para a fila responsável.'}</p></div></div><div class="panel result-card"><div class="ticket-created"><span class="result-check">✓</span><div class="eyebrow" style="justify-content:center">PROTOCOLO DE ATENDIMENTO</div><div class="protocol">${esc(t.protocol)}</div><p style="font-size:11px;color:#83939e">Guarde este número para acompanhar sua solicitação.</p><div class="callout"><b>Fila sugerida:</b> ${esc(t.queue)}<br><b>Prioridade:</b> ${levelPt[t.priority]}<br><b>Sistema:</b> ${systemPt[t.system]}<br><b>Possível incidente:</b> ${t.incidentId ? 'Detectado · ' + t.incidentId : 'Em observação'}</div><div class="action-row" style="justify-content:center"><button class="button button-secondary" data-action="dashboard">Ir para a visão geral</button><button class="button button-primary" data-action="ticket-detail">Ver chamado <span class="button-arrow">→</span></button></div></div></div>`;
    $('#view-ticket-created .page-subtitle').textContent =
      t.integration?.mode === 'simulated'
        ? 'Demonstração: protocolo salvo localmente; nenhum sistema externo recebeu este chamado.'
        : t.integration?.provider === 'glpi'
          ? t.queueRouting === 'GLPI_CATEGORY_SENT' ? 'Chamado registrado no GLPI. A categoria foi enviada para as regras de roteamento da instância; confirme o grupo atribuído.' : 'Chamado registrado no GLPI. A fila exibida é apenas uma sugestão do JUDICI.A.'
          : 'Chamado encaminhado para a fila responsável.';
  }
  function ticketRows(list) {
    if (!list.length)
      return `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">▤</div><b>Nenhum chamado encontrado</b><p>As solicitações encaminhadas aparecerão aqui.</p></div></td></tr>`;
    return list
      .map(
        (t) =>
          `<tr data-ticket="${esc(t.id)}"><td><strong>${esc(t.protocol)}</strong></td><td>${esc(t.locality || 'Não informada')}</td><td>${esc(systemPt[t.system] || t.system)}</td><td>${esc(categoryPt[t.category] || t.category)}</td><td><span class="priority ${t.priority.toLowerCase()}">${levelPt[t.priority]}</span></td><td><span class="queue-tag">${esc(t.queue)}</span></td><td>${esc(ticketStatusPt[t.status] || t.status || '—')}</td><td>${fmtTime(t.createdAt)}</td></tr>`,
      )
      .join('');
  }
  function renderTable(list) {
    return `<div class="panel"><div class="panel-head"><h3>Chamados recentes</h3><span>${list.length} registros · PostgreSQL</span></div><div class="table-wrap"><table><thead><tr><th>PROTOCOLO</th><th>COMARCA / MUNICÍPIO</th><th>SISTEMA</th><th>CATEGORIA</th><th>PRIORIDADE</th><th>FILA SUGERIDA</th><th>STATUS</th><th>HORÁRIO</th></tr></thead><tbody>${ticketRows(list)}</tbody></table></div></div>`;
  }
  async function renderDashboard() {
    try {
      const d = await api('/api/dashboard'),
        ratio = d.total ? Math.round((d.resolved / d.total) * 100) : 0;
      $('#view-dashboard').innerHTML =
        `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> OPERAÇÃO DE SUPORTE</div><h1>Visão geral</h1><p class="page-subtitle">Acompanhe chamados, autoatendimento e possíveis incidentes.</p></div><button class="button button-primary" data-action="home">+ Nova solicitação</button></div><div class="stats-grid"><div class="stat-card"><span class="stat-icon">▤</span><div class="stat-label">Chamados abertos</div><div class="stat-value">${d.open}</div><div class="stat-foot">No ambiente demonstrativo</div></div><div class="stat-card alert"><span class="stat-icon">⚑</span><div class="stat-label">Prioridade alta</div><div class="stat-value">${d.high}</div><div class="stat-foot">Alta ou crítica</div></div><div class="stat-card critical"><span class="stat-icon">◉</span><div class="stat-label">Possíveis incidentes</div><div class="stat-value">${d.incidents}</div><div class="stat-foot">Aguardando investigação</div></div><div class="stat-card"><span class="stat-icon">✓</span><div class="stat-label">Resolvidos no autoatendimento</div><div class="stat-value">${d.resolved}</div><div class="stat-foot">Sem intervenção humana</div></div></div><div class="dashboard-grid"><div class="panel"><div class="panel-head"><h3>Possíveis incidentes</h3><button class="button button-secondary" data-action="incidents" style="height:27px;padding:0 9px;font-size:9px">Ver todos →</button></div><div class="incident-list">${
          d.incidentList.length
            ? d.incidentList
                .slice(0, 4)
                .map(
                  (i) =>
                    `<div class="incident-row" data-incident="${esc(i.id)}"><span class="severity-dot ${i.severity === 'HIGH' ? 'high' : ''}"></span><div><b>${esc(i.title)}</b><small>${esc(i.code)} · Detectado às ${fmtTime(i.detectedAt)} · ${i.ticketIds.length} chamados</small></div><span class="incident-count">${i.ticketIds.length} chamados</span></div>`,
                )
                .join('')
            : `<div class="empty-state"><div class="empty-icon">◉</div><b>Nenhum incidente detectado</b><p>Solicitações relacionadas serão agrupadas automaticamente.</p></div>`
        }</div></div><div class="panel"><div class="panel-head"><h3>Resolutividade digital</h3><span>IRD · demonstração</span></div><div class="resolution-card"><div style="display:flex;align-items:baseline;gap:7px"><b style="font:700 26px Manrope;color:#287e70">${ratio}%</b><span style="font-size:10px;color:#9aa6ad">${d.resolved} de ${d.total} solicitações</span></div><div class="resolution-bar"><div class="resolution-fill" style="width:${ratio}%"></div></div><div class="resolution-meta"><span>Resolvidas sem intervenção humana</span><span>${d.total} total</span></div><div class="rule-note" style="margin:16px 0 0">Indicadores calculados com dados sintéticos inseridos nesta demonstração.</div></div></div></div>${renderTable(d.recent)}`;
      if (d.locality?.length) {
        const entries = d.locality
          .map((row) => `<div class="resolution-meta"><span>${esc(row.locality)}</span><b>${row.tickets} chamados</b></div>`)
          .join('');
        $('#view-dashboard').insertAdjacentHTML(
          'beforeend',
          `<section class="panel" style="margin-top:14px"><div class="panel-head"><h3>Chamados por comarca ou município</h3><span>Base para acompanhar cobertura territorial</span></div><div class="resolution-card">${entries}<div class="rule-note" style="margin-top:12px">Contagens não medem equidade por si só; compare com volume de usuários, prazo e prioridade por unidade.</div></div></section>`,
        );
      }
    } catch (e) {
      toast(e.message);
    }
  }
  async function renderTickets() {
    try {
      const list = await api('/api/tickets');
      cache.tickets = list;
      $('#view-tickets').innerHTML =
        `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> FILA DE ATENDIMENTO</div><h1>Chamados</h1><p class="page-subtitle">Solicitações estruturadas e encaminhadas para a equipe responsável.</p></div><div class="action-row"><button class="button button-secondary" data-action="sync-tickets">Sincronizar status</button><button class="button button-primary" data-action="home">+ Nova solicitação</button></div></div>${renderTable(list)}`;
    } catch (e) {
      toast(e.message);
    }
  }
  async function renderIncidents() {
    try {
      const list = await api('/api/incidents');
      cache.incidents = list;
      $('#view-incidents').innerHTML =
        `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> AGRUPAMENTO AUTOMÁTICO</div><h1>Possíveis incidentes</h1><p class="page-subtitle">Padrão experimental: três chamados do mesmo sistema e categoria em 15 minutos.</p></div></div>${
          list.length
            ? list
                .map(
                  (i) =>
                    `<div class="panel incident-detail" style="margin-bottom:13px"><div class="incident-hero"><span class="severity-dot ${i.severity === 'HIGH' ? 'high' : ''}" style="width:10px;height:10px"></span><div style="flex:1"><span class="tag-demo">REGRA EXPERIMENTAL DO PROTÓTIPO</span><h2 style="margin-top:8px">${esc(i.title)}</h2><p>${esc(i.code)} · ${systemPt[i.system]} · Detectado ${fmtDate(i.detectedAt)}</p></div><span class="priority ${i.severity.toLowerCase()}">${levelPt[i.severity]}</span></div><div class="panel-head" style="padding:14px 2px;border:0"><h3>Chamados relacionados</h3><span>${i.ticketIds.length} solicitações · mesma categoria e sistema</span></div><div class="table-wrap"><table><thead><tr><th>PROTOCOLO</th><th>DESCRIÇÃO</th><th>PRIORIDADE</th><th>HORÁRIO</th></tr></thead><tbody>${i.ticketIds
                      .map((id) => {
                        const t = cache.tickets.find((x) => x.id === id);
                        return t
                          ? `<tr data-ticket="${esc(t.id)}"><td><strong>${esc(t.protocol)}</strong></td><td>${esc(t.description.slice(0, 75))}${t.description.length > 75 ? '…' : ''}</td><td><span class="priority ${t.priority.toLowerCase()}">${levelPt[t.priority]}</span></td><td>${fmtTime(t.createdAt)}</td></tr>`
                          : '';
                      })
                      .join('')}</tbody></table></div></div>`,
                )
                .join('')
            : `<div class="panel empty-state"><div class="empty-icon">◉</div><b>Nenhum padrão agrupado ainda</b><p>Quando houver pelo menos três chamados relacionados em 15 minutos, um possível incidente será criado.</p></div>`
        }`;
    } catch (e) {
      toast(e.message);
    }
  }
  async function renderQuality() {
    try {
      const [q, latestReport, savedCases, triageSettings] = await Promise.all([
        api('/api/quality'),
        api('/api/quality/feedback-evaluation'),
        api('/api/quality/evaluation-cases'),
        api('/api/triage/settings'),
      ]);
      triageSettingsRequiresKey = triageSettings.requiresKey === true;
      const priorResults = new Map(
        (latestReport?.cases || [])
          .filter((item) => item.evaluationCaseId)
          .map((item) => [String(item.evaluationCaseId), item]),
      );
      const pendingCount = savedCases.filter((item) => {
        const previous = priorResults.get(String(item.id));
        const fingerprint = JSON.stringify([item.text, item.expected || {}]);
        return previous?.status !== 'evaluated' || previous.fingerprint !== fingerprint;
      }).length;
      const labels = {
        supportRequest: 'É suporte de TIC?',
        category: 'Categoria',
        system: 'Sistema ou equipamento',
        impact: 'Impacto',
        urgency: 'Urgência',
        possibleIncident: 'Possível incidente',
        outage: 'Indisponibilidade',
        status: 'Status',
      };
      const correctionEditor = (requestId, decision = {}) => `<details class="quality-inline-correction"><summary>Corrigir classificação</summary><div class="quality-inline-fields" data-quality-correction="${esc(requestId)}"><label>Categoria<select data-quality-field="category">${selectOptions(categoryPt, decision.category || 'OTHER')}</select></label><label>Sistema ou equipamento<select data-quality-field="system">${selectOptions(systemPt, decision.system || 'UNKNOWN')}</select></label><label>Impacto<select data-quality-field="impact">${selectOptions(levelPt, decision.impact || 'MEDIUM')}</select></label><label>Urgência<select data-quality-field="urgency">${selectOptions(levelPt, decision.urgency || 'MEDIUM')}</select></label><label class="quality-inline-check"><input type="checkbox" data-quality-field="possibleIncident" ${decision.possibleIncident ? 'checked' : ''}> Incidente coletivo</label><label class="quality-inline-check"><input type="checkbox" data-quality-field="humanRequired" ${decision.humanRequired !== false ? 'checked' : ''}> Precisa de atendimento humano</label><label class="quality-inline-check"><input type="checkbox" data-quality-field="outage" ${decision.outage ? 'checked' : ''}> Há indisponibilidade</label><label class="quality-inline-reason">Observação da revisão<textarea data-quality-field="reason" maxlength="500" rows="2">${esc(decision.reason || '')}</textarea></label><button type="button" class="button button-primary" data-action="save-quality-correction" data-request="${esc(requestId)}">Salvar classificação correta</button></div></details>`;
      const pendingCorrections = q.corrections.filter((c) => !c.evaluationCaseApproved);
      const correctionCards = pendingCorrections.length
        ? pendingCorrections.map((c) => {
            const model = c.original || {};
            const human = c.corrected || {};
            return `<article class="quality-correction"><div class="quality-row-head"><b>${esc(c.id)}</b><small>${fmtDate(c.correctedAt)} · Ainda não é um exemplo de feedback</small></div><p>${esc(c.description)}</p><div class="quality-diff"><span>Classificação automática: ${esc(model.category || '—')} / ${esc(model.system || '—')}</span><b>Correção humana: ${esc(human.category || '—')} / ${esc(human.system || '—')}</b></div>${c.reason ? `<small class="quality-reason">Observação: ${esc(c.reason)}</small>` : ''}${correctionEditor(c.id, { ...human, reason: c.reason })}<label class="review-field">Texto do exemplo (remova dados pessoais)<textarea data-evaluation-text="${esc(c.id)}" maxlength="1000">${esc(c.description)}</textarea></label><label class="quality-confirm"><input type="checkbox" data-evaluation-confirm="${esc(c.id)}"> Revisei e removi nomes, números de processo e outros dados pessoais</label><button class="button button-secondary" data-action="save-evaluation-case" data-request="${esc(c.id)}">Salvar como exemplo de feedback</button></article>`;
          }).join('')
        : '<div class="quality-empty"><b>Nenhuma correção aguardando revisão</b><p>Quando a equipe corrigir uma triagem, o chamado aparecerá aqui para ser revisado e salvo como exemplo.</p></div>';
      const savedFeedbackCards = savedCases.length
        ? savedCases.map((item) => {
            const source = q.corrections.find((c) => c.id === item.sourceRequestId);
            const result = priorResults.get(String(item.id));
            const fingerprint = JSON.stringify([item.text, item.expected || {}]);
            const evaluated = result?.status === 'evaluated' && result.fingerprint === fingerprint;
            const state = evaluated ? 'Avaliado' : result?.status === 'error' ? 'Falha · pode tentar novamente' : 'Aguardando avaliação';
            const decision = { ...(source?.corrected || {}), ...item.expected, reason: source?.reason };
            return `<article class="quality-saved-card"><div><b>${esc(item.sourceRequestId || `Exemplo ${item.id}`)}</b><span class="quality-saved-status ${evaluated ? 'is-done' : ''}">${state}</span></div><p>${esc(item.text)}</p><small>Rótulos revisados: ${esc(item.expected?.category || 'categoria não informada')} · ${esc(item.expected?.system || 'sistema não informado')}</small>${source?.reason ? `<small>Observação da equipe: ${esc(source.reason)}</small>` : ''}${source ? correctionEditor(source.id, decision) : '<small>Chamado de origem não está no histórico recente.</small>'}</article>`;
          }).join('')
        : '<div class="quality-empty"><b>Nenhum exemplo salvo</b><p>Revise uma correção acima e salve o texto anonimizado para criar o primeiro exemplo.</p></div>';
      const keyBlock = triageSettingsRequiresKey
        ? `<label class="triage-key-field quality-key-field">Chave de configuração<input id="quality-settings-key" type="password" autocomplete="off" value="${esc(triageSettingsKey)}" placeholder="Informe TRIAGE_SETTINGS_KEY"></label>`
        : '';
      const resultPanel = latestReport
        ? `<div class="quality-result-summary"><b>${latestReport.exactMatchCount} de ${latestReport.totalCases}</b><span>casos conferiram em todos os rótulos comparados</span><small>Última avaliação: ${fmtDate(latestReport.evaluatedAt)} · ${latestReport.evaluatedCount} avaliados${latestReport.failedCount ? ` · ${latestReport.failedCount} com falha` : ''}</small></div><div class="quality-result-metrics">${Object.entries(latestReport.fields || {}).filter(([, value]) => value.total).map(([field, value]) => `<div class="quality-metric"><span>${labels[field] || esc(field)}</span><b>${value.accuracy}%</b><small>${value.correct}/${value.total} corretos</small></div>`).join('')}</div><details class="quality-result-details"><summary>Ver resultado de cada exemplo (${latestReport.totalCases})</summary><div class="quality-evaluation-cases">${(latestReport.cases || []).map((item) => { const source = savedCases.find((saved) => String(saved.id) === String(item.evaluationCaseId)); const differences = (item.mismatches || []).map((field) => `<li><b>${labels[field] || esc(field)}:</b> esperado ${esc(item.expected?.[field])}, classificado ${esc(item.actual?.[field])}</li>`).join(''); return `<article><b>Exemplo ${item.caseNumber}</b>${source?.text ? `<p>${esc(source.text)}</p>` : ''}${item.status === 'error' ? `<small class="quality-evaluation-error">Não avaliado: ${esc(item.error)}</small>` : differences ? `<ul>${differences}</ul>` : '<small class="quality-evaluation-match">Rótulos conferidos.</small>'}</article>`; }).join('')}</div></details>`
        : '<div class="quality-empty"><b>A avaliação ainda não foi executada</b><p>Os exemplos de feedback serão comparados ao classificador quando você iniciar a avaliação.</p></div>';

      $('#view-quality').innerHTML = `<div class="quality-screen">
        <header class="quality-page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> REVISÃO E APRENDIZADO</div><h1>Qualidade da triagem</h1><p>Revise as correções da equipe e avalie exemplos de feedback sem misturá-los ao benchmark.</p></div></header>
        <section class="quality-explainer"><article><span class="quality-step">SATISFAÇÃO DO SOLICITANTE</span><h2>A orientação ajudou?</h2><p>A nota positiva ou negativa mede a experiência de quem pediu suporte. Ela não confirma se a classificação automática está correta.</p></article><article><span class="quality-step">VALIDAÇÃO DA TRIAGEM</span><h2>Os rótulos estão certos?</h2><p>A equipe de TIC precisa revisar e corrigir categoria, sistema, impacto e urgência. Só então o exemplo pode ser avaliado como feedback técnico.</p></article></section>
        <section class="quality-benchmark"><div><b>Benchmark-base</b><span>${q.benchmarkCaseCount}/50 casos · avaliação de referência</span></div><div><b>Feedback humano</b><span>${q.approvedCaseCount} exemplos salvos · conjunto separado</span></div><p>Os resultados de feedback não são adicionados ao benchmark-base nem alteram o modelo.</p></section>
        <section class="quality-section"><div class="quality-section-heading"><span class="quality-step">1 · REVISÃO HUMANA</span><h2>Correções aguardando revisão</h2><p>Confira a classificação automática e os rótulos corrigidos. Revise o texto, remova dados pessoais e salve para incluir o caso na lista de feedback.</p></div><div class="quality-corrections">${correctionCards}</div></section>
        <section class="quality-section"><div class="quality-section-heading"><span class="quality-step">LISTA DE FEEDBACK</span><h2>Exemplos salvos (${savedCases.length})</h2><p>Ao salvar, o exemplo sai da fila de revisão e aparece aqui. A avaliação não o remove desta lista.</p></div><div class="quality-saved-list">${savedFeedbackCards}</div></section>
        <section class="quality-section quality-evaluate-section"><div class="quality-section-heading"><span class="quality-step">2 · AVALIAÇÃO SEPARADA</span><h2>Comparar exemplos com o classificador</h2><p>Uma avaliação mede se o classificador reproduz os rótulos revisados pela equipe. Casos já avaliados com sucesso não serão executados novamente.</p></div><div class="quality-evaluate-actions">${keyBlock}<button class="button button-primary" data-action="run-feedback-evaluation" ${pendingCount ? '' : 'disabled'}>Avaliar ${pendingCount} pendente(s)</button><button class="button button-secondary" data-action="download-evaluation-cases" ${savedCases.length ? '' : 'disabled'}>Exportar exemplos</button></div>${pendingCount ? `<p class="quality-pending-note">${pendingCount} exemplo(s) aguardando avaliação. Falhas e versões alteradas também podem ser tentadas novamente.</p>` : '<p class="quality-pending-note quality-all-done">Todos os exemplos salvos já foram avaliados.</p>'}</section>
        <section class="quality-section"><div class="quality-section-heading"><span class="quality-step">3 · RESULTADO</span><h2>Resultado da avaliação de feedback</h2><p>Confira a concordância por rótulo e abra os detalhes para ver divergências por exemplo.</p></div><div class="quality-results">${resultPanel}</div></section>
        <footer class="quality-privacy-note">Antes de salvar um exemplo, remova nomes, números de processo, e-mails e demais identificadores. O texto original do chamado permanece preservado.</footer>
      </div>`;
      $('#quality-settings-key')?.addEventListener('input', (event) => { triageSettingsKey = event.target.value; });
    } catch (e) {
      toast(e.message);
    }
  }
  const triageQuestionLabels = {
    category: ['Categoria da solicitação', 'Classifica o tipo principal do problema.'],
    system: ['Sistema ou equipamento', 'Identifica o sistema ou equipamento citado.'],
    impact: ['Impacto operacional', 'Avalia quanto o trabalho da unidade foi afetado.'],
    urgency: ['Urgência', 'Avalia o prazo e a necessidade de atendimento.'],
    is_it_support: ['Escopo de suporte TIC', 'Distingue pedidos de TIC de assuntos jurídicos ou pessoais.'],
    possible_incident: ['Possível incidente coletivo', 'Marca evidências explícitas de impacto em várias pessoas.'],
    human_required: ['Necessidade de atendimento humano', 'Indica quando uma orientação não deve bastar.'],
    outage: ['Indisponibilidade', 'Identifica interrupção total ou parcial de serviço.'],
  };
  const criterionLabels = {
    ACCESS: 'Acesso', SYSTEM: 'Sistemas', NETWORK: 'Rede', HARDWARE: 'Hardware',
    SOFTWARE: 'Software', PRINTING: 'Impressão', OTHER: 'Outros', PJE: 'PJe',
    SEI: 'SEI', EMAIL: 'E-mail', INTERNET: 'Internet', COMPUTER: 'Computador',
    PRINTER: 'Impressora', UNKNOWN: 'Não identificado', LOW: 'Baixo',
    MEDIUM: 'Médio', HIGH: 'Alto', CRITICAL: 'Crítico',
  };
  async function renderTriageSettings() {
    const container = $('#view-triage-settings');
    container.innerHTML = '<div class="integration-loading">Carregando instruções da triagem…</div>';
    try {
      const [settingsResponse, cases] = await Promise.all([
        api('/api/triage/settings'),
        api('/api/triage/benchmark-cases'),
      ]);
      const settings = settingsResponse.questions;
      triageSettingsRequiresKey = settingsResponse.requiresKey === true;
      triageCases = cases;
      triageSettingsBase = settings;
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
      const caseOptions = triageCases.map((item, index) => `<option value="${index}">${esc(item.id)}</option>`).join('');
      const securityBanner = triageSettingsRequiresKey
        ? `<label class="triage-key-field">Chave de configuração<input id="triage-settings-key" type="password" autocomplete="off" value="${esc(triageSettingsKey)}" placeholder="Informe TRIAGE_SETTINGS_KEY"></label>`
        : '<div class="quality-banner triage-security-warning"><b>Configuração sem chave de proteção</b><span>Defina TRIAGE_SETTINGS_KEY no .env antes de disponibilizar a API fora de um ambiente local controlado.</span></div>';
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> MODELO DE DECISÃO</div><h1>Configuração da triagem</h1><p class="page-subtitle">Ajuste as instruções e os critérios enviados ao Laya para classificar cada solicitação.</p></div></div><div class="quality-banner"><b>Configure e compare antes de salvar</b><span>Isso não treina o modelo. As opções e regras do sistema continuam fixas; as descrições dos critérios podem ser ajustadas.</span></div>${securityBanner}<form id="triage-settings-form"><div class="panel triage-settings-panel"><div class="triage-prompt-list">${fields}</div><div class="integration-form-footer"><p>Use critérios observáveis e evite dados pessoais.</p><button class="button button-primary" type="submit">Salvar configuração</button></div></div></form><section class="panel triage-preview-panel"><div class="panel-head"><div><h3>Prévia com o benchmark</h3><span>As instruções ainda não salvas serão usadas nesta simulação.</span></div></div><form id="triage-preview-form"><div class="triage-preview-controls"><label>Exemplo do benchmark<select id="triage-benchmark-select"><option value="">Escolha um caso</option>${caseOptions}</select></label><button class="button button-secondary" type="submit">Analisar rascunho</button></div><label class="triage-example-label" for="triage-preview-text">Texto da solicitação</label><textarea id="triage-preview-text" maxlength="1000" placeholder="Selecione um exemplo ou escreva um texto de teste (mínimo 8 caracteres)." required></textarea></form><div id="triage-preview-result" aria-live="polite"></div></section>`;
      $('#triage-settings-key')?.addEventListener('input', (event) => { triageSettingsKey = event.target.value; });
      $('#triage-benchmark-select').addEventListener('change', (event) => {
        const item = event.target.value === '' ? null : triageCases[Number(event.target.value)];
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
      const original = triageSettingsBase[key] || {};
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
    const key = $('#triage-settings-key')?.value || $('#pilot-settings-key')?.value || $('#quality-settings-key')?.value || triageSettingsKey;
    if (key) triageSettingsKey = key;
    return key ? { Authorization: `Bearer ${key}` } : {};
  }
  async function previewTriageDraft(form) {
    const button = form.querySelector('button[type="submit"]');
    const result = $('#triage-preview-result');
    const caseIndex = $('#triage-benchmark-select').value;
    const selectedCase = caseIndex === '' ? null : triageCases[Number(caseIndex)];
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
      const isLocalFallback = data.provider === 'local_rules';
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
  async function renderPilot() {
    const container = $('#view-pilot');
    container.innerHTML = '<div class="integration-loading">Carregando indicadores do piloto…</div>';
    try {
      const [configuration, report] = await Promise.all([
        api('/api/pilot/settings'),
        api('/api/pilot/metrics'),
      ]);
      const levels = [['CRITICAL', 'Crítica'], ['HIGH', 'Alta'], ['MEDIUM', 'Média'], ['LOW', 'Baixa']];
      const targetRows = levels.map(([key, label]) => `<tr><td>${label}</td><td><input type="number" min="1" max="100000" name="response.${key}" value="${esc(configuration.targets.response[key])}" required></td><td><input type="number" min="1" max="100000" name="resolution.${key}" value="${esc(configuration.targets.resolution[key])}" required></td></tr>`).join('');
      const period = (title, metric) => `<section class="pilot-period"><h3>${title}</h3><div class="pilot-metrics-grid"><div><small>Solicitações</small><b>${metric?.requests ?? '—'}</b></div><div><small>Chamados</small><b>${metric?.tickets ?? '—'}</b></div><div><small>Resolvidas no autoatendimento</small><b>${metric?.selfServiceResolved ?? '—'}</b></div><div><small>1ª atribuição observada</small><b>${metric?.avgMinutesToAssignment == null ? 'Sem dados' : `${metric.avgMinutesToAssignment} min`}</b></div><div><small>Resolução observada</small><b>${metric?.avgMinutesToResolution == null ? 'Sem dados' : `${metric.avgMinutesToResolution} min`}</b></div><div><small>SLA resposta / resolução</small><b>${metric?.responseSla == null ? 'Sem dados' : `${metric.responseSla}%`} / ${metric?.resolutionSla == null ? 'Sem dados' : `${metric.resolutionSla}%`}</b></div><div><small>Satisfação média</small><b>${metric?.avgSatisfaction == null ? 'Sem dados' : `${metric.avgSatisfaction} / 5`}</b><small>${metric?.satisfactionResponses ?? 0} respostas</small></div></div></section>`;
      const locations = report.locality.length
        ? `<div class="table-wrap"><table><thead><tr><th>COMARCA / MUNICÍPIO</th><th>CHAMADOS</th><th>1ª ATRIBUIÇÃO OBSERVADA</th><th>RESOLUÇÃO OBSERVADA</th></tr></thead><tbody>${report.locality.map((row) => `<tr><td>${esc(row.locality || 'Não informada')}</td><td>${row.tickets}</td><td>${row.avg_minutes_to_assignment == null ? 'Sem dados' : `${row.avg_minutes_to_assignment} min`}</td><td>${row.avg_minutes_to_resolution == null ? 'Sem dados' : `${row.avg_minutes_to_resolution} min`}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty-state"><b>Sem chamados reais neste período</b><p>Registros sintéticos são excluídos dos indicadores do piloto.</p></div>';
      const keyBlock = triageSettingsRequiresKey
        ? `<label class="triage-key-field">Chave de configuração<input id="pilot-settings-key" type="password" autocomplete="off" value="${esc(triageSettingsKey)}" placeholder="Informe TRIAGE_SETTINGS_KEY"></label>`
        : '<div class="quality-banner triage-security-warning"><b>Configuração sem chave de proteção</b><span>Defina TRIAGE_SETTINGS_KEY no .env antes de disponibilizar a API fora de ambiente local controlado.</span></div>';
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> MEDIÇÃO OPERACIONAL</div><h1>Piloto e SLAs</h1><p class="page-subtitle">Compare períodos equivalentes e acompanhe os resultados reais por prioridade e localidade.</p></div><button class="button button-secondary" data-action="sync-pilot-status">Sincronizar status do GLPI</button></div><div class="quality-banner"><b>Indicadores observados, sem dados sintéticos</b><span>Tempos começam a ser registrados a partir desta versão e da primeira sincronização. A atribuição observada é uma aproximação de primeira resposta; confirme os marcos com a equipe antes de usar como SLA oficial. Os percentuais de SLA consideram somente chamados com marco observado; chamados ainda abertos não entram no cálculo.</span></div>${keyBlock}<form id="pilot-settings-form"><section class="panel pilot-config-panel"><div class="panel-head"><div><h3>Períodos de comparação</h3><span>Use janelas de duração semelhante e não sobrepostas.</span></div></div><div class="pilot-date-grid"><label>Linha de base · início<input type="date" name="baselineStart" value="${esc(configuration.windows.baselineStart)}" required></label><label>Linha de base · fim<input type="date" name="baselineEnd" value="${esc(configuration.windows.baselineEnd)}" required></label><label>Piloto · início<input type="date" name="pilotStart" value="${esc(configuration.windows.pilotStart)}" required></label><label>Piloto · fim<input type="date" name="pilotEnd" value="${esc(configuration.windows.pilotEnd)}" required></label></div><h3 class="pilot-subheading">Metas de tempo (minutos)</h3><p class="pilot-help">Defina metas aprovadas pela gestão de TIC; estes valores não são preenchidos automaticamente.</p><div class="table-wrap"><table><thead><tr><th>PRIORIDADE</th><th>1ª RESPOSTA</th><th>RESOLUÇÃO</th></tr></thead><tbody>${targetRows}</tbody></table></div><div class="integration-form-footer"><p>O piloto mede somente solicitações e chamados reais registrados no JUDICI.A.</p><button class="button button-primary" type="submit">Salvar plano do piloto</button></div></section></form><div class="pilot-comparison">${period('Linha de base', report.baseline)}${period('Piloto', report.pilot)}</div><section class="panel pilot-locality-panel"><div class="panel-head"><div><h3>Equidade por comarca / município</h3><span>Compare volumes e tempos dentro da janela do piloto.</span></div></div>${locations}</section>`;
      $('#pilot-settings-key')?.addEventListener('input', (event) => { triageSettingsKey = event.target.value; });
    } catch (error) {
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> MEDIÇÃO OPERACIONAL</div><h1>Piloto e SLAs</h1><p class="page-subtitle">Não foi possível carregar os indicadores: ${esc(error.message)}</p></div></div>`;
    }
  }
  async function savePilotSettings(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const targets = { response: {}, resolution: {} };
    for (const [key, value] of Object.entries(values)) {
      const [kind, level] = key.split('.');
      if (level) targets[kind][level] = Number(value);
    }
    try {
      await api('/api/pilot/settings', {
        method: 'PUT', headers: triageSettingsAuthHeaders(),
        body: JSON.stringify({
          windows: Object.fromEntries(Object.entries(values).filter(([key]) => !key.includes('.'))),
          targets,
        }),
      });
      toast('Plano e metas do piloto salvos.');
      void renderPilot();
    } catch (error) {
      toast(error.message);
    }
  }
  async function syncPilotStatuses() {
    try {
      const result = await api('/api/tickets/sync', { method: 'POST', body: '{}' });
      toast(`${result.synchronized} status sincronizados${result.errors?.length ? `; ${result.errors.length} falhas` : ''}.`);
      void renderPilot();
    } catch (error) {
      toast(error.message);
    }
  }
  async function syncTicketStatuses() {
    try {
      const result = await api('/api/tickets/sync', { method: 'POST', body: '{}' });
      toast(`${result.synchronized} status sincronizados${result.errors?.length ? `; ${result.errors.length} falhas` : ''}.`);
      void renderTickets();
    } catch (error) {
      toast(error.message);
    }
  }
  async function renderIntegration() {
    const container = $('#view-integration');
    container.innerHTML = '<div class="integration-loading">Consultando o conector de chamados…</div>';
    try {
      const [healthInfo, settings] = await Promise.all([api('/api/health'), api('/api/ticketing/settings')]);
      const configured = healthInfo.ticketing?.provider === 'glpi';
      const result = await api('/api/ticketing/health').catch((error) => ({ status: 'unavailable', error: error.message }));
      const connected = result.status === 'ok' && result.authenticated;
      const state = connected ? 'connected' : configured ? 'disconnected' : 'mock';
      const title = connected ? 'Conectado' : configured ? 'Sem conexão' : 'Modo demonstração';
      const description = connected ? 'Autenticação confirmada e documentação da API acessível.' : configured ? result.error || 'Não foi possível autenticar no GLPI. Confira as variáveis no servidor.' : 'O sistema está usando o adaptador simulado. Nenhum chamado é enviado ao GLPI.';
      const mappedCategories = Object.values(settings.queueCategoryIds || {}).filter(Boolean).length;
      const features = [['Autenticação e documentação', connected ? 'Disponível' : configured ? 'Indisponível' : 'Não configurado'], ['Abertura de chamados', configured ? 'Ativa após triagem' : 'Simulada localmente'], ['Base de conhecimento', configured ? 'GLPI' : 'Dados demonstrativos'], ['Categorias de fila mapeadas', `${mappedCategories}/5`]];
      const queueNames = { SUPORTE_PJE: 'PJe', SUPORTE_REDE: 'Rede', SUPORTE_HARDWARE: 'Hardware', SUPORTE_SISTEMAS: 'Sistemas', SUPORTE_GERAL: 'Geral' };
      const queueMapping = Object.entries(queueNames).map(([queue, label]) => `<label>ID da categoria GLPI · ${label}<input name="queueCategory_${queue}" inputmode="numeric" pattern="[0-9]*" value="${esc(settings.queueCategoryIds?.[queue] || '')}" placeholder="Opcional"></label>`).join('');
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> CONECTORES</div><h1>Integração GLPI</h1><p class="page-subtitle">Edite as credenciais e acompanhe o estado do conector de chamados.</p></div><button class="button button-secondary" data-action="refresh-integration">Verificar conexão</button></div><section class="panel integration-status ${state}"><span class="integration-indicator" aria-hidden="true"></span><div><span class="integration-overline">STATUS EM EXECUÇÃO</span><h2>${esc(title)}</h2><p>${esc(description)}</p></div><span class="integration-provider">${configured ? 'GLPI 11 · API v2' : 'Adaptador mock'}</span></section><div class="integration-grid">${features.map(([label, value]) => `<section class="panel integration-feature"><span>${esc(label)}</span><b>${esc(value)}</b></section>`).join('')}</div><form id="integration-form" class="panel integration-panel"><div class="panel-head"><div><h3>Configurações da integração</h3><span>Segredos são protegidos e nunca aparecem preenchidos na tela.</span></div></div><div class="integration-content"><div class="integration-fields"><label>Provedor<select name="provider"><option value="mock" ${settings.provider === 'mock' ? 'selected' : ''}>Demonstração (mock)</option><option value="glpi" ${settings.provider === 'glpi' ? 'selected' : ''}>GLPI 11</option></select></label><label>URL base da API<input name="apiBaseUrl" type="url" placeholder="https://seu-glpi/api.php" value="${esc(settings.apiBaseUrl)}"></label><label>ID do cliente<input name="clientId" autocomplete="off" value="${esc(settings.clientId)}"></label><label>Segredo do cliente<input name="clientSecret" type="password" autocomplete="new-password" placeholder="${settings.hasClientSecret ? 'Configurado · deixe vazio para manter' : 'Informe o segredo'}"></label><label>Usuário GLPI<input name="username" autocomplete="username" value="${esc(settings.username)}"></label><label>Senha GLPI<input name="password" type="password" autocomplete="new-password" placeholder="${settings.hasPassword ? 'Configurada · deixe vazia para manter' : 'Informe a senha'}"></label><label>Escopo<input name="scope" value="${esc(settings.scope)}"></label><label>Versão da API<input name="apiVersion" value="${esc(settings.apiVersion)}"></label><label>Recurso da base de conhecimento<input name="knowledgeResource" value="${esc(settings.knowledgeResource)}"></label></div><div class="queue-category-mapping"><h4>Roteamento por categoria GLPI</h4><p>Configure IDs de categorias com regras de atribuição de grupo no GLPI. Sem regra de grupo na instância, a fila continua sendo apenas sugestão.</p><div class="integration-fields">${queueMapping}</div></div><div class="integration-form-footer"><p>As alterações são gravadas no servidor e exigem reinício para entrar em vigor.</p><button class="button button-primary" type="submit">Salvar configurações</button></div></div></form>`;
    } catch (error) {
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> CONECTORES</div><h1>Integração GLPI</h1><p class="page-subtitle">Acompanhe a conexão do sistema de chamados.</p></div><button class="button button-secondary" data-action="refresh-integration">Tentar novamente</button></div><section class="panel integration-status disconnected"><span class="integration-indicator"></span><div><span class="integration-overline">STATUS DO CONECTOR</span><h2>Não foi possível consultar</h2><p>${esc(error.message)}</p></div></section>`;
    }
  }
  async function saveIntegrationSettings(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    values.queueCategoryIds = Object.fromEntries(
      Object.entries(values)
        .filter(([key]) => key.startsWith('queueCategory_'))
        .map(([key, value]) => [key.slice('queueCategory_'.length), value]),
    );
    for (const key of Object.keys(values)) if (key.startsWith('queueCategory_')) delete values[key];
    try {
      await api('/api/ticketing/settings', { method: 'PUT', body: JSON.stringify(values) });
      toast('Configurações salvas. Reinicie o servidor para aplicar as alterações.');
      void renderIntegration();
    } catch (error) {
      toast(error.message);
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
      currentUser = null;
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
  async function showDetail(t) {
    if (!t) return;
    try {
      const liveTicket = await api(`/api/tickets/${encodeURIComponent(t.id)}`);
      currentTicket = { ...t, ...liveTicket, locality: t.locality || liveTicket.locality };
      const ticket = currentTicket,
        inc = ticket.incidentId && cache.incidents.find((i) => i.id === ticket.incidentId),
        article = ticket.article || cache.articles.find((a) => a.id === ticket.articleId),
        d = ticket.decision || {};
      $('#view-detail').innerHTML =
        `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> ATENDIMENTO / ${esc(ticket.protocol)}</div><h1>Detalhe do chamado</h1><p class="page-subtitle">Criado em ${fmtDate(ticket.createdAt)} · ${esc(ticket.id)}</p></div><button class="button button-secondary" data-action="tickets">← Voltar aos chamados</button></div><div class="ticket-detail-grid"><div><div class="panel detail-content"><h2>${esc(systemPt[ticket.system])} · ${esc(categoryPt[ticket.category])}</h2><p class="detail-description">${esc(ticket.description)}</p>${inc ? `<div class="rule-note"><b>Vínculo com incidente:</b> ${esc(inc.code)} · ${esc(inc.title)}. Chamado relacionado a um possível padrão coletivo.</div>` : ''}<div class="eyebrow" style="margin:20px 0 12px">TRILHA DA DECISÃO</div><div class="timeline"><div class="timeline-item"><span class="timeline-dot"></span><div><b>Solicitação analisada</b><small>${fmtDate(ticket.createdAt)} · Origem ${esc(ticket.provider)} · Categoria ${categoryPt[ticket.category]}, sistema ${systemPt[ticket.system]}</small></div></div>${article ? `<div class="timeline-item"><span class="timeline-dot"></span><div><b>Base de conhecimento consultada</b><small>${article.id} · ${esc(article.title)} · Autoatendimento oferecido</small></div></div>` : ''}<div class="timeline-item"><span class="timeline-dot"></span><div><b>Chamado criado pelo usuário</b><small>Protocolo ${ticket.protocol} · prioridade ${levelPt[ticket.priority]}</small></div></div><div class="timeline-item"><span class="timeline-dot"></span><div><b>Roteamento aplicado</b><small>${ticket.integration?.provider === 'glpi' ? `Fila sugerida pelo JUDICI.A: ${esc(ticket.queue)}. A atribuição no GLPI ainda depende de configuração.` : `Regra de fila encaminhou para ${esc(ticket.queue)}`}</small></div></div>${inc ? `<div class="timeline-item"><span class="timeline-dot"></span><div><b>Padrão de incidente detectado</b><small>${inc.code} · ${inc.ticketIds.length} chamados relacionados em até 15 minutos</small></div></div>` : ''}</div><div class="rule-note" style="margin:0"><b>Confiança por decisão:</b> categoria ${Math.round((d.categoryConfidence || ticket.confidence) * 100)}% · sistema ${Math.round((d.systemConfidence || ticket.confidence) * 100)}% · impacto ${Math.round((d.impactConfidence || ticket.confidence) * 100)}% · urgência ${Math.round((d.urgencyConfidence || ticket.confidence) * 100)}%. Prioridade e fila foram calculadas pelo código.</div></div></div><aside class="panel detail-aside"><h3>Dados do chamado</h3><div class="aside-field"><small>PROTOCOLO</small><b>${ticket.protocol}</b></div><div class="aside-field"><small>STATUS</small><b class="status">Aberto</b></div><div class="aside-field"><small>PRIORIDADE</small><b><span class="priority ${ticket.priority.toLowerCase()}">${levelPt[ticket.priority]}</span></b></div><div class="aside-field"><small>${ticket.integration?.provider === 'glpi' ? 'FILA SUGERIDA' : 'FILA RESPONSÁVEL'}</small><b>${esc(ticket.queue)}</b></div><div class="aside-field"><small>IMPACTO / URGÊNCIA</small><b>${levelPt[ticket.impact]} / ${levelPt[ticket.urgency]}</b></div><div class="aside-field"><small>CONFIANÇA DA CLASSIFICAÇÃO</small><b>${Math.round(ticket.confidence * 100)}%</b></div><div class="aside-field" style="border:0"><small>SISTEMA</small><b>${systemPt[ticket.system]}</b></div></aside></div>`;
      const aside = $('#view-detail .detail-aside');
      const liveStatus = aside?.querySelector('.aside-field .status');
      if (liveStatus) liveStatus.textContent = ticketStatusPt[ticket.status] || ticket.status || 'Indisponível';
      if (ticket.locality)
        aside?.insertAdjacentHTML('beforeend', `<div class="aside-field"><small>COMARCA / MUNICÍPIO</small><b>${esc(ticket.locality)}</b></div>`);
      if (ticket.integration?.provider === 'glpi')
        aside?.insertAdjacentHTML('beforeend', '<button class="button button-secondary" data-action="refresh-ticket-status">Atualizar status no GLPI</button>');
      navigate('detail');
    } catch (e) {
      toast(e.message);
    }
  }
  async function refreshTicketStatus() {
    if (!currentTicket) return;
    try {
      const result = await api(`/api/tickets/${encodeURIComponent(currentTicket.id)}/status`);
      currentTicket.status = result.status;
      const status = $('#view-detail .detail-aside .status');
      if (status) status.textContent = ticketStatusPt[result.status] || result.status || 'Indisponível';
      toast('Status atualizado diretamente do GLPI.');
    } catch (error) {
      toast(`Não foi possível atualizar o status: ${error.message}`);
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
    currentUser = null;
    window.judiciaSetCsrfToken('');
    $('.app-shell').hidden = true;
    $('#auth-screen').hidden = false;
    $('#auth-error').textContent = 'Sua sessão expirou. Entre novamente.';
    $('#auth-error').hidden = false;
  });
  $('#description').addEventListener(
    'input',
    (e) => ($('#char-count').textContent = `${e.target.value.length} / 1000`),
  );
  $('#analyze-button').addEventListener('click', () => {
    const text = $('#description').value.trim();
    if (text.length < 8) {
      toast('Descreva o problema com pelo menos 8 caracteres.');
      $('#description').focus();
      return;
    }
    const locality = $('#locality').value.trim();
    if (locality.length < 2) {
      toast('Informe sua comarca ou municÃ­pio para encaminharmos e medir o atendimento local.');
      $('#locality').focus();
      return;
    }
    void analyze(text, locality);
  });
  document.querySelectorAll('[data-example]').forEach((b) =>
    b.addEventListener('click', () => {
      $('#description').value = b.dataset.example;
      $('#char-count').textContent = `${b.dataset.example.length} / 1000`;
      $('#description').focus();
    }),
  );
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.addEventListener('click', () => {
      const v = b.dataset.view;
      if (!hasViewAccess(v)) return toast('Seu perfil não tem acesso a este módulo.');
      if (v === 'dashboard') void renderDashboard();
      if (v === 'tickets') void renderTickets();
      if (v === 'incidents') void renderIncidents();
      if (v === 'quality') void renderQuality();
      if (v === 'pilot') void renderPilot();
      if (v === 'integration') void renderIntegration();
      if (v === 'triage-settings') void renderTriageSettings();
      navigate(v);
    }),
  );
  document.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action) {
      if (action === 'logout') void logout();
      if (action === 'home') navigate('inicio');
      if (action === 'continue') openSelfService();
      if (action === 'show-correction') $('#correction-form')?.removeAttribute('hidden');
      if (action === 'save-correction') void saveCorrection();
      if (action === 'save-evaluation-case')
        void saveEvaluationCase(e.target.closest('[data-request]')?.dataset.request);
      if (action === 'save-quality-correction')
        void saveQualityCorrection(e.target.closest('[data-request]')?.dataset.request);
      if (action === 'run-feedback-evaluation') void runFeedbackEvaluation();
      if (action === 'download-evaluation-cases') void downloadEvaluationCases();
      if (action === 'refresh-integration') void renderIntegration();
      if (action === 'refresh-triage-settings') void renderTriageSettings();
      if (action === 'sync-pilot-status') void syncPilotStatuses();
      if (action === 'sync-tickets') void syncTicketStatuses();
      if (action === 'save-integration') void saveIntegrationSettings($('#integration-form'));
      if (action === 'back-analysis') navigate('analysis');
      if (action === 'resolved') void resolve();
      if (action === 'not-resolved') void createTicket();
      if (action === 'ticket-detail') void showDetail(currentTicket);
      if (action === 'refresh-ticket-status') void refreshTicketStatus();
      if (action === 'dashboard') {
        void renderDashboard();
        navigate('dashboard');
      }
      if (action === 'tickets') {
        void renderTickets();
        navigate('tickets');
      }
      if (action === 'incidents') {
        void renderIncidents();
        navigate('incidents');
      }
    }
    const tr = e.target.closest('[data-ticket]');
    if (tr) {
      const t = cache.tickets.find((x) => x.id === tr.dataset.ticket);
      void showDetail(t);
    }
    const ir = e.target.closest('[data-incident]');
    if (ir) {
      void renderIncidents();
      navigate('incidents');
    }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id === 'integration-form') {
      e.preventDefault();
      void saveIntegrationSettings(e.target);
    }
    if (e.target.id === 'triage-settings-form') {
      e.preventDefault();
      void saveTriageSettings(e.target);
    }
    if (e.target.id === 'triage-preview-form') {
      e.preventDefault();
      void previewTriageDraft(e.target);
    }
    if (e.target.id === 'pilot-settings-form') {
      e.preventDefault();
      void savePilotSettings(e.target);
    }
    if (e.target.id === 'request-feedback-form') {
      e.preventDefault();
      void saveRequestFeedback(e.target);
    }
  });
  $('#reset-data').addEventListener('click', () =>
    reload()
      .then(() => toast('Dados atualizados do PostgreSQL.'))
      .catch((e) => toast(e.message)),
  );
  void initializeAuthentication();
})();
