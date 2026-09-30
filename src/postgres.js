import { spawnSync } from 'node:child_process';
import { databaseConfig } from './config.js';

export function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function query(sql) {
  const result = spawnSync(
    databaseConfig.executable,
    [
      '-X',
      '-q',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      databaseConfig.host,
      '-p',
      databaseConfig.port,
      '-U',
      databaseConfig.user,
      '-d',
      databaseConfig.database,
    ],
    {
      input: `${sql}\n`,
      encoding: 'utf8',
      env: {
        ...process.env,
        PGPASSWORD: databaseConfig.password,
        PGCLIENTENCODING: 'UTF8',
      },
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    },
  );

  if (result.error) {
    throw new Error(`Não foi possível executar o psql: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || 'Falha na consulta PostgreSQL.').trim());
  }
  return result.stdout.trim();
}

export function queryJson(sql, fallback = []) {
  const output = query(sql);
  if (!output) return fallback;

  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Resposta inválida do PostgreSQL: ${output.slice(0, 250)}`);
  }
}
