// Rekenblok op de homepage: wat levert slim schakelen jou per jaar op, met de echte prijzen van de afgelopen 30 dagen?
import { TOP3, PEIL, topLink } from '/js/top3.js';
const $ = id => document.getElementById(id);
const eur = v => '€ ' + Math.max(0, Math.round(v)).toLocaleString('nl-NL');
const ct = v => (v * 100).toFixed(1).replace('.', ',');
const VERLIES = 0.85; // 15% laad- en ontlaadverlies bij een thuisbatterij

// Verbruik per jaar dat je kunt verschuiven (kWh). Gemiddelden voor een Nederlands huishouden.
const APP = {
  was: { kwh: 150, groep: 'bericht' },
  droger: { kwh: 250, groep: 'bericht' },
  vaat: { kwh: 230, groep: 'bericht' },
  boiler: { kwh: 1500, groep: 'auto' },
  auto: { kwh: 2500, groep: 'auto' },
  batterij: { kwh: 1500, groep: 'auto' }, // 5 kWh per dag, 300 dagen per jaar
};

let P = null;
const uit = $('obUit');
if (uit) {
  fetch('/api/bespaar').then(r => r.json()).then(j => { if (j.error) throw new Error(j.error); P = j; reken(); })
    .catch(() => { uit.innerHTML = '<p class="muted small">De prijzen zijn even niet bereikbaar. Probeer het straks opnieuw.</p>'; });
  document.querySelectorAll('#obForm input').forEach(i => i.addEventListener('change', reken));
}

function winst(k) {
  const a = APP[k];
  if (k === 'batterij') return a.kwh * P.stroomDuur - (a.kwh / VERLIES) * P.stroomGoedkoop;
  return a.kwh * (P.stroom - P.stroomGoedkoop);
}

function reken() {
  if (!P) return;
  const aan = [...document.querySelectorAll('#obForm input:checked')].map(i => i.value);
  if (!aan.length) { uit.innerHTML = '<p class="muted">Vink aan wat je hebt. Dan rekenen we het uit.</p>'; return; }
  const som = { bericht: 0, auto: 0 };
  for (const k of aan) if (APP[k] && (k !== 'batterij' || P.stroomDuur)) som[APP[k].groep] += Math.max(0, winst(k));
  const totaal = som.bericht + som.auto;
  const conclusie = totaal < 100
    ? 'Met alleen deze apparaten is het verschil klein. Een vast contract met welkomstkorting kan dan net zo voordelig zijn. Zet je ook een boiler, auto of batterij automatisch aan, dan loopt het snel op.'
    : totaal < 250
      ? 'Dit is een mooi bedrag. Vergelijk het met de welkomstkorting van een vast contract: is je besparing hoger, dan wint dynamisch.'
      : 'Dit is meer dan wat de meeste mensen met alleen een berichtje besparen. Vooral automatisch schakelen levert veel op.';
  uit.innerHTML = `
    <div class="obkop">Ongeveer <b>${eur(totaal)} per jaar</b> goedkoper</div>
    <table class="obtabel"><tbody>
      ${som.bericht ? `<tr><td>Met een bericht <small>wasmachine, droger, vaatwasser</small></td><td>${eur(som.bericht)}</td></tr>` : ''}
      ${som.auto ? `<tr><td>Volledig automatisch <small>boiler, auto, thuisbatterij</small></td><td>${eur(som.auto)}</td></tr>` : ''}
    </tbody></table>
    <p class="obconcl">${conclusie}</p>
    ${totaal >= 100 ? `<h3 class="obtop">Nog geen dynamisch contract? De 3 goedkoopste:</h3>
    <ol class="top3">${TOP3.dynamisch.r.map(([, pak, pm, pad], i) => `<li><a href="${topLink(pad, 'rekenblok')}" target="_blank" rel="sponsored noopener"><span class="nr">${i + 1}</span><span><b>${pak}</b><small>Dynamisch · altijd opzegbaar</small></span><span class="pr">€ ${pm}<small> p/m</small></span></a></li>`).join('')}</ol>
    <p class="small muted" style="margin:6px 0 0">Advertentie. Stroom en gas samen bij 2.300 kWh en 1.000 m³, inclusief welkomstkorting, ${PEIL}.</p>` : ''}
    <p class="small muted" style="margin:10px 0 0">Indicatie, geen advies. Gerekend met de echte prijzen van de afgelopen 30 dagen: gemiddeld ${ct(P.stroom)} cent per kWh, in de goedkoopste uren ${ct(P.stroomGoedkoop)} cent${P.stroomDuur ? `, in de duurste uren ${ct(P.stroomDuur)} cent` : ''}. Met gemiddeld verbruik: wasmachine 150, droger 250, vaatwasser 230, boiler 1.500 en auto 2.500 kWh per jaar, thuisbatterij 5 kWh per dag met 15% verlies. <a href="/bespaarcheck/">Reken het precies uit met je eigen verbruik</a>.</p>`;
}
