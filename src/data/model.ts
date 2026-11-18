/**
 * character.json model. Mirrors archive/android/.../data/CharacterModels.kt (CharacterSheet and children).
 *
 * Sheets are kept as plain JSON objects so unknown keys survive a round trip. `parseSheet` only
 * normalizes the fields the Android serializers are lenient about (legacy string features and
 * equipment, `items` vs `equipment`, numbers sent as strings), so an export imports cleanly on Android.
 */

export interface CharacterSheet {
  ruleset: string;
  edition?: string | null;
  status?: string;
  currentStep?: string | null;
  constraints?: CharacterConstraints | null;
  contentSources?: string[];
  usedOptions?: UsedOption[];
  identity?: CharacterIdentity | null;
  classes: ClassLevel[];
  cosmology?: Cosmology | null;
  abilityScores?: AbilityScores | null;
  feats: FeatEntry[];
  fightingStyle?: string | null;
  runes?: RunesBlock | null;
  proficiencies?: Proficiencies | null;
  startingEquipment?: unknown;
  equipment: EquipmentEntry[];
  equipmentLocations: EquipmentLocation[];
  equipmentStash?: EquipmentLocation | null;
  consumables: ConsumableEntry[];
  wealth?: Wealth | null;
  magicItems: MagicItem[];
  personality?: Personality | null;
  appearance?: Record<string, unknown> | null;
  features: Feature[];
  combatActions?: CombatActions | null;
  spells?: SpellsBlock | null;
  derived?: DerivedStats | null;
  sources?: SourceRef[];
  [key: string]: unknown;
}

export interface CharacterConstraints {
  level?: number;
  campaignTone?: string | null;
  houseRules?: string[];
  allowedSources?: string[];
  disallowedSources?: string[];
  sourceTier?: string | null;
  encumbranceRule?: string | null;
  [key: string]: unknown;
}

export interface UsedOption { option: string; type: string; source: string; notes?: string | null }

export interface CharacterIdentity {
  name?: string | null;
  cultAlias?: string | null;
  publicPersona?: string | null;
  species?: string | null;
  race?: string | null;
  raceSubChoice?: string | null;
  class?: string | null;
  subclass?: string | null;
  background?: string | null;
  originFeat?: string | null;
  alignment?: string | null;
  gender?: string | null;
  presentationNotes?: string | null;
  [key: string]: unknown;
}

export interface ClassLevel { name: string; subclass?: string | null; level: number; hitDie?: string | null }

export interface Cosmology {
  entityToRelease?: string | null;
  pantheon?: string | null;
  /** The character's own belief. Older sheets name this field after the character ("<name>Belief"). */
  belief?: string | null;
  cultSymbol?: string | null;
  cultSymbolNotes?: string | null;
  /** The character's origin story. Older sheets name this field after the character ("<name>Origin"). */
  origin?: string | null;
  soundBites?: SoundBite[];
  parents?: { faith?: string | null; fate?: string | null; godsResponse?: string | null } | null;
  [key: string]: unknown;
}

/** `cosmology.origin`, or an older per-character "<name>Origin" field. */
export const cosmologyOrigin = (c: Cosmology | null | undefined): string | null => cosmologyField(c, 'origin', /^[a-z]+Origin$/);

/** `cosmology.belief`, or an older per-character "<name>Belief" field. */
export const cosmologyBelief = (c: Cosmology | null | undefined): string | null => cosmologyField(c, 'belief', /^[a-z]+Belief$/);

/**
 * Same rule as the Android Cosmology serializer: an older "<name>Origin"/"<name>Belief" text wins,
 * then a text `origin`/`belief`. A non-text value (older sheets have a structured `origin` object)
 * is ignored here but kept in the sheet.
 */
function cosmologyField(c: Cosmology | null | undefined, key: string, legacy: RegExp): string | null {
  if (!c) return null;
  for (const [k, v] of Object.entries(c)) if (legacy.test(k) && typeof v === 'string' && v.trim()) return v;
  const direct = c[key];
  return typeof direct === 'string' && direct.trim() ? direct : null;
}

export interface SoundBite { id: string; tier?: string; prompt: string; answer: string }

export interface CombatActionEntry {
  id: string;
  name: string;
  summary: string;
  featureId?: string | null;
  secret?: boolean;
  rulesText?: string | null;
}

export interface CombatActions {
  movement?: CombatActionEntry[];
  action?: CombatActionEntry[];
  bonus?: CombatActionEntry[];
  reaction?: CombatActionEntry[];
  freeOrSpecial?: CombatActionEntry[];
  onHitOrTrigger?: CombatActionEntry[];
}

export interface AbilityScores {
  method?: string | null;
  base?: Record<string, number>;
  backgroundBonuses?: Record<string, number>;
  racialBonuses?: Record<string, number>;
  asiHistory?: { level: number; choice: string; feat?: string | null }[];
  final?: Record<string, number>;
  [key: string]: unknown;
}

export interface FeatEntry { name: string; source?: string | null; level?: number | null; from?: string | null; rulesText?: string | null }

export interface RunesBlock {
  known?: string[];
  inscribed?: Record<string, string>;
  saveDC?: number | null;
  eclipseRune?: Record<string, string | null> | null;
  optionalVariant?: Record<string, unknown> | null;
}

export interface SkillEntry { name: string; source?: string | null; modifier?: number | null; notes?: string | null }

export interface Proficiencies {
  skills?: SkillEntry[];
  tools?: string[];
  toolsNotes?: string | null;
  languages?: string[];
  armor?: string[];
  weapons?: string[];
  savingThrows?: string[];
}

export interface Wealth {
  gold?: number | null;
  platinum?: number | null;
  electrum?: number | null;
  silver?: number | null;
  copper?: number | null;
  startingGold?: number | null;
  spentOnConsumables?: number | null;
  spentOnCultDonation?: number | null;
  notes?: string | null;
  [key: string]: unknown;
}

export interface ConsumableEntry {
  name: string;
  quantity: number;
  unitPriceGp?: number | null;
  totalPriceGp?: number | null;
  source?: string | null;
  rulesText?: string | null;
  weightLb?: number | null;
}

export interface MagicItem {
  name: string;
  rarity?: string | null;
  source?: string | null;
  slot?: string | null;
  notes?: string | null;
  rulesText?: string | null;
  weightLb?: number | null;
}

export interface EquipmentLocation { location: string; notes?: string | null; equipment: EquipmentEntry[] }

export interface EquipmentEntry { name: string; quantity: number; weightLb?: number | null; notes?: string | null }

export interface Personality { traits?: string[]; ideals?: string[]; bonds?: string[]; flaws?: string[]; notes?: string | null }

export interface FeatureUses { max: number; per: string }

export interface Feature { id: string; name: string; source?: string | null; uses?: FeatureUses | null; rulesText: string }

export interface PactMagic { slots: number; level: number }

export interface SpellsBlock {
  ability?: string | null;
  cantrips?: string[];
  known?: string[];
  prepared?: string[];
  slots?: Record<string, number>;
  pactMagic?: PactMagic | null;
}

export interface AttackEntry {
  name: string;
  bonus?: number | null;
  damage?: string | null;
  reach?: number | null;
  range?: string | null;
  notes?: string | null;
}

export interface DerivedStats {
  level: number;
  proficiencyBonus: number;
  hitPoints?: { total: number; method?: string | null; formula?: string | null; notes?: string | null } | null;
  hitDice?: string | null;
  armorClass?: number | null;
  speed?: number | null;
  initiative?: number | null;
  passivePerception?: number | null;
  stealth?: string | null;
  level10Preview?: Record<string, string>;
  attacks?: AttackEntry[];
  savingThrows?: Record<string, number>;
  [key: string]: unknown;
}

export interface SourceRef { topic: string; url: string; edition?: string | null; verifiedAt?: string | null }

// ---------------------------------------------------------------- parsing

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A JSON primitive's content as a string (Kotlin `contentOrNull`). */
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

export function slugify(value: string): string {
  const s = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return s || 'feature';
}

/** "Javelins (×4) — 8 lb" -> name, quantity, weight. */
export function parseLegacyEquipmentString(text: string): EquipmentEntry {
  let remaining = text.trim();
  let weightLb: number | null = null;
  const w = /[—-]\s*(\d+(?:\.\d+)?)\s*lb\s*$/i.exec(remaining);
  if (w) {
    weightLb = Number(w[1]);
    remaining = (remaining.slice(0, w.index) + remaining.slice(w.index + w[0].length)).trim();
  }
  let quantity = 1;
  const q = /\(×(\d+)\)/.exec(remaining);
  if (q) {
    quantity = Number(q[1]) || 1;
    remaining = remaining.replace(q[0], '').trim();
  }
  return { name: remaining, quantity, weightLb };
}

function parseEquipmentElement(el: unknown): EquipmentEntry | null {
  if (typeof el === 'string' || typeof el === 'number') {
    const text = String(el).trim();
    return text ? parseLegacyEquipmentString(text) : null;
  }
  if (isObj(el)) {
    const name = str(el.name) ?? '';
    if (!name.trim()) return null;
    const out: EquipmentEntry = {
      ...el,
      name,
      quantity: int(el.quantity) ?? 1,
      weightLb: num(el.weightLb),
      notes: str(el.notes),
    };
    return out;
  }
  return null;
}

export function parseEquipmentList(v: unknown): EquipmentEntry[] {
  if (!Array.isArray(v)) return [];
  return v.map(parseEquipmentElement).filter((e): e is EquipmentEntry => e !== null);
}

export function parseEquipmentLocation(v: unknown): EquipmentLocation {
  if (!isObj(v)) return { location: '', equipment: [] };
  const { items, ...rest } = v;
  const eq = v.equipment ?? items ?? [];
  const loc: EquipmentLocation = {
    ...rest,
    location: str(v.location) ?? '',
    equipment: parseEquipmentList(eq),
  };
  const notes = str(v.notes);
  if (notes && notes.trim()) loc.notes = notes;
  else delete loc.notes;
  return loc;
}

function parseFeatureElement(el: unknown): Feature | null {
  if (typeof el === 'string') {
    const text = el.trim();
    if (!text) return null;
    const before = text.split(' (')[0];
    return { id: slugify(before), name: before.trim(), rulesText: text };
  }
  if (isObj(el)) {
    const name = str(el.name) ?? '';
    const id = str(el.id) ?? slugify(name);
    const rulesText = str(el.rulesText) ?? '';
    if (!name.trim() && !rulesText.trim()) return null;
    let uses: FeatureUses | null = null;
    if (isObj(el.uses)) {
      const max = str(el.uses.max);
      const maxInt = max !== null && /^-?\d+$/.test(max.trim()) ? Number(max.trim()) : null;
      if (maxInt !== null) uses = { max: maxInt, per: str(el.uses.per) ?? '' };
    }
    return {
      id: id.trim() ? id : slugify(name),
      name: name.trim() ? name : id,
      source: str(el.source),
      uses,
      rulesText: rulesText.trim() ? rulesText : name,
    };
  }
  return null;
}

export function parseFeatureList(v: unknown): Feature[] {
  if (!Array.isArray(v)) return [];
  return v.map(parseFeatureElement).filter((f): f is Feature => f !== null);
}

function arr<T>(v: unknown, keep: (x: unknown) => x is T): T[] {
  return Array.isArray(v) ? v.filter(keep) : [];
}

const named = (x: unknown): x is { name: string } => isObj(x) && typeof x.name === 'string' && x.name.trim() !== '';

/**
 * Parse character.json text or object into a sheet. Throws if it is not a JSON object.
 * Lenient like the Android decoder: unknown keys kept, bad list entries dropped.
 */
export function parseSheet(input: string | unknown): CharacterSheet {
  const raw = typeof input === 'string' ? JSON.parse(input) : input;
  if (!isObj(raw)) throw new Error('character.json must be a JSON object.');
  const sheet: CharacterSheet = {
    ...raw,
    ruleset: str(raw.ruleset) ?? 'dnd5e',
    classes: arr(raw.classes, isObj).map((c) => ({
      ...c,
      name: str(c.name) ?? '',
      subclass: str(c.subclass),
      level: int(c.level) ?? 1,
      hitDie: str(c.hitDie),
    })),
    feats: arr(raw.feats, named) as FeatEntry[],
    equipment: parseEquipmentList(raw.equipment),
    equipmentLocations: Array.isArray(raw.equipmentLocations) ? raw.equipmentLocations.map(parseEquipmentLocation) : [],
    equipmentStash: isObj(raw.equipmentStash) ? parseEquipmentLocation(raw.equipmentStash) : null,
    consumables: arr(raw.consumables, named).map((c) => ({ ...c, quantity: int((c as Json).quantity) ?? 1 })) as ConsumableEntry[],
    magicItems: arr(raw.magicItems, named) as MagicItem[],
    features: parseFeatureList(raw.features),
  };
  if (isObj(raw.derived)) {
    const d = raw.derived;
    sheet.derived = {
      ...d,
      level: int(d.level) ?? 1,
      proficiencyBonus: int(d.proficiencyBonus) ?? 2,
      attacks: arr(d.attacks, named) as AttackEntry[],
    };
  }
  if (isObj(raw.combatActions)) {
    const ca = raw.combatActions;
    const ok = (x: unknown): x is CombatActionEntry =>
      isObj(x) && typeof x.id === 'string' && typeof x.name === 'string' && typeof x.summary === 'string';
    sheet.combatActions = {
      ...ca,
      movement: arr(ca.movement, ok),
      action: arr(ca.action, ok),
      bonus: arr(ca.bonus, ok),
      reaction: arr(ca.reaction, ok),
      freeOrSpecial: arr(ca.freeOrSpecial, ok),
      onHitOrTrigger: arr(ca.onHitOrTrigger, ok),
    };
  }
  if (isObj(raw.cosmology) && Array.isArray(raw.cosmology.soundBites)) {
    const ok = (x: unknown): x is SoundBite =>
      isObj(x) && typeof x.id === 'string' && typeof x.prompt === 'string' && typeof x.answer === 'string';
    sheet.cosmology = { ...raw.cosmology, soundBites: arr(raw.cosmology.soundBites, ok) };
  }
  return sheet;
}

// ---------------------------------------------------------------- helpers

export function displayName(sheet: CharacterSheet): string {
  const name = sheet.identity?.name?.trim() ?? '';
  return name || 'Unnamed Character';
}

export function slugHint(sheet: CharacterSheet): string {
  const s = displayName(sheet).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'unnamed';
}

export const level = (sheet: CharacterSheet): number => sheet.derived?.level ?? sheet.constraints?.level ?? 1;

export const maxHp = (sheet: CharacterSheet): number => sheet.derived?.hitPoints?.total ?? 1;

export function resolvedEquipmentLocations(sheet: CharacterSheet): EquipmentLocation[] {
  if (sheet.equipmentLocations.length > 0) return sheet.equipmentLocations;
  if (sheet.equipmentStash) return [sheet.equipmentStash];
  return [];
}

/** Stash folds into equipmentLocations, as Android saves it. */
export function normalizedForSave(sheet: CharacterSheet): CharacterSheet {
  return { ...sheet, equipmentLocations: resolvedEquipmentLocations(sheet), equipmentStash: null };
}

export function lineWeightLb(e: { weightLb?: number | null; quantity: number }): number | null {
  if (e.weightLb === null || e.weightLb === undefined) return null;
  return e.weightLb * Math.max(1, e.quantity);
}

export function formatWeightLb(lb: number): string {
  const rounded = Math.trunc(lb * 10) / 10;
  return `${rounded} lb`;
}

export function equipmentLabel(e: EquipmentEntry): string {
  const qty = e.quantity > 1 ? ` (×${e.quantity})` : '';
  const notes = e.notes?.trim() ? `; ${e.notes.trim()}` : '';
  const w = lineWeightLb(e);
  const weight = w !== null ? ` — ${formatWeightLb(w)}` : '';
  return `${e.name}${qty}${notes}${weight}`;
}

/** floor, not truncation: a score of 9 is -1. */
export const abilityModifier = (score: number): number => Math.floor((score - 10) / 2);

export const formatModifier = (mod: number): string => (mod >= 0 ? `+${mod}` : String(mod));

/** "halfPlate" / "half_plate" -> "half plate" (Kotlin humanizeKey). */
export const humanizeKey = (key: string): string => key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

export const isSecretBite = (b: SoundBite): boolean => (b.tier ?? 'public').toLowerCase() === 'secret';

export const usesShortRest = (u: FeatureUses): boolean => u.per === 'short_rest';
export const usesLongRest = (u: FeatureUses): boolean => u.per === 'long_rest' || u.per === 'day';

export function restLabel(per: string): string {
  switch (per) {
    case 'short_rest': return 'short rest';
    case 'long_rest': return 'long rest';
    case 'day': return 'per day';
    default: return per.replace(/_/g, ' ');
  }
}

export function actionBuckets(ca: CombatActions | null | undefined): [string, CombatActionEntry[]][] {
  if (!ca) return [];
  const list: [string, CombatActionEntry[]][] = [
    ['Movement', ca.movement ?? []],
    ['Action', ca.action ?? []],
    ['Bonus', ca.bonus ?? []],
    ['Reaction', ca.reaction ?? []],
    ['Special', ca.freeOrSpecial ?? []],
    ['Triggers', ca.onHitOrTrigger ?? []],
  ];
  return list.filter(([, e]) => e.length > 0);
}
