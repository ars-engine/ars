import type { Analysis, Convention } from '../core/types.ts';
import { slug } from '../core/util.ts';

/** L5 library choices: which tool this developer reaches for, per concern. */
const CATEGORIES: [string, string[]][] = [
  ['server state', ['@tanstack/react-query', 'react-query', 'swr', '@apollo/client', 'urql']],
  ['client state', ['zustand', '@reduxjs/toolkit', 'redux', 'jotai', 'recoil', 'mobx', 'valtio']],
  ['HTTP client', ['axios', 'ky', 'ofetch']],
  ['styling', ['tailwindcss', 'styled-components', '@emotion/react', 'sass', '@vanilla-extract/css']],
  ['forms', ['react-hook-form', 'formik', '@tanstack/react-form']],
  ['validation', ['zod', 'yup', 'valibot', 'joi']],
  ['routing', ['react-router-dom', 'react-router', '@tanstack/react-router', 'wouter']],
  ['UI primitives', ['@radix-ui/react-slot', '@mui/material', '@chakra-ui/react', 'antd', '@mantine/core', '@headlessui/react']],
  ['icons', ['lucide-react', 'react-icons', '@heroicons/react', '@tabler/icons-react']],
  ['dates', ['date-fns', 'dayjs', 'moment', 'luxon']],
  ['test runner', ['vitest', 'jest']],
  ['toasts', ['sonner', 'react-hot-toast', 'react-toastify']],
];

const NOT_IMPORTED = new Set(['tailwindcss', 'sass', 'vitest', 'jest']);

export function dependencyConventions(analysis: Analysis): Convention[] {
  const deps = Object.keys(analysis.dependencies);
  const out: Convention[] = [];
  for (const [category, libs] of CATEGORIES) {
    const lib = libs.find((l) => deps.includes(l));
    if (!lib) continue;
    const users = analysis.imports.filter((e) => e.spec === lib || e.spec.startsWith(`${lib}/`));
    const files = [...new Set(users.map((e) => e.from))];
    const alternatives = libs.filter((l) => l !== lib);
    // Tooling such as Tailwind or Sass is configured, not imported, so zero imports is normal there.
    const confidence = files.length >= 3 || NOT_IMPORTED.has(lib) ? 0.9 : files.length ? 0.75 : 0.5;
    out.push({
      id: `L5.dep.${slug(category)}`,
      layer: 'L5',
      title: `${category[0].toUpperCase()}${category.slice(1)}: ${lib}`,
      instruction: `Use \`${lib}\` for ${category} — not ${alternatives.slice(0, 3).map((a) => `\`${a}\``).join(', ')}.`,
      scope: 'dependencies',
      check: { type: 'dependency', category, lib, alternatives },
      support: { matched: files.length, total: files.length, ratio: 1 },
      evidence: users.slice(0, 12).map((e) => ({ file: e.from, line: e.line, value: e.spec })),
      exceptions: [],
      confidence,
      trend: 'unknown',
      tier: 'learned',
      source: 'miner',
      status: 'pending',
    });
  }
  return out;
}
