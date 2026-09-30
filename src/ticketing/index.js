import { ticketingProvider } from '../config.js';
import { validateTicketingAdapter } from './contract.js';
import { createMockTicketingAdapter } from './mock-adapter.js';
import { createGlpiV2Adapter } from './glpi-v2-adapter.js';

const adapterFactories = new Map([
  ['mock', createMockTicketingAdapter],
  ['glpi', createGlpiV2Adapter],
]);
const createAdapter = adapterFactories.get(ticketingProvider);

if (!createAdapter) {
  throw new Error(
    `Provedor de chamados "${ticketingProvider}" não está implementado. Use TICKETING_PROVIDER=mock até configurar um conector real.`,
  );
}

export const ticketingAdapter = validateTicketingAdapter(createAdapter());
