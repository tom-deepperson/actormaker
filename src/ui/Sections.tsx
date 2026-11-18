/** Sheet sections. Mirrors archive/android/.../ui/SheetSections.kt, including what each view context hides. */
import {
  type CharacterSheet, type Feature, abilityModifier, actionBuckets, cosmologyBelief, cosmologyOrigin, formatModifier, isSecretBite, level, restLabel,
} from '../data/model';
import { classLabel } from '../data/classes';
import {
  type SheetViewContext, canShowSecretBackstory, effectiveDisplayChoice, sheetTitle, shouldHideSecretIdentity,
  visibleCombatAction, visibleSoundBites,
} from '../data/viewContext';
import { Card, RulesLink } from './common';

const ABILITIES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
type P = { sheet: CharacterSheet; ctx: SheetViewContext };

export function SummarySection({ sheet, ctx }: P) {
  const id = sheet.identity;
  const hide = shouldHideSecretIdentity(ctx, id);
  const choice = effectiveDisplayChoice(ctx, id);
  const app = sheet.appearance as Record<string, string | number | null> | null | undefined;
  const physique = [app?.age != null ? `Age ${app.age}` : null, app?.height, app?.weightLb != null ? `${app.weightLb} lb` : null].filter(Boolean);
  return (
    <Card title="Summary" id="summary">
      {sheet.edition && <div class="small muted">Edition: {sheet.edition} · {sheet.ruleset}</div>}
      {hide ? (
        <div class="strong">Name: {sheetTitle(sheet, ctx)}</div>
      ) : choice === 'primary' ? (
        <>
          {id?.name && <div class="strong">Name: {id.name}</div>}
          {id?.cultAlias && <div>Also known as: {id.cultAlias}</div>}
        </>
      ) : (
        <>
          {id?.cultAlias && <div class="strong">Name: {id.cultAlias}</div>}
          {id?.name && <div>True name: {id.name}</div>}
        </>
      )}
      <div>{[id?.race ? id.race + (id.raceSubChoice ? ` (${id.raceSubChoice})` : '') : null, classLabel(sheet)].filter(Boolean).join(' · ')}</div>
      <div>{[id?.background, id?.alignment, `Level ${level(sheet)}`].filter(Boolean).join(' · ')}</div>
      {!hide && (
        <>
          {physique.length > 0 && <div class="small">{physique.join(' · ')}</div>}
          {id?.gender && <div class="small">Gender: {id.gender}</div>}
          {id?.presentationNotes && <div class="small muted">{id.presentationNotes}</div>}
        </>
      )}
      {id?.publicPersona && <div class="small muted">{id.publicPersona}</div>}
      {sheet.fightingStyle && <div class="small">Fighting style: {sheet.fightingStyle}</div>}
    </Card>
  );
}

export function AbilitiesSection({ sheet, detailed }: { sheet: CharacterSheet; detailed?: boolean }) {
  const a = sheet.abilityScores;
  const final = a?.final ?? {};
  if (!Object.keys(final).length) return null;
  const saves = sheet.derived?.savingThrows ?? {};
  return (
    <Card title="Ability scores" id="abilities">
      <div class="abilities">
        {ABILITIES.filter((k) => k in final).map((k) => (
          <div class="stat" key={k}>
            <span>{k}</span>
            <b>{formatModifier(abilityModifier(final[k]))}</b>
            <div class="tiny muted">{final[k]}{saves[k] != null ? ` · save ${formatModifier(saves[k])}` : ''}</div>
          </div>
        ))}
      </div>
      {detailed && (
        <div class="small muted" style={{ marginTop: 8 }}>
          {a?.method && <div>Method: {a.method}</div>}
          {ABILITIES.filter((k) => a?.base?.[k] != null).length > 0 && (
            <div>Base: {ABILITIES.filter((k) => a?.base?.[k] != null).map((k) => `${k} ${a!.base![k]}${a?.racialBonuses?.[k] ? ` (+${a.racialBonuses[k]})` : ''}`).join(' · ')}</div>
          )}
          {(a?.asiHistory ?? []).map((e) => <div key={e.level}>Level {e.level}: {e.feat ?? e.choice}</div>)}
        </div>
      )}
    </Card>
  );
}

export function CombatStatsSection({ sheet }: { sheet: CharacterSheet }) {
  const d = sheet.derived;
  if (!d) return null;
  const saves = d.savingThrows ?? {};
  return (
    <Card title="Combat" id="combat">
      <div class="small">
        {[
          `Proficiency +${d.proficiencyBonus}`,
          d.hitPoints ? `HP ${d.hitPoints.total}` : null,
          d.armorClass != null ? `AC ${d.armorClass}` : null,
          d.speed != null ? `Speed ${d.speed} ft` : null,
          d.initiative != null ? `Initiative ${formatModifier(d.initiative)}` : null,
          d.passivePerception != null ? `Passive Perception ${d.passivePerception}` : null,
          d.hitDice ? `Hit dice ${d.hitDice}` : null,
        ].filter(Boolean).join(' · ')}
      </div>
      {d.hitPoints?.formula && <div class="tiny muted">{d.hitPoints.formula}</div>}
      {d.stealth && <div class="small">Stealth: {d.stealth}</div>}
      {Object.keys(saves).length > 0 && (
        <>
          <h3>Saving throws</h3>
          <div class="small">{ABILITIES.filter((k) => k in saves).map((k) => `${k} ${formatModifier(saves[k])}`).join(' · ')}</div>
        </>
      )}
      {(d.attacks ?? []).length > 0 && (
        <>
          <h3>Attacks</h3>
          {d.attacks!.map((a) => (
            <div class="small" key={a.name}>
              <b>{a.name}</b>: {[a.bonus != null ? `${formatModifier(a.bonus)} to hit` : null, a.damage, a.reach != null ? `reach ${a.reach} ft` : null, a.range, a.notes].filter(Boolean).join('; ')}
            </div>
          ))}
        </>
      )}
    </Card>
  );
}

export function ActionChecklist({ sheet, ctx }: P) {
  const buckets = actionBuckets(sheet.combatActions)
    .map(([t, e]) => [t, e.filter((x) => visibleCombatAction(ctx, x, sheet.identity))] as const)
    .filter(([, e]) => e.length > 0);
  if (!buckets.length) return null;
  return (
    <Card title="Action checklist" id="actions">
      {buckets.map(([title, entries], i) => (
        <details key={title} open={i === 0}>
          <summary class="strong" style={{ color: 'var(--accent)', padding: '4px 0', cursor: 'pointer' }}>{title}</summary>
          <ul class="plain">
            {entries.map((e) => {
              const f = e.featureId ? sheet.features.find((x) => x.id === e.featureId) : undefined;
              return (
                <li key={e.id}>
                  <RulesLink name={e.name} text={f?.rulesText ?? e.rulesText ?? e.summary} meta={f?.source ?? undefined} />
                  <div class="small muted">{e.summary}</div>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </Card>
  );
}

export function FeatsSection({ sheet }: { sheet: CharacterSheet }) {
  if (!sheet.feats.length) return null;
  return (
    <Card title="Feats" id="feats">
      <ul class="plain">
        {sheet.feats.map((f) => (
          <li key={f.name}>
            <div class="strong">{f.name}</div>
            {[f.level != null ? `L${f.level}` : null, f.source, f.from].filter(Boolean).length > 0 && (
              <div class="tiny muted">{[f.level != null ? `L${f.level}` : null, f.source, f.from].filter(Boolean).join(' · ')}</div>
            )}
            {f.rulesText && <div class="small">{f.rulesText}</div>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function RunesSection({ sheet, ctx }: P) {
  const r = sheet.runes;
  if (!r) return null;
  const e = r.eclipseRune as Record<string, string | null> | null | undefined;
  const v = r.optionalVariant as Record<string, string | boolean | null> | null | undefined;
  return (
    <Card title="Runes" id="runes">
      {r.saveDC != null && <div>Rune save DC: {r.saveDC}</div>}
      {(r.known ?? []).length > 0 && <div>Known: {r.known!.join(', ')}</div>}
      {Object.entries(r.inscribed ?? {}).map(([item, rune]) => (
        <div class="small" key={item}>{item}{rune === 'Eclipse' && e?.inscriptionSite ? ` (${e.inscriptionSite})` : ''} → {rune}</div>
      ))}
      {e && (
        <>
          <h3>{e.name ?? 'Eclipse Rune'}</h3>
          {[e.inscribedOn, e.inscriptionSite].filter(Boolean).length > 0 && <div class="tiny muted">Inscribed: {[e.inscribedOn, e.inscriptionSite].filter(Boolean).join(' · ')}</div>}
          {e.passive && <div class="small">Passive: {e.passive}</div>}
          {e.invoke && <div class="small">Invoke: {e.invoke}</div>}
        </>
      )}
      {v && !shouldHideSecretIdentity(ctx, sheet.identity) && (
        <>
          <h3>Optional: {String(v.name)}</h3>
          {v.requiresDmApproval && <div class="tiny muted">Requires DM approval</div>}
          {v.replaces && <div class="small">Replaces {String(v.replaces)} on {String(v.inscribedOn ?? '')}</div>}
          {v.passive && <div class="small">Passive: {String(v.passive)}</div>}
          {v.invoke && <div class="small">Invoke: {String(v.invoke)}</div>}
          {v.balanceNotes && <div class="small muted">{String(v.balanceNotes)}</div>}
        </>
      )}
    </Card>
  );
}

export function ProficienciesSection({ sheet }: { sheet: CharacterSheet }) {
  const p = sheet.proficiencies;
  if (!p) return null;
  return (
    <Card title="Proficiencies" id="proficiencies">
      {(p.skills ?? []).length > 0 && (
        <div class="small" style={{ columns: 2, columnGap: 16 }}>
          {p.skills!.map((s) => (
            <div key={s.name}>
              {s.name} <b>{s.modifier != null ? formatModifier(s.modifier) : ''}</b>
              {s.source && <span class="tiny muted"> [{s.source}]</span>}
            </div>
          ))}
        </div>
      )}
      <div class="small stack" style={{ gap: 2, marginTop: 8 }}>
        {(p.tools ?? []).length > 0 && <div>Tools: {p.tools!.join(', ')}</div>}
        {p.toolsNotes && <div class="tiny muted">{p.toolsNotes}</div>}
        {(p.languages ?? []).length > 0 && <div>Languages: {p.languages!.join(', ')}</div>}
        {(p.armor ?? []).length > 0 && <div>Armor: {p.armor!.join(', ')}</div>}
        {(p.weapons ?? []).length > 0 && <div>Weapons: {p.weapons!.join(', ')}</div>}
        {(p.savingThrows ?? []).length > 0 && <div>Save proficiencies: {p.savingThrows!.join(', ')}</div>}
      </div>
    </Card>
  );
}

export function PersonalitySection({ sheet, ctx }: P) {
  const p = sheet.personality;
  if (!p) return null;
  const rows: [string, string[] | undefined][] = [['Trait', p.traits], ['Ideal', p.ideals], ['Bond', p.bonds], ['Flaw', p.flaws]];
  if (rows.every(([, v]) => !v?.length) && !p.notes) return null;
  return (
    <Card title="Personality" id="personality">
      {rows.flatMap(([label, list]) => (list ?? []).map((t, i) => <div class="small" key={label + i}><b>{label}:</b> {t}</div>))}
      {!shouldHideSecretIdentity(ctx, sheet.identity) && p.notes && <div class="small muted" style={{ marginTop: 6 }}>{p.notes}</div>}
    </Card>
  );
}

export function SoundBitesSection({ sheet, ctx }: P) {
  const visible = visibleSoundBites(ctx, sheet.cosmology?.soundBites ?? [], sheet.identity);
  if (!visible.length) return null;
  const groups: [string, typeof visible][] = [['Public', visible.filter((b) => !isSecretBite(b))], ['Secret', visible.filter(isSecretBite)]];
  return (
    <Card title="Sound bites" id="soundbites">
      {groups.filter(([, b]) => b.length).map(([label, bites]) => (
        <div key={label}>
          <h3>{label}</h3>
          <ul class="plain">
            {bites.map((b) => (
              <li key={b.id}>
                <div class="strong small">{b.prompt}</div>
                <div class="small">{b.answer}</div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}

export function BackstorySection({ sheet, ctx }: P) {
  const cos = sheet.cosmology;
  if (!cos || !canShowSecretBackstory(ctx, sheet.identity) || (!cosmologyOrigin(cos) && !cos.parents)) return null;
  return (
    <Card title="Backstory" id="backstory">
      {cosmologyOrigin(cos) && <div class="small pre">{cosmologyOrigin(cos)}</div>}
      {cos.parents?.faith && <div class="small">Parents' faith: {cos.parents.faith}</div>}
      {cos.parents?.fate && <div class="small">Parents' fate: {cos.parents.fate}</div>}
      {cos.parents?.godsResponse && <div class="small">Gods' response: {cos.parents.godsResponse}</div>}
    </Card>
  );
}

export function CosmologySection({ sheet, ctx }: P) {
  const cos = sheet.cosmology;
  if (!cos || (!cos.cultSymbol && !cos.entityToRelease && !cos.pantheon && !cosmologyBelief(cos))) return null;
  const hide = shouldHideSecretIdentity(ctx, sheet.identity);
  return (
    <Card title="Cult and cosmology" id="cosmology">
      {cos.cultSymbol && <div class="strong small">Symbol: {cos.cultSymbol}</div>}
      {cos.cultSymbolNotes && <div class="small muted">{cos.cultSymbolNotes}</div>}
      {!hide && (
        <>
          {cos.entityToRelease && <div class="small">Entity: {cos.entityToRelease}</div>}
          {cos.pantheon && <div class="small">Pantheon: {cos.pantheon}</div>}
          {cosmologyBelief(cos) && <div class="small">{cosmologyBelief(cos)}</div>}
        </>
      )}
    </Card>
  );
}

export function AppearanceSection({ sheet, ctx }: P) {
  const app = sheet.appearance as Record<string, unknown> | null | undefined;
  if (!app) return null;
  const hide = shouldHideSecretIdentity(ctx, sheet.identity);
  const s = (k: string) => (typeof app[k] === 'string' || typeof app[k] === 'number' ? String(app[k]) : null);
  const gs = app.greatStature as Record<string, string | number | null> | undefined;
  const desc = app.descriptions as Record<string, string | null> | undefined;
  return (
    <Card title="Appearance" id="appearance">
      {!hide && (
        <>
          {[s('age') && `Age: ${s('age')}`, s('height') && `Height: ${s('height')}`, s('weightLb') && `Weight: ${s('weightLb')} lb`].filter(Boolean).length > 0 && (
            <div class="small">{[s('age') && `Age: ${s('age')}`, s('height') && `Height: ${s('height')}`, s('weightLb') && `Weight: ${s('weightLb')} lb`].filter(Boolean).join(' · ')}</div>
          )}
          {s('physiqueNotes') && <div class="small muted">{s('physiqueNotes')}</div>}
          {gs && (
            <div class="small">
              {[gs.atLevel != null ? `At level ${gs.atLevel}` : null, gs.feature, gs.height ? `→ ${gs.height}` : null, gs.weightLb != null ? `→ ${gs.weightLb} lb` : null].filter(Boolean).join(' · ')}
              {gs.notes && <div class="tiny muted">{gs.notes}</div>}
            </div>
          )}
        </>
      )}
      {s('armorPresentation') && <div class="small">{s('armorPresentation')}</div>}
      {desc?.armoredHelmOn && <><h3>Armored; helm on</h3><div class="small">{desc.armoredHelmOn}</div></>}
      {!hide && (
        <>
          {desc?.armoredHelmOff && <><h3>Armored; helm off</h3><div class="small">{desc.armoredHelmOff}</div></>}
          {desc?.unarmored && <><h3>Unarmored</h3><div class="small">{desc.unarmored}</div></>}
          {s('cultTattoo') && <div class="small">Tattoo: {s('cultTattoo')}</div>}
          {s('underArmorLeotard') && <div class="small">Under armor: {s('underArmorLeotard')}</div>}
        </>
      )}
      {s('trophy') && <div class="small">Trophy: {s('trophy')}</div>}
    </Card>
  );
}

export function TableNotesSection({ sheet, ctx }: P) {
  const c = sheet.constraints;
  if (ctx.playerSafeMode || !c || (!(c.houseRules ?? []).length && !c.campaignTone)) return null;
  return (
    <Card title="Table notes" id="table">
      {c.campaignTone && <div class="small">{c.campaignTone}</div>}
      <ul class="small" style={{ paddingLeft: 18, margin: '6px 0' }}>
        {(c.houseRules ?? []).map((r) => <li key={r}>{r}</li>)}
      </ul>
      {c.sourceTier && <div class="tiny muted">Sources: {c.sourceTier}</div>}
    </Card>
  );
}

export function SpellsSection({ sheet }: { sheet: CharacterSheet }) {
  const sp = sheet.spells;
  if (!sp || (!(sp.cantrips ?? []).length && !(sp.known ?? []).length && !(sp.prepared ?? []).length && !Object.keys(sp.slots ?? {}).length && !sp.pactMagic)) return null;
  return (
    <Card title="Spells" id="spells">
      {sp.ability && <div class="small">Spellcasting: {sp.ability}</div>}
      {(sp.cantrips ?? []).length > 0 && <div class="small">Cantrips: {sp.cantrips!.join(', ')}</div>}
      {(sp.known ?? []).length > 0 && <div class="small">Known: {sp.known!.join(', ')}</div>}
      {(sp.prepared ?? []).length > 0 && <div class="small">Prepared: {sp.prepared!.join(', ')}</div>}
      {Object.entries(sp.slots ?? {}).map(([k, v]) => <div class="small" key={k}>Level {k} slots: {v}</div>)}
      {sp.pactMagic && sp.pactMagic.slots > 0 && <div class="small">Pact magic: {sp.pactMagic.slots} slot(s) of level {sp.pactMagic.level}</div>}
    </Card>
  );
}

/** Features without limited uses (Non-combat view) or all of them (Full view). Eclipse features hide with the alias. */
export function visibleFeatures(sheet: CharacterSheet, ctx: SheetViewContext, passiveOnly = false): Feature[] {
  const hide = shouldHideSecretIdentity(ctx, sheet.identity);
  return sheet.features.filter((f) => (!passiveOnly || !f.uses) && (!hide || !/eclipse/i.test(f.id)));
}

export function FeaturesSection({ features, title = 'Features and abilities', full }: { features: Feature[]; title?: string; full?: boolean }) {
  if (!features.length) return null;
  return (
    <Card title={title} id="features">
      <ul class="plain">
        {features.map((f) => (
          <li key={f.id}>
            {full ? (
              <>
                <div class="row between">
                  <span class="strong">{f.name}</span>
                  {f.uses && <span class="tag">{f.uses.max} / {restLabel(f.uses.per).replace('per ', '')}</span>}
                </div>
                {f.source && <div class="tiny" style={{ color: 'var(--accent)' }}>{f.source}</div>}
                <div class="small pre">{f.rulesText}</div>
              </>
            ) : (
              <RulesLink name={f.name} text={f.rulesText} meta={f.source ?? undefined} />
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function SourcesSection({ sheet }: { sheet: CharacterSheet }) {
  if (!(sheet.sources ?? []).length) return null;
  return (
    <Card title="Sources" id="sources">
      <ul class="plain">
        {sheet.sources!.map((s) => (
          <li key={s.url + s.topic} class="small">
            {s.topic}
            {s.url && <> — <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>{s.url}</a></>}
            {s.verifiedAt && <span class="muted"> ({s.verifiedAt})</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
