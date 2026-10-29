// Validacao do desconto de cupom no ASAAS SANDBOX (30/10/2026). Nao usa banco nem dados de alunos: cria um cliente de teste e uma assinatura de teste NO SANDBOX, confere o valor, tenta
// atualizar o valor (o ponto que a documentacao oficial deixa em duvida) e apaga tudo no fim. Recusa rodar contra producao.
//
// Uso (PowerShell, na pasta apps/api):
//   $env:ASAAS_API_KEY = "<chave do SANDBOX>"; node scripts/asaas-sandbox-check.cjs
const BASE = 'https://sandbox.asaas.com/api/v3';
const key = process.env.ASAAS_API_KEY;
if (!key) { console.error('Defina ASAAS_API_KEY (chave do SANDBOX).'); process.exit(1); }
if (!/hmlg/i.test(key)) { console.error('Esta chave nao parece ser do SANDBOX (chaves de teste contem "hmlg"). Abortando por seguranca.'); process.exit(1); }

const results = [];
const note = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK   ' : 'FALHA'} ${name}${detail ? ' | ' + detail : ''}`); };
async function call(path, method = 'GET', body) {
  const response = await fetch(BASE + path, { method, headers: { access_token: key, 'Content-Type': 'application/json', 'User-Agent': 'panzeri-run-sandbox-check' }, body: body ? JSON.stringify(body) : undefined });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}
const dueDate = () => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

(async () => {
  let customerId; let subscriptionId;
  try {
    const customer = await call('/customers', 'POST', { name: 'Teste Cupom Panzeri (sandbox)', cpfCnpj: '24971563792', email: 'teste-cupom@example.com' });
    customerId = customer.json.id;
    note('cria cliente de teste', customer.status === 200 && Boolean(customerId), `status ${customer.status}`);
    if (!customerId) throw new Error(JSON.stringify(customer.json).slice(0, 300));

    // 1) assinatura criada JA com valor com desconto (19,90 - 50% = 9,95)
    const created = await call('/subscriptions', 'POST', { customer: customerId, billingType: 'CREDIT_CARD', value: 9.95, nextDueDate: dueDate(), cycle: 'MONTHLY', description: 'Teste de cupom (sandbox)' });
    subscriptionId = created.json.id;
    note('cria assinatura com valor com desconto', created.status === 200 && created.json.value === 9.95, `status ${created.status}, value devolvido: ${created.json.value}`);
    if (!subscriptionId) throw new Error(JSON.stringify(created.json).slice(0, 300));

    // 2) o valor relido (GET) confere
    const read = await call(`/subscriptions/${subscriptionId}`);
    note('GET devolve o mesmo valor', read.json.value === 9.95, `value: ${read.json.value}`);

    // 3) o PRIMEIRO pagamento gerado tem o valor com desconto (e e' so' cartao)
    let payments = { json: { data: [] } };
    for (let attempt = 0; attempt < 5 && !(payments.json.data || []).length; attempt += 1) { if (attempt) await new Promise((r) => setTimeout(r, 2500)); payments = await call(`/payments?subscription=${subscriptionId}`); }
    const first = (payments.json.data || [])[0];
    note('primeira cobranca gerada com o valor com desconto', Boolean(first) && first.value === 9.95, first ? `value: ${first.value}, billingType: ${first.billingType}` : 'nenhuma cobranca gerada');
    if (first) note('cobranca so aceita cartao de credito', first.billingType === 'CREDIT_CARD', `billingType: ${first.billingType}`);

    // 4) o ponto em duvida: PUT com value (+ updatePendingPayments) realmente muda o valor?
    const updated = await call(`/subscriptions/${subscriptionId}`, 'PUT', { value: 14.9, updatePendingPayments: true });
    const reread = await call(`/subscriptions/${subscriptionId}`);
    note('PUT com value altera o valor da assinatura (ponto em duvida da documentacao)', updated.status === 200 && reread.json.value === 14.9, `PUT status ${updated.status}; value apos PUT: ${reread.json.value}`);
    const repayments = await call(`/payments?subscription=${subscriptionId}`);
    const pending = (repayments.json.data || []).find((p) => ['PENDING', 'OVERDUE'].includes(p.status));
    if (pending) note('PUT com updatePendingPayments altera a cobranca pendente', pending.value === 14.9, `value da cobranca pendente: ${pending.value}`);
  } catch (error) {
    note('execucao', false, String(error.message || error).slice(0, 300));
  } finally {
    if (subscriptionId) { const del = await call(`/subscriptions/${subscriptionId}`, 'DELETE'); console.log(`limpeza: assinatura de teste removida (status ${del.status})`); }
    if (customerId) { const del = await call(`/customers/${customerId}`, 'DELETE'); console.log(`limpeza: cliente de teste removido (status ${del.status})`); }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed === 0 ? '\nRESULTADO: todas as verificacoes passaram.' : `\nRESULTADO: ${failed} verificacao(oes) falharam. Copie a saida acima e envie.`);
})();
