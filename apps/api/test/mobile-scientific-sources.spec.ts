import { SOURCE_THEMES, isReferenceComplete, referenceUrl } from '../../mobile/src/scientificSources/sources';

// 17/10/2026 (Apple 1.4.1): so referencia conferida e completa pode existir na secao de fontes.
describe('scientificSources', () => {
  it('tem os seis temas e toda referencia cadastrada e completa', () => {
    expect(SOURCE_THEMES).toHaveLength(6);
    expect(SOURCE_THEMES.every((theme) => theme.references.length > 0)).toBe(true);
    expect(SOURCE_THEMES.reduce((sum, theme) => sum + theme.references.length, 0)).toBe(31);
    const keys = SOURCE_THEMES.flatMap((theme) => theme.references.map((reference) => (reference.doi ?? reference.pubmedId ?? '').toLowerCase()));
    expect(new Set(keys).size).toBe(31);
    expect(new Set(SOURCE_THEMES.flatMap((theme) => theme.references.map((reference) => reference.title.toLowerCase()))).size).toBe(31);
    for (const theme of SOURCE_THEMES) {
      for (const reference of theme.references) expect(isReferenceComplete(reference)).toBe(true);
    }
  });

  it('rejeita referencia sem link ou sem campo bibliografico', () => {
    const base = { title: 'T', authors: 'A', year: 2020, journal: 'J' };
    expect(isReferenceComplete(base)).toBe(false);
    expect(isReferenceComplete({ ...base, doi: '10.1/x' })).toBe(true);
    expect(isReferenceComplete({ ...base, pubmedId: '123', journal: '' })).toBe(false);
    expect(referenceUrl({ ...base, pubmedId: '123' })).toBe('https://pubmed.ncbi.nlm.nih.gov/123/');
  });
});
