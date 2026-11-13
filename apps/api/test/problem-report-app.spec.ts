import * as fs from 'fs';
import * as path from 'path';
import { PROBLEM_IMAGE_ATTEMPTS, PROBLEM_IMAGE_MAX_BYTES, PROBLEM_TYPE_OPTIONS, base64Bytes, buildDeviceInfo, canSubmitReport, submitFeedbackText } from '../../mobile/src/problemReport/problemReportLogic';
import { PROBLEM_IMAGE_MAX_BYTES as SERVER_MAX, PROBLEM_MAX_IMAGES as SERVER_MAX_IMAGES, PROBLEM_TYPES } from '../src/problem-reports/problem-reports.service';
import { PROBLEM_MAX_IMAGES } from '../../mobile/src/problemReport/problemReportLogic';

// "Relatar problema" no app (13/11/2026): logica pura EXECUTADA + ligacao do menu. O aplicativo e o servidor precisam concordar nos limites e nos tipos.
const read = (relative: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', relative), 'utf8');

describe('Relatar problema (app)', () => {
  it('app e servidor concordam: tipos, numero de imagens e limite de tamanho com folga', () => {
    expect(PROBLEM_TYPE_OPTIONS.map((o) => o.id).sort()).toEqual([...PROBLEM_TYPES].sort());
    expect(PROBLEM_MAX_IMAGES).toBe(SERVER_MAX_IMAGES);
    expect(PROBLEM_IMAGE_MAX_BYTES).toBeLessThan(SERVER_MAX);
    // 70 KB de JPEG em base64 + o envelope JSON cabem no limite padrao de 100 KB do corpo
    expect(Math.ceil((SERVER_MAX * 4) / 3) + 64).toBeLessThan(100 * 1024);
  });

  it('so envia com tipo escolhido e descricao entre 5 e 2000 caracteres, e nunca durante um envio', () => {
    expect(canSubmitReport(null, 'texto valido', false)).toBe(false);
    expect(canSubmitReport('error', '   ab ', false)).toBe(false);
    expect(canSubmitReport('error', 'a'.repeat(2001), false)).toBe(false);
    expect(canSubmitReport('error', 'texto valido', true)).toBe(false);
    expect(canSubmitReport('error', 'texto valido', false)).toBe(true);
  });

  it('dados do aparelho: so sistema, versao, modelo e versao do app, com tamanho limitado', () => {
    expect(buildDeviceInfo({ platform: 'ios', osVersion: '18.1', deviceModel: 'iPhone 12', appVersion: '1.0.4' })).toEqual({ platform: 'ios', osVersion: '18.1', deviceModel: 'iPhone 12', appVersion: '1.0.4' });
    expect(buildDeviceInfo({ platform: 'web' })).toEqual({ platform: 'web', osVersion: undefined, deviceModel: undefined, appVersion: undefined });
    expect(buildDeviceInfo({ platform: 'android', osVersion: 34, deviceModel: 'x'.repeat(200) }).deviceModel).toHaveLength(64);
  });

  it('a compressao tem tentativas cada vez menores e a medida de tamanho confere', () => {
    for (let i = 1; i < PROBLEM_IMAGE_ATTEMPTS.length; i += 1) {
      expect(PROBLEM_IMAGE_ATTEMPTS[i].width).toBeLessThan(PROBLEM_IMAGE_ATTEMPTS[i - 1].width);
      expect(PROBLEM_IMAGE_ATTEMPTS[i].compress).toBeLessThan(PROBLEM_IMAGE_ATTEMPTS[i - 1].compress);
    }
    expect(base64Bytes(Buffer.alloc(1000).toString('base64'))).toBe(1000);
    expect(base64Bytes(Buffer.alloc(1001).toString('base64'))).toBe(1001);
  });

  it('mensagem final diz a verdade sobre as imagens anexadas', () => {
    expect(submitFeedbackText(0, 0)).toContain('foi enviado');
    expect(submitFeedbackText(2, 2)).not.toContain('não consegui');
    expect(submitFeedbackText(0, 2)).toContain('não consegui anexar');
    expect(submitFeedbackText(1, 3)).toContain('1 de 3');
  });

  it('a tela esta no menu e roteada no App', () => {
    const app = read('App.tsx');
    expect(app).toContain("id: 'problemReport', label: 'Relatar problema'");
    expect(app).toContain("activeTab === 'problemReport' && <ProblemReportScreen");
    expect(app).toContain("| 'problemReport';");
  });
});
