# JUDICI.A — MVP conectado

Aplicação web demonstrativa para triagem e autoatendimento, com interface separada da API Node.js, persistência PostgreSQL e integração opcional com Laya ou Jev.

## Executar localmente no Windows

1. Instale Node.js 20+ e PostgreSQL 16. A API acessa o banco pelo executável `psql`.
2. Crie o banco `judicia_a` e um usuário com permissão para criar tabelas no schema `public`.
3. Copie `.env.example` para `.env` e configure as credenciais do PostgreSQL e o provedor de decisões.
4. Em um terminal, inicie a API: `npm run dev:backend` (porta 3000).
5. Em outro terminal, inicie a interface: `npm run dev:frontend` (porta 5173).
6. Abra `http://localhost:5173`. A interface chama a API em `http://localhost:3000`.

## Contas e perfis de acesso

O sistema não possui cadastro público. Depois de iniciar a API pela primeira vez (para criar as tabelas), abra outro terminal na pasta do projeto e execute `npm run users -- create`. Informe e-mail, nome, perfil (`solicitante`, `tic` ou `gestor`) e uma senha com pelo menos 12 caracteres. Crie a primeira conta com perfil `gestor`; depois, use o mesmo comando para cadastrar as demais pessoas. As senhas são armazenadas como derivados `scrypt`, e a aplicação usa sessões no servidor em cookies `HttpOnly`.

- **Solicitante:** atendimento, autoatendimento e consulta/avaliação dos próprios chamados.
- **Equipe de TIC (`tic`):** atendimento completo, triagem, qualidade, incidentes e configuração das integrações e do piloto.
- **Gestor (`gestor`):** painéis, chamados e incidentes para acompanhamento, além de leitura das metas do piloto.

Administre contas pelo terminal: `npm run users -- reset-password email@instituicao.gov.br` redefine a senha e encerra sessões; `npm run users -- set-role email@instituicao.gov.br tic` troca o perfil e encerra sessões. Não existe recuperação de senha pela interface. Em implantação HTTPS, configure `SESSION_COOKIE_SECURE=true` no `.env`; mantenha `FRONTEND_ORIGINS` limitado aos endereços da interface. Esta autenticação local não integra diretório institucional nem substitui SSO.

Para usar Laya local, instale e inicie o servidor Laya em `127.0.0.1:8000` conforme as instruções do projeto Laya. Na primeira análise, o modelo poderá ser baixado do Hugging Face. Sem provedor configurado, a API usa o classificador local demonstrativo.

`FRONTEND_ORIGINS` controla as origens permitidas pelo CORS. Ajuste essa variável se a interface estiver em outra origem.

## Estrutura

```text
public/                 Interface web
  js/api.js             Cliente HTTP do navegador
  app.js                Renderização e interações da interface
  index.html
  styles.css
src/
  api.js                 Rotas HTTP e validação das solicitações
  config.js             Ambiente, portas e configuração do banco
  decision-provider.js  Integração com Laya/Jev e fallback local
  ticketing/            Contrato e adaptador simulado do sistema de chamados
  postgres.js           Consultas PostgreSQL e conversão JSON
  repository.js         Schema, inicialização e operações de persistência
  server.js             Rotas HTTP e orquestração da API
  triage.js              Regras puras de classificação e decisão
scripts/                Servidor estático de desenvolvimento e harness
evaluation/             Casos rotulados e metadados de validação
```

## Fluxo e endpoints

- `POST /api/requests/analyze` classifica uma descrição, calcula confiança e aplica a revisão humana obrigatória conforme as regras atuais.
- `POST /api/requests/:id/correction` salva correção humana sem sobrescrever a decisão original.
- `POST /api/requests/:id/resolve` registra autoatendimento; `POST /api/tickets` cria um chamado.
- `GET /api/health`, `/api/bootstrap`, `/api/dashboard` e `/api/quality` alimentam estado e indicadores da interface.
- `GET /api/tickets`, `/api/tickets/:id`, `/api/tickets/:id/status`, `/api/incidents`, `/api/incidents/:id` e `/api/knowledge/search` consultam chamados, status, incidentes e artigos.
- O conector selecionado por `TICKETING_PROVIDER` é `mock` por padrão. Para GLPI 11, configure as variáveis `GLPI_*` do `.env.example` e selecione `TICKETING_PROVIDER=glpi`. A integração usa a API v2 e exige um cliente OAuth2 e uma conta de serviço com permissões de leitura da base de conhecimento e criação/leitura de chamados. O campo `GLPI_API_BASE_URL` deve apontar para a raiz da API fornecida pela instância; consulte `/doc.json` nessa raiz para conferir os recursos publicados.
- `GET /api/ticketing/health` verifica autenticação e disponibilidade da documentação da API. A busca consulta artigos relevantes em `Knowledgebase/Article` no GLPI v2. `npm run seed:glpi-knowledge` cadastra artigos iniciais sem duplicar títulos existentes. A criação envia chamados a `Assistance/Ticket` e salva uma cópia local. Sem `TICKETING_PROVIDER=glpi`, nenhuma chamada externa é feita.
- Antes de habilitar em produção, valide na documentação da sua instância os campos obrigatórios de `Ticket`, os direitos do usuário OAuth e a forma como o GLPI associa o solicitante. O protótipo usa a conta OAuth para registrar a criação; ainda não mapeia cada usuário do JUDICI.A para uma identidade GLPI. Sem URL e credenciais de uma instância, a integração não foi validada ao vivo.
- O roteamento pode enviar uma categoria GLPI por fila configurando `GLPI_QUEUE_CATEGORY_IDS=SUPORTE_PJE:12,SUPORTE_REDE:13` (use os IDs da sua instância) na tela **Integração GLPI**. Configure também regras de atribuição por categoria no GLPI; enviar a categoria não confirma que um grupo foi atribuído. O JUDICI.A continua exibindo a fila sugerida até a instância confirmar a atribuição.
- A tela **Piloto e SLAs** permite definir períodos, metas por prioridade, sincronizar até 50 chamados GLPI abertos por execução e acompanhar tempo até a primeira atribuição observada, resolução e satisfação por comarca. A sincronização registra apenas o momento em que o JUDICI.A observou cada status; não reconstrói eventos históricos do GLPI. Importe e valide a linha de base antes de usar a comparação como evidência do edital.

## Avaliar a triagem

Com a API e o serviço de decisão ativo, execute `npm run evaluate:classifier`. Os casos ficam em `evaluation/cases.json`. Amplie o conjunto com exemplos anonimizados e revisados por especialistas antes de alterar limiares ou considerar uso operacional.

Na interface, **Configuração da triagem** permite ajustar instruções e descrições dos critérios e pré-visualizar os rótulos usando casos do benchmark. Para exigir uma chave nas operações de salvar configuração e executar prévias, defina `TRIAGE_SETTINGS_KEY` no `.env` e reinicie a API. O segredo é enviado pelo cabeçalho `Authorization: Bearer` e não é armazenado pelo navegador. Sem essa variável, essas operações ficam abertas; mantenha a API em ambiente local controlado.

As correções humanas podem ser aprovadas como exemplos pela tela **Qualidade**. Revise e anonimize o texto antes de aprová-lo. Use **Avaliar feedback** nessa tela para classificar os exemplos ainda não avaliados com o provedor configurado e consultar a concordância por campo e as divergências. Cada caso avaliado com sucesso é preservado e não é executado de novo; alterações no texto ou nos rótulos criam uma nova versão para avaliação. Essa avaliação fica separada do benchmark-base e não altera o modelo. A exportação JSON e `npm run evaluate:classifier` continuam disponíveis para avaliação local por CLI; para esse script, copie o JSON exportado para `evaluation/feedback.local.json`.

A automação permanece desativada por padrão (`TRIAGE_AUTOMATION_APPROVED=false`). Os casos atuais exercitam regras do protótipo e não substituem uma validação independente por especialistas. Prioridade e detecção de incidentes são parâmetros experimentais; nenhum sistema real do Tribunal é contatado.
# JUDICI.A
