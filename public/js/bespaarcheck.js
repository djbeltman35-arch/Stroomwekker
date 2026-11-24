// Bespaarcheck: wat had een dynamisch contract je gekost, met de echte prijzen van de afgelopen 30 dagen?
import { TOP3, PEIL, topLink } from '/js/top3.js';
const $ = id => document.getElementById(id);
const eur = v => '€ ' + Math.round(v).toLocaleString('nl-NL');
const ct = v => (v * 100).toFixed(1).replace('.', ',');
const getal = id => { const v = parseFloat(String($(id).value).replace(',', '.')); return Number.isFinite(v) ? v : null; };
let P = null;
fetch('/api/bespaar').then(r => r.json()).then(j => { if (j.error) throw new Error(j.error); P = j; reken(); })
  .catch(e => { $('bcUit').innerHTML = `<p class="msg err">${e.message || 'De prijzen zijn even niet bereikbaar.'}</p>`; });

function reken() {
  if (!P) return;
  const kwh = getal('bcKwh') ?? 2300, m3 = getal('bcM3') ?? 0;
  const pS = getal('bcPs') ?? 0.36, pG = getal('bcPg') ?? 1.95, schuif = Number($('bcSchuif').value);
  const nu = kwh * pS + m3 * pG;
  const dyn = kwh * P.stroom + m3 * (P.gas ?? pG);
  const slim = dyn - schuif * kwh * (P.stroom - P.stroomGoedkoop);
  const verschil = nu - slim;
  const kop = verschil > 25 ? `Je bespaart ongeveer <b>${eur(verschil)} per jaar</b>` : verschil > -25 ? 'Het scheelt weinig' : `Een dynamisch contract was <b>${eur(-verschil)} per jaar duurder</b> geweest`;
  $('bcUit').innerHTML = `
    <div class="bckop">${kop}</div>
    <table class="tabel"><tbody>
      <tr><td>Wat je nu ongeveer betaalt</td><td>${eur(nu)} per jaar</td></tr>
      <tr><td>Met een dynamisch contract</td><td>${eur(dyn)} per jaar</td></tr>
      <tr><td>Dynamisch én slim schakelen met Stroomwekker</td><td><b>${eur(slim)} per jaar</b></td></tr>
    </tbody></table>
    <p class="small muted">Gerekend met de echte prijzen van ${P.van.split('-').reverse().join('-')} tot ${P.tot.split('-').reverse().join('-')}: stroom gemiddeld ${ct(P.stroom)} cent per kWh, in de goedkoopste uren ${ct(P.stroomGoedkoop)} cent${P.gas ? `, gas ${('€ ' + P.gas.toFixed(2)).replace('.', ',')} per m³` : ''}. Inclusief belasting en een gemiddelde opslag. Vaste kosten, netbeheerkosten en welkomstkorting zijn niet meegeteld. Dertig dagen zijn geen heel jaar: in de zomer is stroom vaak goedkoper. Dit is een schatting, geen advies.</p>
    ${verschil > -25 ? `<h3 style="margin:18px 0 8px">De 3 goedkoopste dynamische contracten</h3>
    <ol class="top3">${TOP3.dynamisch.r.map(([lev, pak, pm, pad], i) => `<li><a href="${topLink(pad, 'bespaarcheck')}" target="_blank" rel="sponsored noopener"><span class="nr">${i + 1}</span><span><b>${lev}</b><small>${pak}</small></span><span class="pr">€ ${pm}<small> p/m</small></span></a></li>`).join('')}</ol>
    <p class="small muted">Advertentie. Bedragen per maand voor stroom en gas samen bij 2.300 kWh en 1.000 m³, inclusief welkomstkorting, ${PEIL}. Controleer de voorwaarden bij het energiebedrijf voordat je overstapt.</p>` : '<p>Blijf dan bij je huidige contract, of kijk of een vast contract goedkoper is.</p>'}`;
}
document.querySelectorAll('#bcForm input, #bcForm select').forEach(i => i.addEventListener('input', reken));
