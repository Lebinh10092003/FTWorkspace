const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadTsModule } = require('./load-ts-module.cjs');
const Header = loadTsModule('src/components/layout/ModuleShellHeader.tsx').default;

const render = (props = {}) => renderToStaticMarkup(React.createElement(Header, {
  title: 'QA', items: [], activeId: '', onSelect() {}, ...props,
}));
const rowCount = html => (html.match(/data-shell-row=/g) || []).length;

test('module header needs only menu and breadcrumb without local controls', () => {
  assert.equal(rowCount(render()), 2);
});

test('page actions and local view tabs share the third header row', () => {
  const actions = React.createElement('button', null, 'Save page');
  const sectionNavigation = React.createElement('nav', null, 'Local view tabs');
  for (const props of [{ actions }, { sectionNavigation }, { actions, sectionNavigation }]) {
    const html = render(props);
    assert.equal(rowCount(html), 3);
    if (props.actions) assert.ok(html.includes('Save page'));
    if (props.sectionNavigation) assert.ok(html.includes('Local view tabs'));
  }
});
