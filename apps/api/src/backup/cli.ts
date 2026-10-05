/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { readFile, writeFile } from 'fs/promises';
import { ProviderDataDeletionService } from '../activity-execution/provider-data-deletion.service';
import { decryptFile, parseBackupKey } from './backup-crypto';
import { applyTombstones, postRestoreSafeguard, restoreBackupFile } from './backup-restore';
import { redactSecrets, secretsFromDatabaseUrl } from './backup-sanitize';
import { BACKUP_PREFIX } from './backup.service';
import { R2Client } from './r2-client';
import { Tombstone, TombstoneLedger } from './tombstone-ledger';

// CLI de restauracao (05/10/2026) — ver RUNBOOKS/2026-10-05-BACKUP-RESTORE.md.
//   node dist/backup/cli.js list
//   node dist/backup/cli.js download --key <objeto> --out <arquivo.dump>    (gera tambem <arquivo.dump>.snapshot.json)
//   node dist/backup/cli.js decrypt  --in <arquivo.dump.enc> --out <arquivo.dump>
//   node dist/backup/cli.js restore  --dump <arquivo.dump> --yes
//        = pg_restore -> fail-closed das integracoes -> carrega tombstones -> reaplica exclusoes posteriores ao snapshot
//   node dist/backup/cli.js apply-tombstones --dump <arquivo.dump> --yes    (idempotente; retoma a reconciliacao)
//   node dist/backup/cli.js post-restore --yes                              (idempotente; so' o fail-closed)
// O banco de DESTINO vem de TARGET_DATABASE_URL (nome diferente de DATABASE_URL de proposito). Nunca imprime URL,
// senha ou chave. Codigo de saida 2 = restauracao NAO concluida (reconciliacao de exclusoes pendente).

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

// Ledger a partir do ambiente (sem Nest): mesma classe de producao, sem alerta de Telegram.
function ledgerFromEnv() {
  const config = { get: (name: string) => process.env[name] };
  return new TombstoneLedger(config as never, { notifyCoach: async () => undefined } as never);
}

// Data real do snapshot: metadado `created` gravado pelo backup no R2 (inicio do pg_dump), salvo ao lado do
// dump no download. Sem sidecar, so' com --snapshot-at explicito (nunca inferida de texto arbitrario).
async function snapshotStartedAt(dumpPath: string | undefined): Promise<Date> {
  const explicit = arg('snapshot-at');
  const raw = explicit ?? (dumpPath ? JSON.parse(await readFile(`${dumpPath}.snapshot.json`, 'utf8').catch(() => 'null'))?.created : undefined);
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new Error('Data do snapshot desconhecida: use o arquivo baixado pelo comando download (gera <dump>.snapshot.json) ou informe --snapshot-at <ISO>.');
  }
  return date;
}

function reportPending(tombstones: { error?: string; unsupported: number }) {
  console.error('RESTAURACAO NAO CONCLUIDA: a reconciliacao das exclusoes posteriores ao snapshot esta PENDENTE.');
  console.error('O banco permanece em estado fail-closed (integracoes desconectadas). Nao libere o sistema para os alunos.');
  console.error(`Motivo: ${tombstones.error ?? 'ledger indisponivel'}. Quando o R2 estiver disponivel, rode: apply-tombstones --dump <arquivo> --yes`);
  process.exitCode = 2;
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
      const client = r2FromEnv();
      const head = await client.headObject(key);
      if (!head) throw new Error('Backup nao encontrado.');
      const encPath = `${out}.enc`;
      await client.getObjectToFile(key, encPath);
      await decryptFile(encPath, out, parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY));
      const created = head.metadata.created ?? null;
      await writeFile(`${out}.snapshot.json`, JSON.stringify({ key, created }), 'utf8');
      console.log(`Backup baixado e descriptografado em ${out} (cifrado em ${encPath}; apague ambos apos o uso).`);
      console.log(created ? `Data do snapshot: ${created}` : 'ATENCAO: o objeto nao traz a data do snapshot; informe --snapshot-at na restauracao.');
      return;
    }
    case 'decrypt': {
      await decryptFile(need('in', arg('in')), need('out', arg('out')), parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY));
      console.log('Descriptografado.');
      return;
    }
    case 'restore':
    case 'apply-tombstones':
    case 'post-restore': {
      if (!flag('yes')) throw new Error('Esta operacao ALTERA o banco de destino (TARGET_DATABASE_URL). Repita com --yes para confirmar.');
      const target = env('TARGET_DATABASE_URL');
      if (process.env.DATABASE_URL && target === process.env.DATABASE_URL) {
        throw new Error('TARGET_DATABASE_URL e igual a DATABASE_URL (provavelmente producao). Recusado.');
      }
      const prisma = new PrismaClient({ datasources: { db: { url: target } } });
      const deletion = new ProviderDataDeletionService(prisma as never); // sem ledger: reaplicacao nao grava novo tombstone
      const ledger = ledgerFromEnv();
      const deleteProviderData = (userId: string, provider: string) => deletion.executeProviderDataDeletion(userId, provider);
      const loadTombstones = (): Promise<Tombstone[]> => ledger.loadAll();
      try {
        if (command === 'restore') {
          const outcome = await restoreBackupFile({
            dumpPath: need('dump', arg('dump')), targetDatabaseUrl: target, prisma: prisma as never,
            snapshotStartedAt: await snapshotStartedAt(arg('dump')), loadTombstones, deleteProviderData,
          });
          console.log('Resultado:', JSON.stringify(outcome));
          if (outcome.complete) console.log('Restauracao concluida (fail-closed aplicado e exclusoes posteriores reaplicadas).');
          else reportPending(outcome.tombstones);
        } else if (command === 'apply-tombstones') {
          const result = await applyTombstones({ snapshotStartedAt: await snapshotStartedAt(arg('dump')), load: loadTombstones, deleteProviderData });
          console.log('Resultado:', JSON.stringify(result));
          if (result.status === 'applied') console.log('Reconciliacao concluida.'); else reportPending(result);
        } else {
          console.log('Etapa pos-restauracao concluida.', JSON.stringify(await postRestoreSafeguard(prisma as never)));
        }
      } finally {
        await prisma.$disconnect();
      }
      return;
    }
    default:
      throw new Error('Comando desconhecido. Use: list | download | decrypt | restore | apply-tombstones | post-restore.');
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
