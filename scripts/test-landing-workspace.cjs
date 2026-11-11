const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTsModule } = require('./load-ts-module.cjs');
require.extensions['.css'] = () => {};

const { areaForView, ADMINISTRATION_NAV, COMMUNICATION_TOOLS_NAV, filterModuleNav } = loadTsModule('src/config/workspaceNavigation.ts');
const { withAdditionalCompetitions } = loadTsModule('src/components/examination/additionalPublicCompetitions.ts');
const { landingPresentation } = loadTsModule('src/components/examination/landingPresentation.ts');
const { resolveHubContent } = loadTsModule('src/components/examination/landingHubContent.ts');

test('administrative screens resolve to one area and retain capability filtering', () => {
  const modules = ['work-schedule', 'attendance', 'funding-proposal', 'document-number', 'weekly-report'];
  for (const id of modules) {
    assert.equal(areaForView(id), 'administration');
    assert.ok(ADMINISTRATION_NAV.some(item => item.id === id));
    assert.ok(!COMMUNICATION_TOOLS_NAV.some(item => item.id === id));
  }
  assert.deepEqual(filterModuleNav(ADMINISTRATION_NAV.map(item => ({ ...item, requires: item.id === 'attendance' ? 'attendance' : undefined })), { attendance: false }).map(item => item.id), ['work-schedule', 'funding-proposal', 'document-number', 'weekly-report', 'account-management']);
  assert.equal(areaForView('account-management'), 'administration');
  assert.equal(areaForView('competition-landing'), 'communication-tools');
});

test('CMS overrides replace catalogue defaults and unpublished defaults stay hidden', () => {
  const replacement = { slug: 'simo', content: { subject: 'SIMO', intro: 'Edited' } };
  const items = withAdditionalCompetitions([replacement], ['waicy']);
  assert.equal(items.filter(site => site.slug === 'simo').length, 1);
  assert.equal(items.find(site => site.slug === 'simo'), replacement);
  assert.ok(!items.some(site => site.slug === 'waicy'));
  const renamed = withAdditionalCompetitions([{ slug: 'toan-sco', content: { subject: 'SIMO' } }]);
  assert.ok(!renamed.some(site => site.slug === 'simo'));
});

test('card, popup and detail presentation share editable content with safe defaults', () => {
  const site = { slug: 'fimo', title: 'FIMO', content: { subject: 'FIMO', logoUrl: '/custom-logo.png', display: { name: 'Tên mới', area: 'Tư duy Toán', audience: 'Lớp 1–9', context: 'Giới thiệu mới', topics: ['Đại số'], hoverSummary: 'Chủ đề mới' }, style: { accentColor: '#1456ab' } } };
  const result = landingPresentation(site);
  assert.equal(result.name, 'Tên mới');
  assert.equal(result.logo, '/custom-logo.png');
  assert.equal(result.context, 'Giới thiệu mới');
  assert.equal(result.area, 'Tư duy Toán');
  assert.equal(result.audience, 'Lớp 1–9');
  assert.deepEqual(result.topics, ['Đại số']);
  assert.equal(result.accent, '#1456ab');
  assert.equal(result.tint, '#1456ab12');
  const fallback = landingPresentation({ ...site, content: { subject: 'FIMO', logoUrl: 'javascript:alert(1)', style: { accentColor: 'red;display:none' } } });
  assert.equal(fallback.logo, '/competition-logos/fimo-light.png');
  assert.notEqual(fallback.accent, 'red;display:none');
});

test('overview fills missing fields while allowing intentional empty copy', () => {
  const content = resolveHubContent({ title: 'FT', scoIntro: '' });
  assert.equal(content.title, 'FT');
  assert.equal(content.scoIntro, '');
  assert.equal(content.individualUrl, '/dang-ky-du-thi');
  assert.ok(content.intro.includes('FermatTech'));
});
