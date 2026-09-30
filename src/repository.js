import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from './config.js';
import { query, queryJson, sqlValue } from './postgres.js';
import { decisionQuestions } from './triage.js';

const schema = `
CREATE TABLE IF NOT EXISTS app_users (id uuid PRIMARY KEY,email text NOT NULL UNIQUE,display_name text NOT NULL,role text NOT NULL CHECK(role IN ('solicitante','tic','gestor')),password_salt text NOT NULL,password_hash text NOT NULL,active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_sessions (token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,csrf_hash text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS app_sessions_user_expiry_idx ON app_sessions(user_id,expires_at);
CREATE TABLE IF NOT EXISTS knowledge_articles (id text PRIMARY KEY,title text NOT NULL,category text NOT NULL,system text NOT NULL,problem text NOT NULL,solution text NOT NULL,steps jsonb NOT NULL DEFAULT '[]',active boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS requests (id text PRIMARY KEY,description text NOT NULL,decision jsonb NOT NULL,priority text NOT NULL,queue text NOT NULL,confidence numeric NOT NULL,article_id text REFERENCES knowledge_articles(id),status text NOT NULL DEFAULT 'ANALYZED',provider text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS decisions (id bigserial PRIMARY KEY,request_id text NOT NULL REFERENCES requests(id) ON DELETE CASCADE,payload jsonb NOT NULL,provider text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE SEQUENCE IF NOT EXISTS ticket_protocol_seq START 106;
CREATE TABLE IF NOT EXISTS tickets (id text PRIMARY KEY,protocol text UNIQUE NOT NULL,request_id text NOT NULL REFERENCES requests(id),description text NOT NULL,category text NOT NULL,system text NOT NULL,impact text NOT NULL,urgency text NOT NULL,priority text NOT NULL,status text NOT NULL DEFAULT 'OPEN',assigned_queue text NOT NULL,confidence numeric NOT NULL,incident_code text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS incidents (code text PRIMARY KEY,title text NOT NULL,system text NOT NULL,category text NOT NULL,severity text NOT NULL,status text NOT NULL DEFAULT 'INVESTIGATING',detected_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS incident_tickets (incident_code text NOT NULL REFERENCES incidents(code) ON DELETE CASCADE,ticket_id text NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,PRIMARY KEY(incident_code,ticket_id));
CREATE TABLE IF NOT EXISTS service_events (id bigserial PRIMARY KEY,type text NOT NULL,request_id text NOT NULL REFERENCES requests(id),knowledge_article_id text,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ticket_status_history (id bigserial PRIMARY KEY,ticket_id text NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,previous_status text,status text NOT NULL,observed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS request_feedback (request_id text PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,rating smallint NOT NULL CHECK(rating BETWEEN 1 AND 5),comment text,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS tickets_system_created_idx ON tickets(system,created_at DESC);
CREATE INDEX IF NOT EXISTS requests_created_idx ON requests(created_at DESC);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS triage_status text NOT NULL DEFAULT 'READY';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS locality text NOT NULL DEFAULT 'Não informada';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS article_snapshot jsonb;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS corrected_decision jsonb;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS corrected_at timestamptz;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS correction_reason text;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT false;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES app_users(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS synthetic boolean NOT NULL DEFAULT false;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_assigned_at timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_resolved_at timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS status_synced_at timestamptz;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS glpi_category_id integer;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS queue_routing text NOT NULL DEFAULT 'SUGGESTED_ONLY';
CREATE TABLE IF NOT EXISTS evaluation_cases (id bigserial PRIMARY KEY,source_request_id text NOT NULL UNIQUE REFERENCES requests(id) ON DELETE CASCADE,text text NOT NULL,expected jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY,value jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());`;

const seedArticles = [
  {
    id: 'KB-001',
    title: 'Problemas de acesso ao PJe',
    category: 'SYSTEM',
    system: 'PJE',
    problem: 'Usuário não consegue acessar o sistema',
    solution: 'Confira a conexão e valide os dados de autenticação antes de tentar novamente.',
    steps: [
      'Verifique se a conexão com a internet está ativa.',
      'Confirme se está usando o endereço correto do PJe.',
      'Feche e abra o navegador e tente acessar novamente.',
      'Se a mensagem persistir, anote o texto do erro e abra um chamado.',
    ],
  },
  {
    id: 'KB-002',
    title: 'Impressora não está imprimindo',
    category: 'HARDWARE',
    system: 'PRINTER',
    problem: 'Documentos enviados não são impressos',
    solution: 'Verifique energia, papel, conexão e fila de impressão.',
    steps: [
      'Confirme se a impressora está ligada e sem alertas.',
      'Verifique papel e toner.',
      'Confira se a impressora correta está selecionada.',
      'Limpe trabalhos parados na fila e tente imprimir uma página de teste.',
    ],
  },
  {
    id: 'KB-003',
    title: 'Conexão de rede instável',
    category: 'NETWORK',
    system: 'INTERNET',
    problem: 'Acesso à internet oscila ou fica indisponível',
    solution: 'Verifique a conexão local e identifique se outras pessoas estão afetadas.',
    steps: [
      'Confira se o cabo de rede está conectado ou reconecte ao Wi-Fi.',
      'Teste outro site ou serviço institucional.',
      'Pergunte se colegas da unidade enfrentam o mesmo problema.',
      'Se várias pessoas forem afetadas, abra um chamado para a equipe de rede.',
    ],
  },
  {
    id: 'KB-004',
    title: 'Computador não liga',
    category: 'HARDWARE',
    system: 'COMPUTER',
    problem: 'Estação de trabalho não inicia',
    solution: 'Confira energia e conexões antes de solicitar suporte.',
    steps: [
      'Verifique se o cabo de energia está conectado.',
      'Confira a tomada e o filtro de linha.',
      'Pressione o botão de energia por alguns segundos.',
      'Se não iniciar, abra um chamado e informe o patrimônio do equipamento.',
    ],
  },
  {
    id: 'KB-005',
    title: 'Falha de autenticação ou senha',
    category: 'ACCESS',
    system: 'OTHER',
    problem: 'Senha não funciona ao entrar em um serviço',
    solution: 'Confirme o usuário e procure sinais de bloqueio ou expiração.',
    steps: [
      'Confira se o teclado está no idioma correto e Caps Lock está desligado.',
      'Digite novamente o usuário e a senha com atenção.',
      'Se a senha expirou ou a conta foi bloqueada, solicite redefinição pelo canal de suporte.',
    ],
  },
  {
    id: 'KB-006',
    title: 'E-mail indisponível',
    category: 'SYSTEM',
    system: 'EMAIL',
    problem: 'Não é possível enviar ou receber mensagens',
    solution: 'Verifique conexão, espaço da caixa e configurações básicas.',
    steps: [
      'Teste o acesso a outro serviço para confirmar a conexão.',
      'Atualize a página ou reinicie o aplicativo de e-mail.',
      'Confira se a caixa de entrada não atingiu o limite.',
      'Registre a mensagem de erro ao solicitar suporte.',
    ],
  },
  {
    id: 'KB-007',
    title: 'Sistema lento',
    category: 'SOFTWARE',
    system: 'OTHER',
    problem: 'Aplicativo demora para responder',
    solution: 'Feche sessões sem uso e teste novamente.',
    steps: [
      'Salve seu trabalho.',
      'Feche abas e aplicativos que não estão em uso.',
      'Reinicie o navegador e teste novamente.',
      'Informe quais telas ou ações ficam lentas ao abrir um chamado.',
    ],
  },
];
export function init() {
  query(schema);
  for (const article of seedArticles)
    query(
      `INSERT INTO knowledge_articles(id,title,category,system,problem,solution,steps) VALUES(${sqlValue(article.id)},${sqlValue(article.title)},${sqlValue(article.category)},${sqlValue(article.system)},${sqlValue(article.problem)},${sqlValue(article.solution)},${sqlValue(JSON.stringify(article.steps))}::jsonb) ON CONFLICT(id) DO NOTHING`,
    );
  seedTickets();
  query(
    "UPDATE requests SET synthetic=true WHERE id LIKE 'REQ-DEMO-%'; UPDATE tickets SET synthetic=true WHERE id LIKE 'TCK-DEMO-%';",
  );
  query(
    "UPDATE requests SET priority='MEDIUM',decision=jsonb_set(jsonb_set(jsonb_set(decision,'{impact}','\"MEDIUM\"'::jsonb),'{urgency}','\"MEDIUM\"'::jsonb),'{possibleIncident}','false'::jsonb) WHERE id='REQ-DEMO-02'; UPDATE tickets SET impact='MEDIUM',urgency='MEDIUM',priority='MEDIUM' WHERE id='TCK-DEMO-02';",
  );
  query(
    "UPDATE incidents SET status='DISMISSED' WHERE status='INVESTIGATING' AND code IN (SELECT DISTINCT it.incident_code FROM incident_tickets it JOIN tickets t ON t.id=it.ticket_id WHERE t.synthetic);",
  );
}

export function getTriageQuestionSettings() {
  const saved = queryJson(
    `SELECT value FROM app_settings WHERE key='triage_questions' LIMIT 1`,
    null,
  );
  return saved || decisionQuestions;
}

export function normalizeTriageQuestionSettings(input = {}) {
  const updated = {};
  for (const [key, original] of Object.entries(decisionQuestions)) {
    const instructions = String(input[key]?.instructions ?? '').trim();
    if (instructions.length < 12 || instructions.length > 800)
      throw new Error(`A instrução de ${key} deve ter entre 12 e 800 caracteres.`);
    const question = { ...original, instructions };
    if (original.criteria && !Array.isArray(original.criteria)) {
      question.criteria = {};
      for (const option of Object.keys(original.criteria)) {
        const text = String(input[key]?.criteria?.[option] ?? '').trim();
        if (text.length < 2 || text.length > 240) throw new Error(`Invalid criterion ${option} for ${key}.`);
        question.criteria[option] = text;
      }
    } else if (Array.isArray(original.criteria)) {
      question.criteria = original.criteria.map((_, index) => {
        const text = String(input[key]?.criteria?.[index] ?? '').trim();
        if (text.length < 2 || text.length > 240) throw new Error(`Invalid level ${index + 1} for ${key}.`);
        return text;
      });
    }
    updated[key] = question;
  }
  return updated;
}

export function saveTriageQuestionSettings(input = {}) {
  const updated = normalizeTriageQuestionSettings(input);
  query(
    `INSERT INTO app_settings(key,value) VALUES('triage_questions',${sqlValue(JSON.stringify(updated))}::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
  );
  return updated;
}
export function triageBenchmarkCases() {
  const cases = JSON.parse(fs.readFileSync(path.join(projectRoot, 'evaluation', 'cases.json'), 'utf8'));
  return cases.map(({ id, text, expected }) => ({ id, text, expected }));
}
function seedTickets() {
  const count = Number(query('SELECT count(*) FROM tickets'));
  if (count > 0) return;
  const demos = [
    [
      'JUD-000101',
      'PJe não abre desde o início da manhã. A unidade está sem conseguir consultar os processos.',
      'SYSTEM',
      'PJE',
      'HIGH',
      'HIGH',
      'HIGH',
      'SUPORTE_PJE',
      0.95,
      11,
    ],
    [
      'JUD-000102',
      'Não consigo entrar no PJe, aparece erro ao acessar.',
      'SYSTEM',
      'PJE',
      'HIGH',
      'HIGH',
      'HIGH',
      'SUPORTE_PJE',
      0.92,
      8,
    ],
    [
      'JUD-000103',
      'PJe está indisponível para várias pessoas da unidade.',
      'SYSTEM',
      'PJE',
      'HIGH',
      'HIGH',
      'HIGH',
      'SUPORTE_PJE',
      0.94,
      5,
    ],
    [
      'JUD-000104',
      'A internet está instável na minha estação.',
      'NETWORK',
      'INTERNET',
      'MEDIUM',
      'MEDIUM',
      'MEDIUM',
      'SUPORTE_REDE',
      0.91,
      2,
    ],
    [
      'JUD-000105',
      'Impressora do setor não está imprimindo.',
      'HARDWARE',
      'PRINTER',
      'MEDIUM',
      'MEDIUM',
      'MEDIUM',
      'SUPORTE_HARDWARE',
      0.9,
      1,
    ],
  ];
  for (let n = 0; n < demos.length; n++) {
    const d = demos[n],
      rid = `REQ-DEMO-0${n + 1}`,
      id = `TCK-DEMO-0${n + 1}`,
      decision = {
        category: d[2],
        system: d[3],
        impact: d[4],
        urgency: d[5],
        possibleIncident: d[3] === 'PJE',
        humanRequired: true,
        confidence: d[8],
        categoryConfidence: d[8],
        impactConfidence: d[8],
        urgencyConfidence: d[8],
        incidentConfidence: d[8],
        humanConfidence: d[8],
      };
    query(
      `INSERT INTO requests(id,description,decision,priority,queue,confidence,article_id,provider,created_at) VALUES(${sqlValue(rid)},${sqlValue(d[1])},${sqlValue(JSON.stringify(decision))}::jsonb,${sqlValue(d[6])},${sqlValue(d[7])},${d[8]},${sqlValue(d[3] === 'PJE' ? 'KB-001' : null)},'synthetic_seed',now()-interval '${d[9]} minutes') ON CONFLICT DO NOTHING`,
    );
    query(
      `INSERT INTO tickets(id,protocol,request_id,description,category,system,impact,urgency,priority,assigned_queue,confidence,created_at) VALUES(${sqlValue(id)},${sqlValue(d[0])},${sqlValue(rid)},${sqlValue(d[1])},${sqlValue(d[2])},${sqlValue(d[3])},${sqlValue(d[4])},${sqlValue(d[5])},${sqlValue(d[6])},${sqlValue(d[7])},${d[8]},now()-interval '${d[9]} minutes') ON CONFLICT DO NOTHING`,
    );
  }
}

export function articlesFor(category, system) {
  return queryJson(
    `SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT id,title,category,system,problem,solution,steps FROM knowledge_articles WHERE active AND (system=${sqlValue(system)} OR category=${sqlValue(category)}) ORDER BY CASE WHEN system=${sqlValue(system)} THEN 0 ELSE 1 END,id LIMIT 5) x`,
  );
}
export function listTickets(ownerId = null) {
  const ownerFilter = ownerId ? `WHERE r.created_by=${sqlValue(ownerId)}::uuid` : '';
  return queryJson(`SELECT coalesce(json_agg(x),'[]'::json) FROM (
    SELECT t.id,t.protocol,t.request_id AS "requestId",t.description,t.category,t.system,t.impact,t.urgency,t.priority,t.status,t.assigned_queue AS queue,t.queue_routing AS "queueRouting",t.glpi_category_id AS "glpiCategoryId",t.confidence::float,t.incident_code AS "incidentId",t.created_at AS "createdAt",r.locality,
      CASE WHEN t.id LIKE 'GLPI-%' THEN json_build_object('provider','glpi','mode','external','displayName','GLPI 11') ELSE json_build_object('provider','mock','mode','simulated','displayName','Conector simulado') END AS integration,
      CASE WHEN r.corrected_decision IS NOT NULL THEN 'human_correction' ELSE r.provider END AS provider,coalesce(r.article_snapshot->>'id',r.article_id) AS "articleId",r.article_snapshot AS article,coalesce(r.corrected_decision,r.decision) AS decision,(r.corrected_decision IS NOT NULL) AS "humanCorrected",t.synthetic
    FROM tickets t JOIN requests r ON r.id=t.request_id ${ownerFilter} ORDER BY t.created_at DESC) x`).map(
    (t) => ({ ...t, confidence: Number(t.confidence) }),
  );
}
export function requestOwnedBy(requestId, userId) {
  return query(
    `SELECT 1 FROM requests WHERE id=${sqlValue(requestId)} AND created_by=${sqlValue(userId)}::uuid LIMIT 1`,
  ) === '1';
}
export function ticketOwnedBy(ticketId, userId) {
  return query(
    `SELECT 1 FROM tickets t JOIN requests r ON r.id=t.request_id WHERE t.id=${sqlValue(ticketId)} AND r.created_by=${sqlValue(userId)}::uuid LIMIT 1`,
  ) === '1';
}
export function recordTicketStatus(ticketId, status) {
  const knownStatuses = new Set(['NEW', 'ASSIGNED', 'PLANNED', 'WAITING', 'SOLVED', 'CLOSED', 'OPEN', 'UNKNOWN']);
  if (!knownStatuses.has(status)) throw new Error('Status de chamado invÃ¡lido.');
  const current = queryJson(
    `SELECT json_build_object('status',status,'firstAssignedAt',first_assigned_at,'firstResolvedAt',first_resolved_at) FROM tickets WHERE id=${sqlValue(ticketId)} LIMIT 1`,
    null,
  );
  if (!current) return null;
  const assigned = ['ASSIGNED', 'PLANNED', 'WAITING', 'SOLVED', 'CLOSED'].includes(status);
  const resolved = ['SOLVED', 'CLOSED'].includes(status);
  query(
    `UPDATE tickets SET status=${sqlValue(status)},first_assigned_at=CASE WHEN ${assigned} AND first_assigned_at IS NULL THEN now() ELSE first_assigned_at END,first_resolved_at=CASE WHEN ${resolved} AND first_resolved_at IS NULL THEN now() ELSE first_resolved_at END,status_synced_at=now() WHERE id=${sqlValue(ticketId)}`,
  );
  if (current.status !== status)
    query(
      `INSERT INTO ticket_status_history(ticket_id,previous_status,status) VALUES(${sqlValue(ticketId)},${sqlValue(current.status)},${sqlValue(status)})`,
    );
  return { previousStatus: current.status, status, changed: current.status !== status };
}

export function saveRequestFeedback(requestId, rating, comment = '') {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new Error('A avaliaÃ§Ã£o deve ser de 1 a 5.');
  const request = queryJson(
    `SELECT json_build_object('id',id,'status',status,'synthetic',synthetic) FROM requests WHERE id=${sqlValue(requestId)} LIMIT 1`,
    null,
  );
  if (!request || request.synthetic) throw new Error('SolicitaÃ§Ã£o nÃ£o encontrada para avaliaÃ§Ã£o.');
  if (request.status !== 'SELF_SERVICE_RESOLVED')
    throw new Error('A avaliaÃ§Ã£o sÃ³ pode ser registrada apÃ³s uma resoluÃ§Ã£o por autoatendimento.');
  const note = String(comment).trim().slice(0, 500) || null;
  query(
    `INSERT INTO request_feedback(request_id,rating,comment) VALUES(${sqlValue(requestId)},${rating},${sqlValue(note)}) ON CONFLICT(request_id) DO UPDATE SET rating=EXCLUDED.rating,comment=EXCLUDED.comment,created_at=now()`,
  );
  return { saved: true };
}

export function pilotMetrics() {
  const metricForWindow = (start, end) => {
    if (!start || !end) return null;
    const from = `${sqlValue(start)}::timestamptz`;
    const to = `${sqlValue(end)}::date + interval '1 day'`;
    const targetValues = queryJson(`SELECT value FROM app_settings WHERE key='pilot_sla_targets' LIMIT 1`, null) || {};
    const targetJson = JSON.stringify(targetValues);
    const targetsSql = `${sqlValue(targetJson)}::jsonb`;
    return queryJson(`WITH targets AS (SELECT
      (${targetsSql}->'response'->>'CRITICAL')::numeric AS response_critical,
      (${targetsSql}->'response'->>'HIGH')::numeric AS response_high,
      (${targetsSql}->'response'->>'MEDIUM')::numeric AS response_medium,
      (${targetsSql}->'response'->>'LOW')::numeric AS response_low,
      (${targetsSql}->'resolution'->>'CRITICAL')::numeric AS resolution_critical,
      (${targetsSql}->'resolution'->>'HIGH')::numeric AS resolution_high,
      (${targetsSql}->'resolution'->>'MEDIUM')::numeric AS resolution_medium,
      (${targetsSql}->'resolution'->>'LOW')::numeric AS resolution_low
    ), requests_window AS (
      SELECT r.* FROM requests r WHERE r.synthetic=false AND r.created_at >= ${from} AND r.created_at < ${to}
    ), tickets_window AS (
      SELECT t.*,r.locality FROM tickets t JOIN requests_window r ON r.id=t.request_id WHERE t.synthetic=false
    )
    SELECT json_build_object(
      'requests',(SELECT count(*) FROM requests_window),
      'tickets',(SELECT count(*) FROM tickets_window),
      'selfServiceResolved',(SELECT count(*) FROM service_events e JOIN requests_window r ON r.id=e.request_id WHERE e.type='SELF_SERVICE_RESOLVED'),
      'avgMinutesToAssignment',(SELECT round(avg(extract(epoch from (first_assigned_at-created_at))/60)::numeric,1) FROM tickets_window WHERE first_assigned_at IS NOT NULL),
      'avgMinutesToResolution',(SELECT round(avg(extract(epoch from (first_resolved_at-created_at))/60)::numeric,1) FROM tickets_window WHERE first_resolved_at IS NOT NULL),
      'responseSla',(SELECT CASE WHEN count(*)=0 THEN NULL ELSE round(100.0*count(*) FILTER(WHERE first_assigned_at-created_at <= make_interval(mins => (CASE priority WHEN 'CRITICAL' THEN targets.response_critical WHEN 'HIGH' THEN targets.response_high WHEN 'MEDIUM' THEN targets.response_medium WHEN 'LOW' THEN targets.response_low END)::int))/count(*),1) END FROM tickets_window CROSS JOIN targets WHERE first_assigned_at IS NOT NULL AND (CASE priority WHEN 'CRITICAL' THEN targets.response_critical WHEN 'HIGH' THEN targets.response_high WHEN 'MEDIUM' THEN targets.response_medium WHEN 'LOW' THEN targets.response_low END) IS NOT NULL),
      'resolutionSla',(SELECT CASE WHEN count(*)=0 THEN NULL ELSE round(100.0*count(*) FILTER(WHERE first_resolved_at-created_at <= make_interval(mins => (CASE priority WHEN 'CRITICAL' THEN targets.resolution_critical WHEN 'HIGH' THEN targets.resolution_high WHEN 'MEDIUM' THEN targets.resolution_medium WHEN 'LOW' THEN targets.resolution_low END)::int))/count(*),1) END FROM tickets_window CROSS JOIN targets WHERE first_resolved_at IS NOT NULL AND (CASE priority WHEN 'CRITICAL' THEN targets.resolution_critical WHEN 'HIGH' THEN targets.resolution_high WHEN 'MEDIUM' THEN targets.resolution_medium WHEN 'LOW' THEN targets.resolution_low END) IS NOT NULL),
      'avgSatisfaction',(SELECT round(avg(f.rating)::numeric,2) FROM request_feedback f JOIN requests_window r ON r.id=f.request_id),
      'satisfactionResponses',(SELECT count(*) FROM request_feedback f JOIN requests_window r ON r.id=f.request_id)
    )`);
  };
  const settings = queryJson(
    `SELECT value FROM app_settings WHERE key='pilot_windows' LIMIT 1`,
    null,
  ) || {};
  const baseline = metricForWindow(settings.baselineStart, settings.baselineEnd);
  const pilot = metricForWindow(settings.pilotStart, settings.pilotEnd);
  const locality = settings.pilotStart && settings.pilotEnd
    ? queryJson(`SELECT coalesce(json_agg(x),'[]'::json) FROM (
      SELECT coalesce(r.locality,'NÃ£o informada') AS locality,count(*)::int AS tickets,
      round(avg(extract(epoch from (t.first_assigned_at-t.created_at))/60)::numeric,1) AS avg_minutes_to_assignment,
      round(avg(extract(epoch from (t.first_resolved_at-t.created_at))/60)::numeric,1) AS avg_minutes_to_resolution
      FROM tickets t JOIN requests r ON r.id=t.request_id
      WHERE t.synthetic=false AND r.synthetic=false AND r.created_at>=${sqlValue(settings.pilotStart)}::timestamptz AND r.created_at<${sqlValue(settings.pilotEnd)}::date + interval '1 day'
      GROUP BY r.locality ORDER BY tickets DESC,locality) x`)
    : [];
  return { windows: settings, baseline, pilot, locality };
}
export function getPilotConfiguration() {
  return {
    windows: queryJson(`SELECT value FROM app_settings WHERE key='pilot_windows' LIMIT 1`, null) || {
      baselineStart: '', baselineEnd: '', pilotStart: '', pilotEnd: '',
    },
    targets: queryJson(`SELECT value FROM app_settings WHERE key='pilot_sla_targets' LIMIT 1`, null) || {
      response: { CRITICAL: '', HIGH: '', MEDIUM: '', LOW: '' },
      resolution: { CRITICAL: '', HIGH: '', MEDIUM: '', LOW: '' },
    },
  };
}
export function savePilotConfiguration(input = {}) {
  const dateValue = (value, label) => {
    const date = String(value || '').trim();
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date)
      throw new Error(`Informe uma data vÃ¡lida para ${label}.`);
    return date;
  };
  const windows = {
    baselineStart: dateValue(input.windows?.baselineStart, 'inÃ­cio da linha de base'),
    baselineEnd: dateValue(input.windows?.baselineEnd, 'fim da linha de base'),
    pilotStart: dateValue(input.windows?.pilotStart, 'inÃ­cio do piloto'),
    pilotEnd: dateValue(input.windows?.pilotEnd, 'fim do piloto'),
  };
  if (windows.baselineStart >= windows.baselineEnd || windows.pilotStart >= windows.pilotEnd)
    throw new Error('A data final de cada perÃ­odo deve ser posterior Ã  data inicial.');
  if (windows.baselineEnd > windows.pilotStart)
    throw new Error('A linha de base deve terminar antes ou no inÃ­cio do piloto.');
  const targets = { response: {}, resolution: {} };
  for (const kind of ['response', 'resolution']) {
    for (const level of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
      const value = Number(input.targets?.[kind]?.[level]);
      if (!Number.isInteger(value) || value < 1 || value > 100000)
        throw new Error(`Informe a meta de ${kind === 'response' ? 'resposta' : 'resoluÃ§Ã£o'} para ${level}.`);
      targets[kind][level] = value;
    }
  }
  query(`INSERT INTO app_settings(key,value) VALUES('pilot_windows',${sqlValue(JSON.stringify(windows))}::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`);
  query(`INSERT INTO app_settings(key,value) VALUES('pilot_sla_targets',${sqlValue(JSON.stringify(targets))}::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`);
  return { windows, targets };
}
export function listIncidents() {
  return queryJson(
    `SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT i.code AS id,i.code,i.title,i.system,i.category,i.severity,i.status,i.detected_at AS "detectedAt",coalesce((SELECT json_agg(it.ticket_id) FROM incident_tickets it WHERE it.incident_code=i.code),'[]'::json) AS "ticketIds" FROM incidents i ORDER BY detected_at DESC) x`,
  );
}
export function bootstrap(user = null) {
  const requester = user?.role === 'solicitante';
  const tickets = requester ? listTickets(user.id) : listTickets(),
    incidents = requester ? [] : listIncidents(),
    events = queryJson(
      `SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT type,request_id AS "requestId",knowledge_article_id AS "articleId",created_at AS "createdAt" FROM service_events ${requester ? `WHERE request_id IN (SELECT id FROM requests WHERE created_by=${sqlValue(user.id)}::uuid)` : ''} ORDER BY created_at DESC) x`,
    ),
    articles = queryJson(
      `SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT id,title,category,system,problem,solution,steps FROM knowledge_articles WHERE active ORDER BY id) x`,
    );
  return { tickets, incidents, events, articles };
}
export function createIncidentFor(ticket) {
  const related = queryJson(
    `SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT id FROM tickets WHERE synthetic=false AND system=${sqlValue(ticket.system)} AND category=${sqlValue(ticket.category)} AND created_at>=now()-interval '15 minutes' ORDER BY created_at) x`,
  );
  if (related.length < 3) return null;
  let code = query(
    `SELECT i.code FROM incidents i WHERE i.system=${sqlValue(ticket.system)} AND i.status='INVESTIGATING' AND i.detected_at>=now()-interval '15 minutes' ORDER BY detected_at DESC LIMIT 1`,
  );
  if (!code) {
    code = `INC-${query("SELECT lpad((coalesce(max(substring(code from 5)::int),0)+1)::text,4,'0') FROM incidents")}`;
    query(
      `INSERT INTO incidents(code,title,system,category,severity) VALUES(${sqlValue(code)},${sqlValue(`Possível indisponibilidade do ${ticket.system}`)},${sqlValue(ticket.system)},${sqlValue(ticket.category)},${sqlValue(['HIGH', 'CRITICAL'].includes(ticket.priority) ? 'HIGH' : 'MEDIUM')})`,
    );
  }
  for (const x of related)
    query(
      `INSERT INTO incident_tickets(incident_code,ticket_id) VALUES(${sqlValue(code)},${sqlValue(x.id)}) ON CONFLICT DO NOTHING`,
    );
  query(
    `UPDATE tickets SET incident_code=${sqlValue(code)} WHERE id IN (${related.map((x) => sqlValue(x.id)).join(',')})`,
  );
  return code;
}
export function dashboard() {
  const counts = queryJson(
    `SELECT json_build_object('open',(SELECT count(*) FROM tickets WHERE status='OPEN'),'high',(SELECT count(*) FROM tickets WHERE status='OPEN' AND priority IN ('HIGH','CRITICAL')),'incidents',(SELECT count(*) FROM incidents WHERE status='INVESTIGATING'),'resolved',(SELECT count(*) FROM service_events WHERE type='SELF_SERVICE_RESOLVED'),'total',(SELECT count(*) FROM requests))`,
  );
  const recent = listTickets()
    .filter((t) => t.status === 'OPEN')
    .slice(0, 8);
  const locality = queryJson(`SELECT coalesce(json_agg(x),'[]'::json) FROM (
    SELECT r.locality,count(*)::int AS tickets FROM tickets t JOIN requests r ON r.id=t.request_id
    WHERE t.synthetic=false GROUP BY r.locality ORDER BY tickets DESC,r.locality) x`);
  return { ...counts, recent, incidentList: listIncidents(), locality };
}
export function qualitySummary() {
  const summary = queryJson(`SELECT json_build_object(
  'sampleCount',(SELECT count(*) FROM evaluation_cases),
  'analyzedCount',(SELECT count(*) FROM requests WHERE synthetic=false),
  'pendingReview',(SELECT count(*) FROM requests WHERE synthetic=false AND triage_status<>'READY' AND corrected_decision IS NULL),
  'correctionCount',(SELECT count(*) FROM requests WHERE synthetic=false AND corrected_decision IS NOT NULL),
  'approvedCaseCount',(SELECT count(*) FROM evaluation_cases),
  'agreements',(SELECT json_build_object(
    'category',json_build_object('agree',count(*) FILTER(WHERE decision->>'category'=corrected_decision->>'category'),'total',count(*)),
    'system',json_build_object('agree',count(*) FILTER(WHERE decision->>'system'=corrected_decision->>'system'),'total',count(*)),
    'impact',json_build_object('agree',count(*) FILTER(WHERE decision->>'impact'=corrected_decision->>'impact'),'total',count(*)),
    'urgency',json_build_object('agree',count(*) FILTER(WHERE decision->>'urgency'=corrected_decision->>'urgency'),'total',count(*)),
    'incident',json_build_object('agree',count(*) FILTER(WHERE decision->>'possibleIncident'=corrected_decision->>'possibleIncident'),'total',count(*))
  ) FROM requests WHERE synthetic=false AND corrected_decision IS NOT NULL),
  'corrections',(SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT r.id,r.description,r.decision AS original,r.corrected_decision AS corrected,r.corrected_at AS "correctedAt",r.correction_reason AS reason,(e.id IS NOT NULL) AS "evaluationCaseApproved" FROM requests r LEFT JOIN evaluation_cases e ON e.source_request_id=r.id WHERE r.synthetic=false AND r.corrected_decision IS NOT NULL ORDER BY r.corrected_at DESC LIMIT 30) x)
)`);
  summary.benchmarkCaseCount = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'evaluation', 'cases.json'), 'utf8'),
  ).length;
  return summary;
}
export function evaluationCases() {
  return queryJson(
    `SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT id,source_request_id AS "sourceRequestId",text,expected FROM evaluation_cases ORDER BY id) x`,
  );
}
export function getFeedbackEvaluationReport() {
  return queryJson(
    `SELECT value FROM app_settings WHERE key='feedback_evaluation_latest' LIMIT 1`,
    null,
  );
}
export function saveFeedbackEvaluationReport(report) {
  query(
    `INSERT INTO app_settings(key,value) VALUES('feedback_evaluation_latest',${sqlValue(JSON.stringify(report))}::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
  );
  return report;
}
export function redactEvaluationText(text) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ]')
    .replace(/\b\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, '[TELEFONE]')
    .trim();
}
