// "Genera passphrase" panel, shared by the app and the extension.
import { h, clear } from './dom.js';
import { generatePassphrase, entropyBits, diceForFull, DEFAULT_WORDS } from '../core/verba.js';
import { WORDS } from '../core/wordlist.js';

// targets: the password inputs to fill (e.g. [passphrase, once more]).
export function generaPanel(targets) {
  const count = h('select', { 'aria-label': 'Number of words' },
    [6, 7, 8].map((n) => h('option', { value: n, selected: n === DEFAULT_WORDS }, `${n} words · ${Math.round(entropyBits(n))} bits`)));
  const dice = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'e.g. 4 1 6 2 2 5 3 …' });
  const out = h('div');
  const body = h('div', { class: 'panel', style: 'margin-top:8px' },
    h('p', { class: 'small' }, `Words drawn at random from ${WORDS.length} Italian, Latin, English and French words, by your device's cryptographic generator.`),
    h('label', { class: 'field', style: 'margin-top:10px' }, h('span', null, 'Length'), count),
    h('details', { style: 'margin-top:10px' },
      h('summary', { class: 'small', style: 'cursor:pointer' }, 'Alea iacta est · add your own dice (optional)'),
      h('p', { class: 'small' }, 'Roll an ordinary die and type the numbers. They are mixed with the device’s randomness, so the result is safe if either of the two is truly random.'),
      h('label', { class: 'field', style: 'margin-top:6px' }, h('span', null, 'Dice rolls (1–6)'), dice),
      h('p', { class: 'small dicehint' }, `${diceForFull(DEFAULT_WORDS)} rolls make the dice alone as strong as the result.`)),
    h('button', { class: 'btn block', style: 'margin-top:12px', type: 'button', onclick: async () => {
      clear(out);
      try {
        const r = await generatePassphrase({ count: Number(count.value), dice: dice.value });
        dice.value = '';
        const useBtn = h('button', { class: 'btn block', type: 'button', onclick: () => {
          for (const t of targets) { t.value = r.phrase; t.dispatchEvent(new Event('input')); }
          clear(out);
          out.append(h('div', { class: 'notice good', role: 'status' }, h('span', { class: 'head' }, 'Inserita'), 'Written into the fields. Keep the paper copy until you know it by heart.'));
        } }, 'USE THIS PASSPHRASE');
        out.append(
          h('div', { class: 'code', style: "font-family:'EB Garamond', Georgia, serif; font-weight:600; font-size:23px; letter-spacing:.02em; margin-top:12px" }, r.phrase),
          h('p', { class: 'small', style: 'margin:8px 0' }, `${Math.round(r.bits)} bits${r.diceUsed ? ` · ${r.diceUsed} dice rolls mixed in` : ''}. Write it on paper now. It is not stored anywhere.`),
          h('div', { class: 'row' }, useBtn,
            h('button', { class: 'btn ghost', type: 'button', onclick: () => body.querySelector('.btn.block').click() }, 'ANOTHER')));
      } catch (e) {
        out.append(h('div', { class: 'notice', role: 'alert' }, e.message));
      }
    } }, 'GENERA', h('small', null, 'draw the words')),
    out);
  body.hidden = true;
  const toggle = h('button', { class: 'btn ghost', type: 'button', style: 'min-height:40px; font-size:12px', onclick: () => { body.hidden = !body.hidden; } }, 'Genera passphrase');
  count.addEventListener('change', () => {
    const hint = body.querySelector('.dicehint');
    if (hint) hint.textContent = `${diceForFull(Number(count.value))} rolls make the dice alone as strong as the result.`;
  });
  return h('div', { style: 'margin-top:8px' }, toggle, body);
}
