import { describe, expect, test } from 'bun:test';
import { buildReferenceAuditReport, extractLinkedSlugs } from '../src/commands/reference.ts';

describe('extractLinkedSlugs', () => {
  test('normalizes relative markdown links', () => {
    const content = `
- [Polina](../people/polina-mireau.md)
- [Aseem](people/aseem)
- [External](https://example.com)
`;
    expect(extractLinkedSlugs(content, 'concepts/example')).toEqual([
      'people/aseem',
      'people/polina-mireau',
    ]);
  });
});

describe('buildReferenceAuditReport', () => {
  test('flags illegal company references', () => {
    const report = buildReferenceAuditReport([
      { slug: 'companies/marriott', content: '---\ntype: company\nreference: true\n---\n\n# Marriott' },
    ]);
    expect(report.errors).toBe(1);
    expect(report.issues[0]).toMatchObject({
      code: 'illegal_company_reference',
      slug: 'companies/marriott',
      severity: 'error',
    });
  });

  test('flags reference people with meeting backlinks', () => {
    const report = buildReferenceAuditReport([
      { slug: 'people/alice', content: '---\ntype: person\nreference: true\n---\n\n# Alice' },
      { slug: 'meetings/demo', content: '**Attendees:** [Alice](people/alice), Elliot' },
    ]);
    expect(report.errors).toBe(1);
    expect(report.issues[0]).toMatchObject({
      code: 'reference_person_has_interaction',
      slug: 'people/alice',
      severity: 'error',
    });
  });

  test('flags reference people with self-contained interaction signals', () => {
    const report = buildReferenceAuditReport([
      {
        slug: 'people/alice',
        content: '---\ntype: person\nreference: true\n---\n\n## Timeline\n- 2026-06-17 -- Meeting with Elliot',
      },
    ]);
    expect(report.errors).toBe(1);
    expect(report.issues[0]?.evidence.join(' ')).toContain('timeline');
  });

  test('warns on likely missed person references from content-only backlinks', () => {
    const report = buildReferenceAuditReport([
      { slug: 'people/alice', content: '---\ntype: person\n---\n\n# Alice' },
      { slug: 'sources/book', content: '- [Alice](people/alice)' },
      { slug: 'concepts/idea', content: '- [Alice](people/alice)' },
    ]);
    expect(report.errors).toBe(0);
    expect(report.warnings).toBe(1);
    expect(report.issues[0]).toMatchObject({
      code: 'likely_missing_person_reference',
      slug: 'people/alice',
      severity: 'warn',
    });
  });

  test('does not warn when a real-world interaction backlink exists', () => {
    const report = buildReferenceAuditReport([
      { slug: 'people/alice', content: '---\ntype: person\n---\n\n# Alice' },
      { slug: 'sources/book', content: '- [Alice](people/alice)' },
      { slug: 'meetings/demo', content: '**Attendees:** [Alice](people/alice), Elliot' },
    ]);
    expect(report.issues).toHaveLength(0);
  });
});
