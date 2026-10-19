export function createRequestPages(ctx) {
  const { $, esc, categoryPt, systemPt, levelPt, reviewForm, navigate, state } = ctx;
  function renderAnalysis() {
    const r = state.currentRequest,
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
    const r = state.currentRequest;
    if (!r) return;
    const a = r.article;
    $('#view-selfservice').innerHTML =
      `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> AUTOATENDIMENTO</div><h1>Vamos tentar resolver?</h1><p class="page-subtitle">Encontramos uma orientação que pode ajudar com sua solicitação.</p></div><button class="button button-secondary" data-action="back-analysis">← Voltar à análise</button></div><div class="panel result-card"><div class="result-banner"><span class="result-check">✳</span><div><h2>Encontramos uma possível solução</h2><p>${a ? `${esc(a.id)} · ${esc(systemPt[a.system] || 'Suporte')}` : 'Não localizamos um artigo específico para essa categoria.'}</p></div></div><div class="result-body">${a ? `<div class="article-card"><div class="article-card-head"><b>${esc(a.title)}</b><span>BASE DE CONHECIMENTO · ${esc(a.id)}</span></div><div class="article-card-body"><p>${esc(a.solution)}</p><ol class="steps-list">${a.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div></div>` : `<div class="rule-note">Sua solicitação pode ser encaminhada diretamente para a equipe técnica. Se preferir, abra um chamado agora.</div>`}<div class="action-row" style="margin-top:18px"><button class="button button-secondary" data-action="resolved">✓ Consegui resolver</button><button class="button button-primary" data-action="not-resolved">Ainda preciso de ajuda <span class="button-arrow">→</span></button></div></div></div>`;
    navigate('selfservice');
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
  return { renderAnalysis, openSelfService, renderTicketCreated };
}
