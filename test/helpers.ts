import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type CharacterSheet, parseSheet } from '../src/data/model';

export const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

/** A sheet from partial fields, like the Kotlin data-class constructor with defaults. */
export const sheet = (fields: Partial<CharacterSheet> = {}): CharacterSheet => parseSheet({ ruleset: 'dnd5e', ...fields });
