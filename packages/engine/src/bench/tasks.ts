/**
 * Transfer-test (T2) task specs. Each is a small app in a domain unrelated to the reference
 * project, with acceptance tests generated from the same template so functional correctness is
 * measured identically for every task. `split` keeps the improvement loop off held-out tasks.
 */

export interface TaskField {
  label: string;
  key: string;
  sample: string;
}

export interface TaskSpec {
  id: string;
  split: 'dev' | 'test';
  title: string;
  heading: string;
  resource: string;
  displayField: string;
  fixture: Record<string, unknown>[];
  fields: TaskField[];
  addButton: string;
  searchPlaceholder: string;
  extra: string[];
}

export const API_BASE = 'http://localhost:4000';

export const TASKS: TaskSpec[] = [
  {
    id: 'recipe-box', split: 'dev', title: 'Recipe box', heading: 'Recipe Box', resource: 'recipes', displayField: 'title',
    fixture: [
      { id: 1, title: 'Shakshuka', minutes: 25, tags: ['breakfast'] },
      { id: 2, title: 'Miso ramen', minutes: 40, tags: ['dinner', 'soup'] },
      { id: 3, title: 'Banana bread', minutes: 70, tags: ['baking'] },
    ],
    fields: [{ label: 'Title', key: 'title', sample: 'Lemon pasta' }, { label: 'Minutes', key: 'minutes', sample: '15' }],
    addButton: 'Add recipe', searchPlaceholder: 'Search recipes',
    extra: ['Show each recipe as "<title> · <minutes> min" with its tags as small badges.', 'Recipes over 60 minutes get a "slow" marker.'],
  },
  {
    id: 'event-booking', split: 'test', title: 'Event booking', heading: 'Upcoming Events', resource: 'events', displayField: 'name',
    fixture: [
      { id: 1, name: 'Jazz night', date: '2026-11-02', seatsLeft: 12 },
      { id: 2, name: 'Pottery workshop', date: '2026-11-05', seatsLeft: 0 },
      { id: 3, name: 'City half marathon', date: '2026-11-09', seatsLeft: 140 },
    ],
    fields: [{ label: 'Name', key: 'name', sample: 'Board game meetup' }, { label: 'Date', key: 'date', sample: '2026-12-01' }],
    addButton: 'Add event', searchPlaceholder: 'Search events',
    extra: ['Show the date and "<seatsLeft> seats left"; sold-out events show "Sold out".', 'Sort events by date ascending.'],
  },
  {
    id: 'inventory-tracker', split: 'test', title: 'Inventory tracker', heading: 'Inventory', resource: 'products', displayField: 'name',
    fixture: [
      { id: 1, name: 'Espresso beans', sku: 'ESP-01', stock: 42 },
      { id: 2, name: 'Oat milk', sku: 'OAT-12', stock: 3 },
      { id: 3, name: 'Paper cups', sku: 'CUP-08', stock: 900 },
    ],
    fields: [{ label: 'Name', key: 'name', sample: 'Matcha powder' }, { label: 'SKU', key: 'sku', sample: 'MAT-02' }],
    addButton: 'Add product', searchPlaceholder: 'Search products',
    extra: ['Show SKU and stock for each product; stock below 5 shows a "Low stock" warning.', 'Show the total number of products in the header.'],
  },
];

export const taskById = (id: string) => TASKS.find((t) => t.id === id);

export function taskPrompt(t: TaskSpec): string {
  const endpoint = `${API_BASE}/api/${t.resource}`;
  return `# Build: ${t.title}

Build a small React + TypeScript app in this folder. Vite, React, TypeScript, Vitest and Testing Library are already installed. You may add libraries with npm if you need them.

## Requirements
- \`src/App.tsx\` exports the \`App\` component (named or default export) and renders every provider the app needs itself. \`src/main.tsx\` only mounts \`<App />\` into \`#root\`.
- Show a page heading "${t.heading}".
- Load ${t.resource} from \`GET ${endpoint}\`. It returns JSON like: \`${JSON.stringify(t.fixture[0])}\`. Show each item's ${t.displayField}.
- While loading, show "Loading…". If the request fails, show a message containing "Something went wrong".
- A search input with placeholder "${t.searchPlaceholder}" filters the list by ${t.displayField} (client-side, case-insensitive).
- A form with inputs labelled ${t.fields.map((f) => `"${f.label}"`).join(' and ')} and a "${t.addButton}" button sends \`POST ${endpoint}\` with JSON \`{ ${t.fields.map((f) => `${f.key}`).join(', ')} }\`; the created item (returned by the server) then appears in the list.
${t.extra.map((e) => `- ${e}`).join('\n')}

Write production-quality code. When the app is complete, stop.`;
}

/** Acceptance tests (Vitest + Testing Library + MSW), copied in only after the agent finishes. */
export function acceptanceTest(t: TaskSpec): string {
  const [first, second] = t.fixture;
  const display = (x: Record<string, unknown>) => String(x[t.displayField]);
  const typed = t.fields.map((f) => `    await user.type(screen.getByLabelText(/^${f.label}/i), ${JSON.stringify(f.sample)});`).join('\n');
  return `import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import * as AppModule from '../src/App';

const App = (AppModule as any).App ?? (AppModule as any).default;
const fixture = ${JSON.stringify(t.fixture)};
let created: Record<string, unknown>[] = [];
let posted: unknown[] = [];

const server = setupServer(
  http.get('*/api/${t.resource}', () => HttpResponse.json([...fixture, ...created])),
  http.post('*/api/${t.resource}', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    posted.push(body);
    const item = { ...fixture[0], ...body, id: 100 + created.length };
    created.push(item);
    return HttpResponse.json(item, { status: 201 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => { cleanup(); server.resetHandlers(); created = []; posted = []; });
afterAll(() => server.close());

describe('${t.title}', () => {
  it('shows the heading', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: /${t.heading}/i })).toBeTruthy();
  });

  it('lists items from the API', async () => {
    render(<App />);
    expect(await screen.findByText(${JSON.stringify(display(first))}, { exact: false })).toBeTruthy();
    expect(await screen.findByText(${JSON.stringify(display(second))}, { exact: false })).toBeTruthy();
  });

  it('shows an error when the request fails', async () => {
    server.use(http.get('*/api/${t.resource}', () => new HttpResponse(null, { status: 500 })));
    render(<App />);
    // Generous timeout: data libraries may retry before surfacing the error.
    expect(await screen.findByText(/something went wrong/i, {}, { timeout: 15000 })).toBeTruthy();
  }, 20000);

  it('filters by search', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(${JSON.stringify(display(first))}, { exact: false });
    await user.type(screen.getByPlaceholderText(/${t.searchPlaceholder}/i), ${JSON.stringify(display(second).slice(0, 5))});
    await waitFor(() => expect(screen.queryByText(${JSON.stringify(display(first))}, { exact: false })).toBeNull());
    expect(screen.getByText(${JSON.stringify(display(second))}, { exact: false })).toBeTruthy();
  });

  it('adds an item', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(${JSON.stringify(display(first))}, { exact: false });
${typed}
    await user.click(screen.getByRole('button', { name: /${t.addButton}/i }));
    await waitFor(() => expect(posted.length).toBe(1));
    expect(await screen.findByText(${JSON.stringify(t.fields[0].sample)}, { exact: false })).toBeTruthy();
  });
});
`;
}

/** Neutral Vite + React + TS scaffold. No src/ code, so it carries no style of its own. */
export const SCAFFOLD: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'ars-task', private: true, type: 'module',
      scripts: { dev: 'vite', build: 'tsc --noEmit && vite build', test: 'vitest run' },
      dependencies: { react: '^19.2.0', 'react-dom': '^19.2.0' },
      devDependencies: {
        '@testing-library/dom': '^10.4.0', '@testing-library/react': '^16.3.0', '@testing-library/user-event': '^14.6.1',
        '@types/react': '^19.2.0', '@types/react-dom': '^19.2.0', '@vitejs/plugin-react': '^5.1.0', jsdom: '^27.0.0',
        msw: '^2.11.0', typescript: '^5.9.0', vite: '^7.1.0', vitest: '^3.2.0',
      },
    },
    null, 2,
  ),
  'tsconfig.json': JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'Bundler',
        jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true, baseUrl: '.', paths: { '@/*': ['src/*'] },
      },
      include: ['src'],
    },
    null, 2,
  ),
  'vite.config.ts': `import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'jsdom' },
});
`,
  'index.html': `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>App</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
`,
};
