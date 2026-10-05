/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { decryptFile, parseBackupKey } from './backup-crypto';
import { postRestoreSafeguard, restoreBackupFile } from './backup-restore';
import { redactSecrets, secretsFromDatabaseUrl } from './backup-sanitize';
import { BACKUP_PREFIX } from './backup.service';
import { R2Client } from './r2-client';

// CLI de restauracao (05/10/2026) — ver RUNBOOKS/2026-10-05-BACKUP-RESTORE.md.
//   node dist/backup/cli.js list
//   node dist/backup/cli.js download --key <objeto> --out <arquivo.dump>
//   node dist/backup/cli.js decrypt  --in <arquivo.dump.enc> --out <arquivo.dump>
//   node dist/backup/cli.js restore  --dump <arquivo.dump> --yes        (pg_restore + pos-restauracao, sempre juntos)
//   node dist/backup/cli.js post-restore --yes                          (idempotente; so' a etapa pos-restauracao)
// O banco de DESTINO vem de TARGET_DATABASE_URL (nome diferente de DATABASE_URL de proposito, para nao
// restaurar em producao por engano). Nunca imprime URL, senha ou chave.

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const need = (name: string, value: string | undefined) => { if (!value) throw new Error(`Informe --${name}.`); return value; };
const env = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Variavel ${name} ausente.`); return value; };

function r2FromEnv() {
  return new R2Client({
    accountId: env('R2_ACCOUNT_ID'), bucket: env('R2_BUCKET'),
    accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  });
}

async function main() {
  const command = process.argv[2];
  switch (command) {
    case 'list': {
      const objects = (await r2FromEnv().listObjects(BACKUP_PREFIX)).sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
      for (const o of objects) console.log(`${o.lastModified.toISOString()}  ${String(o.size).padStart(12)}  ${o.key}`);
      console.log(`${objects.length} backup(s).`);
      return;
    }
    case 'download': {
      const key = need('key', arg('key'));
      const out = need('out', arg('out'));
      if (!key.startsWith(BACKUP_PREFIX)) throw new Error('Objeto fora do prefixo de backups.');
      const encPath = `${out}.enc`;
      await r2FromEnv().getObjectToFile(key, encPath);
      await decryptFile(encPath, out, parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY));
      console.log(`Backup baixado e descriptografado em ${out} (o arquivo cifrado ficou em ${encPath}; apague ambos apos o uso).`);
      return;
    }
    case 'decrypt': {
      await decryptFile(need('in', arg('in')), need('out', arg('out')), parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY));
      console.log('Descriptografado.');
      return;
    }
    case 'restore':
    case 'post-restore': {
      if (!flag('yes')) throw new Error('Esta operacao SUBSTITUI/ALTERA o banco de destino (TARGET_DATABASE_URL). Repita com --yes para confirmar.');
      const target = env('TARGET_DATABASE_URL');
      if (process.env.DATABASE_URL && target === process.env.DATABASE_URL) {
        throw new Error('TARGET_DATABASE_URL e igual a DATABASE_URL (provavelmente producao). Recusado.');
      }
      const prisma = new PrismaClient({ datasources: { db: { url: target } } });
      try {
        if (command === 'restore') {
          const result = await restoreBackupFile({ dumpPath: need('dump', arg('dump')), targetDatabaseUrl: target, prisma: prisma as never });
          console.log('Restauracao concluida.', JSON.stringify(result));
        } else {
          console.log('Etapa pos-restauracao concluida.', JSON.stringify(await postRestoreSafeguard(prisma as never)));
        }
      } finally {
        await prisma.$disconnect();
      }
      return;
    }
    default:
      throw new Error('Comando desconhecido. Use: list | download | decrypt | restore | post-restore.');
  }
}

if (require.main === module) {
  main().catch((error) => {
    const secrets = [
      ...secretsFromDatabaseUrl(process.env.TARGET_DATABASE_URL), ...secretsFromDatabaseUrl(process.env.DATABASE_URL),
      process.env.BACKUP_ENCRYPTION_KEY, process.env.R2_SECRET_ACCESS_KEY, process.env.R2_ACCESS_KEY_ID,
    ];
    console.error(`Erro: ${redactSecrets(error, secrets)}`);
    process.exit(1);
  });
}
