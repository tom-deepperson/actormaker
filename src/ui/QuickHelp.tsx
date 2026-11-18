/** Quick rules reference for the table. Port of archive/android/.../ui/QuickHelpSheet.kt and data/HelpContentLoader.kt. */
import { useState } from 'preact/hooks';
import combat14 from '../assets/help/2014/combat.md?raw';
import nonCombat14 from '../assets/help/2014/non_combat.md?raw';
import combat24 from '../assets/help/2024/combat.md?raw';
import nonCombat24 from '../assets/help/2024/non_combat.md?raw';
import { Dialog } from './common';

export type HelpTopic = 'combat' | 'noncombat';

export interface HelpDoc { title: string; sections: { heading: string; body: string }[] }

/** 2024 sheets get the 2024 reference; anything else (including no edition) gets 2014, as on Android. */
export function helpMarkdown(topic: HelpTopic, edition: string | null | undefined): string {
  const is2024 = edition?.trim() === '2024';
  if (topic === 'combat') return is2024 ? combat24 : combat14;
  return is2024 ? nonCombat24 : nonCombat14;
}

export function parseHelp(md: string): HelpDoc {
  let title = '';
  const sections: HelpDoc['sections'] = [];
  for (const line of md.replace(/\r/g, '').split('\n')) {
    if (line.startsWith('# ')) title = line.slice(2).trim();
    else if (line.startsWith('## ')) sections.push({ heading: line.slice(3).trim(), body: '' });
    else if (sections.length && line.trim()) {
      const s = sections[sections.length - 1];
      s.body = s.body ? `${s.body}\n${line.trim()}` : line.trim();
    }
  }
  return { title, sections };
}

export function QuickHelpButton({ topic, edition }: { topic: HelpTopic; edition: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const doc = parseHelp(helpMarkdown(topic, edition));
  return (
    <>
      <button class="fab-help" aria-label={topic === 'combat' ? 'Combat quick reference' : 'Skills and exploration quick reference'} onClick={() => setOpen(true)}>
        ?
      </button>
      {open && (
        <Dialog title={doc.title || 'Quick reference'} onClose={() => setOpen(false)}>
          {doc.sections.map((s) => (
            <div key={s.heading}>
              <div class="strong">{s.heading}</div>
              <div class="small pre">{s.body}</div>
            </div>
          ))}
        </Dialog>
      )}
    </>
  );
}
