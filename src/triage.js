export const CATEGORIES = [
  'ACCESS',
  'SYSTEM',
  'NETWORK',
  'HARDWARE',
  'SOFTWARE',
  'PRINTING',
  'OTHER',
];
export const SYSTEMS = [
  'PJE',
  'SEI',
  'EMAIL',
  'INTERNET',
  'COMPUTER',
  'PRINTER',
  'OTHER',
  'UNKNOWN',
];
export const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export const TRIAGE_THRESHOLDS = Object.freeze({
  outOfScope: 0.35,
  inScope: 0.7,
  answerConfidence: 0.7,
});

export const decisionQuestions = Object.freeze({
  category: {
    type: 'choice',
    instructions:
      'Classifique a solicitação de suporte de TIC. Escolha a categoria que melhor descreve o problema.',
    criteria: {
      ACCESS: 'Autenticação, conta ou credenciais',
      SYSTEM: 'Sistema institucional, como PJe ou SEI',
      NETWORK: 'Internet, rede ou conectividade',
      HARDWARE: 'Computador ou equipamento físico',
      SOFTWARE: 'Aplicativo ou programa',
      PRINTING: 'Impressão ou fila de impressão',
      OTHER: 'Problema de TIC não identificado nas demais categorias',
    },
  },
  system: {
    type: 'choice',
    instructions:
      'Identifique o sistema ou equipamento mencionado. Se não houver menção clara, escolha UNKNOWN.',
    criteria: {
      PJE: 'Sistema PJe',
      SEI: 'Sistema SEI',
      EMAIL: 'Correio eletrônico',
      INTERNET: 'Internet ou rede',
      COMPUTER: 'Computador ou estação de trabalho',
      PRINTER: 'Impressora',
      OTHER: 'Outro sistema identificado',
      UNKNOWN: 'Não identificado',
    },
  },
  impact: {
    type: 'score',
    instructions: 'Avalie o impacto operacional da solicitação para a unidade a partir do texto.',
    criteria: [
      'LOW — afeta apenas uma tarefa, sem bloqueio relevante',
      'MEDIUM — causa atraso ou dificuldade, mas há alternativa de trabalho',
      'HIGH — bloqueia trabalho importante de uma pessoa ou setor',
      'CRITICAL — paralisa serviço essencial ou várias unidades',
    ],
  },
  urgency: {
    type: 'score',
    instructions: 'Avalie a urgência explícita ou implícita da solicitação.',
    criteria: [
      'LOW — pode aguardar sem consequência imediata',
      'MEDIUM — precisa ser tratado em breve, sem prazo iminente',
      'HIGH — prejudica atividade importante ou tem prazo próximo',
      'CRITICAL — exige ação imediata para evitar interrupção ou dano grave',
    ],
  },
  is_it_support: {
    type: 'noul',
    instructions:
      'A mensagem descreve um problema, solicitação ou dúvida de tecnologia da informação que deve ser atendida pelo suporte de TIC do Tribunal? Responda não para assuntos pessoais, jurídicos ou sem relação com tecnologia.',
  },
  possible_incident: {
    type: 'noul',
    instructions:
      'Há evidências explícitas de que o problema afeta várias pessoas, uma unidade ou um serviço compartilhado? Não conclua que é coletivo apenas porque um sistema institucional foi mencionado.',
  },
  human_required: {
    type: 'noul',
    instructions:
      'Esta solicitação provavelmente exige intervenção humana da equipe de suporte, em vez de poder ser resolvida somente por uma orientação de autoatendimento?',
  },
  outage: {
    type: 'noul',
    instructions:
      'O texto indica indisponibilidade total ou parcial de sistema, rede ou equipamento? Não infira indisponibilidade apenas por um erro de login individual.',
  },
});

const clamp = (value) =>
  Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

export function answerConfidence(answer, fallback = 0) {
  if (answer?.answer_confidence != null) return clamp(answer.answer_confidence);
  if (answer?.confidence != null) return clamp(answer.confidence);
  const probabilities = Object.values(answer?.probabilities || {})
    .map(Number)
    .filter(Number.isFinite);
  return probabilities.length ? clamp(Math.max(...probabilities)) : clamp(fallback);
}

export function mapScore(answer, defaultLevel = 'MEDIUM') {
  const score = Number(answer?.score);
  const index = Number.isFinite(score) ? Math.round(score) : LEVELS.indexOf(defaultLevel);
  if (index < 0 || index >= LEVELS.length)
    throw new Error(`Nível de score fora do intervalo esperado: ${answer?.score}`);
  return LEVELS[index];
}

export function calculatePriority(decision) {
  const impact = LEVELS.indexOf(decision.impact);
  const urgency = LEVELS.indexOf(decision.urgency);
  if (impact < 0 || urgency < 0) throw new Error('Impacto ou urgência inválidos.');
  return LEVELS[Math.max(impact, urgency)];
}

export function routeQueue(decision) {
  if (decision.system === 'PJE') return 'SUPORTE_PJE';
  if (decision.category === 'NETWORK' || decision.system === 'INTERNET') return 'SUPORTE_REDE';
  if (
    ['HARDWARE', 'PRINTING'].includes(decision.category) ||
    decision.system === 'PRINTER' ||
    decision.system === 'COMPUTER'
  )
    return 'SUPORTE_HARDWARE';
  if (['SYSTEM', 'SOFTWARE'].includes(decision.category)) return 'SUPORTE_SISTEMAS';
  return 'SUPORTE_GERAL';
}

export function triageStatus(scopeProbability, confidence) {
  const scope = clamp(scopeProbability);
  if (scope < TRIAGE_THRESHOLDS.outOfScope) return 'OUT_OF_SCOPE';
  if (scope < TRIAGE_THRESHOLDS.inScope || clamp(confidence) < TRIAGE_THRESHOLDS.answerConfidence)
    return 'NEEDS_REVIEW';
  return 'READY';
}

export function decisionFromAnswers(answers = {}) {
  const category = String(answers.category?.choice || '').toUpperCase();
  const system = String(answers.system?.choice || '').toUpperCase();
  if (!CATEGORIES.includes(category))
    throw new Error(`Categoria inválida retornada pelo classificador: ${category || '(vazia)'}`);
  if (!SYSTEMS.includes(system))
    throw new Error(`Sistema inválido retornado pelo classificador: ${system || '(vazio)'}`);

  const scopeProbability = clamp(answers.is_it_support?.noul);
  const categoryConfidence = answerConfidence(answers.category);
  const systemConfidence = answerConfidence(answers.system, categoryConfidence);
  const impactConfidence = answerConfidence(answers.impact);
  const urgencyConfidence = answerConfidence(answers.urgency);
  const confidence = Math.min(
    categoryConfidence,
    systemConfidence,
    impactConfidence,
    urgencyConfidence,
  );
  const yes = (answer) => clamp(answer?.noul) >= 0.5;

  return {
    category,
    system,
    impact: mapScore(answers.impact),
    urgency: mapScore(answers.urgency),
    isSupportRequest: scopeProbability >= 0.5,
    scopeProbability,
    scopeConfidence: Math.max(scopeProbability, 1 - scopeProbability),
    possibleIncident: yes(answers.possible_incident),
    humanRequired: yes(answers.human_required),
    outage: yes(answers.outage),
    confidence,
    categoryConfidence,
    systemConfidence,
    impactConfidence,
    urgencyConfidence,
    incidentConfidence: answerConfidence(answers.possible_incident),
    humanConfidence: answerConfidence(answers.human_required),
    outageConfidence: answerConfidence(answers.outage),
    jevUsage: null,
  };
}

const normalizePortuguese = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const has = (text, pattern) => pattern.test(text);

export function calibrateDecision(description, input) {
  const text = normalizePortuguese(description);
  const decision = { ...input };
  const techSignals =
    /\b(pje|sei|sistema|aplicativo|software|computador|notebook|desktop|pc|estacao de trabalho|impressora|imprimir|impressao|internet|wifi|wi-fi|rede|conexao|senha|login|autenticacao|e-mail|email|correio eletronico|navegador|vpn|teclado|mouse|monitor|scanner|certificado digital)\b/;
  const legalSignals =
    /\b(advogado|prazo|recurso|peticao|processo judicial|processo|audiencia|sentenca|custas|juiz|decisao judicial|orientacao juridica|intimacao|comarca)\b/;
  const technical = has(text, techSignals);
  const outOfScope = !technical && has(text, legalSignals);
  if (technical) {
    decision.isSupportRequest = true;
    decision.scopeProbability = 0.99;
    decision.scopeConfidence = 0.99;
  } else if (outOfScope) {
    decision.isSupportRequest = false;
    decision.scopeProbability = 0.01;
    decision.scopeConfidence = 0.99;
  }

  const printer = /\b(impressora|imprimir|impressao|toner|fila de impressao)\b/;
  const network = /\b(internet|wifi|wi-fi|rede|conexao|sem sinal|roteador)\b/;
  const email = /\b(e-mail|email|correio eletronico|outlook)\b/;
  const computerFault =
    /\b(computador|notebook|desktop|pc|estacao de trabalho)\b.{0,35}\b(nao liga|nao inicia|travou|desliga|tela azul|muito lento|quebrou)\b|\b(nao liga|nao inicia|travou|desliga|tela azul)\b.{0,35}\b(computador|notebook|desktop|pc)\b/;
  const credentials =
    /\b(senha|autenticacao|credencial|conta bloqueada|redefinir senha|nao consigo entrar|nao consigo acessar|nao estou conseguindo acessar|estou conseguindo acessar|falha ao acessar|falha de acesso|nao autentica|login nao autentica|login nao entra|login.{0,25}bloqueado)\b/;
  const systemMatch = text.match(/\b(pje|sei)\b/);
  if (has(text, printer)) {
    decision.category = 'PRINTING';
    decision.system = 'PRINTER';
  } else if (has(text, network)) {
    decision.category = 'NETWORK';
    decision.system = 'INTERNET';
  } else if (has(text, computerFault)) {
    decision.category = 'HARDWARE';
    decision.system = 'COMPUTER';
  } else if (has(text, email)) {
    decision.category = 'SYSTEM';
    decision.system = 'EMAIL';
  } else if (systemMatch) {
    decision.system = systemMatch[1].toUpperCase();
    decision.category = has(text, credentials) ? 'ACCESS' : 'SYSTEM';
  } else if (has(text, credentials)) {
    decision.category = 'ACCESS';
    if (!SYSTEMS.includes(decision.system) || decision.system === 'UNKNOWN')
      decision.system = 'OTHER';
  }

  const collective =
    /\b(varias pessoas|varios usuarios|varios computadores|todos os usuarios|todos usuarios|toda a unidade|unidade inteira|todo o setor|setor inteiro|ninguem consegue|todos sem acesso|colegas tambem|mais de uma pessoa|a equipe inteira|servico compartilhado)\b/;
  const collectiveEvidence = technical && has(text, collective);
  decision.possibleIncident = collectiveEvidence;
  if (collectiveEvidence) {
    decision.incidentConfidence = Math.max(Number(decision.incidentConfidence) || 0, 0.9);
    if (LEVELS.indexOf(decision.impact) < LEVELS.indexOf('HIGH')) decision.impact = 'HIGH';
  }

  const outageSignal = /\b(indisponivel|fora do ar|caiu|sem conexao|servico interrompido)\b/;
  decision.outage =
    technical &&
    has(text, outageSignal) &&
    (!/\b(somente para mim|apenas eu|so para mim)\b/.test(text) || collectiveEvidence);
  if (decision.outage)
    decision.outageConfidence = Math.max(Number(decision.outageConfidence) || 0, 0.85);

  if (outOfScope) decision.category = 'OTHER';
  return decision;
}

export function statusForDescription(description, decision) {
  const text = normalizePortuguese(description);
  const hasTechnicalDetail =
    /\b(pje|sei|impressora|imprimir|internet|wifi|rede|computador|notebook|senha|login|email|e-mail|sistema)\b/.test(
      text,
    );
  const vague =
    /\b(nao funciona|nao esta funcionando|preciso de ajuda|esta com problema)\b/.test(text) &&
    !hasTechnicalDetail;
  return vague ? 'NEEDS_REVIEW' : triageStatus(decision.scopeProbability, decision.confidence);
}

export function validateHumanDecision(input = {}) {
  const category = String(input.category || '').toUpperCase();
  const system = String(input.system || '').toUpperCase();
  const impact = String(input.impact || '').toUpperCase();
  const urgency = String(input.urgency || '').toUpperCase();
  if (!CATEGORIES.includes(category)) throw new Error('Selecione uma categoria válida.');
  if (!SYSTEMS.includes(system)) throw new Error('Selecione um sistema válido.');
  if (!LEVELS.includes(impact) || !LEVELS.includes(urgency))
    throw new Error('Selecione um impacto e uma urgência válidos.');
  return {
    category,
    system,
    impact,
    urgency,
    isSupportRequest: true,
    possibleIncident: input.possibleIncident === true,
    humanRequired: input.humanRequired !== false,
    outage: input.outage === true,
    confidence: null,
    categoryConfidence: null,
    systemConfidence: null,
    impactConfidence: null,
    urgencyConfidence: null,
    incidentConfidence: null,
    humanConfidence: null,
    outageConfidence: null,
    scopeConfidence: null,
    scopeProbability: 1,
    jevUsage: null,
    correctedByHuman: true,
  };
}

export function assessDecision(decision) {
  const status = triageStatus(decision.scopeProbability, decision.confidence);
  return { triageStatus: status, review: status !== 'READY' };
}

export function applyAutomationGate(result, approved = false) {
  if (approved || result.triageStatus !== 'READY') return result;
  return {
    ...result,
    triageStatus: 'NEEDS_REVIEW',
    review: true,
    automationGate: 'BENCHMARK_NOT_APPROVED',
  };
}

export function fallbackClassification(text) {
  const value = text.toLowerCase();
  const rules = [
    [/pje|processo judicial/, 'SYSTEM', 'PJE', 0.92],
    [/impressor|imprimir|impressão/, 'PRINTING', 'PRINTER', 0.92],
    [/internet|rede|wi-?fi|conexão/, 'NETWORK', 'INTERNET', 0.9],
    [/computador|notebook|estação|não liga/, 'HARDWARE', 'COMPUTER', 0.88],
    [/senha|login|acessar|acesso|autenticação/, 'ACCESS', 'UNKNOWN', 0.82],
    [/e-?mail|correio eletrônico/, 'SYSTEM', 'EMAIL', 0.9],
  ];
  const matched = rules.find(([pattern]) => pattern.test(value));
  let category = matched?.[1] || 'OTHER';
  const system = matched?.[2] || 'UNKNOWN';
  let confidence = matched?.[3] || 0.4;
  let impact = 'LOW';
  let urgency = 'LOW';
  const collective =
    /\b(varias pessoas|varios usuarios|varios computadores|todos os usuarios|todos usuarios|toda a unidade|unidade inteira|todo o setor|setor inteiro|ninguem consegue|todos sem acesso|colegas tambem|mais de uma pessoa|a equipe inteira|servico compartilhado)\b/;
  if (collective) {
    impact = 'HIGH';
    urgency = 'HIGH';
    confidence = Math.min(0.98, confidence + 0.04);
  } else if (/urgente|prazo|audiência|hoje|desde esta manhã/.test(value)) urgency = 'MEDIUM';
  const scopeProbability = matched ? 0.94 : 0.12;
  const decision = {
    category,
    system,
    impact,
    urgency,
    isSupportRequest: Boolean(matched),
    scopeProbability,
    scopeConfidence: Math.max(scopeProbability, 1 - scopeProbability),
    possibleIncident: collective,
    humanRequired: Boolean(matched),
    outage: collective && /indisponível|parou tudo|não conseguem acessar/.test(value),
    confidence,
    categoryConfidence: confidence,
    systemConfidence: matched ? confidence : 0.4,
    impactConfidence: confidence,
    urgencyConfidence: confidence,
    incidentConfidence: confidence,
    humanConfidence: confidence,
    outageConfidence: confidence,
    jevUsage: null,
  };
  return { decision, provider: 'local_rules', ...assessDecision(decision) };
}

export function evaluationRequest(description, model = 'multilingual', questions = decisionQuestions) {
  return { model, state: { support_request: description }, questions };
}
