const apiBase =
  window.JUDICIA_API_BASE ??
  (window.location.port === '5173'
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : '');
let csrfToken = '';

window.judiciaSetCsrfToken = (token) => {
  csrfToken = typeof token === 'string' ? token : '';
};

async function api(path, options = {}) {
  let response;
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers,
  };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken)
    headers['X-CSRF-Token'] = csrfToken;

  try {
    response = await fetch(`${apiBase}${path}`, {
      ...options,
      credentials: 'include',
      headers,
    });
  } catch {
    throw new Error('Não foi possível conectar à API. Verifique se o backend está ativo.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Falha na API (${response.status})`);
    error.status = response.status;
    if (response.status === 401 && !['/api/auth/login', '/api/auth/me'].includes(path))
      window.dispatchEvent(new Event('judicia:unauthorized'));
    throw error;
  }

  return data;
}

window.judiciaApi = api;
