// Top 3 goedkoopste energiecontracten (stroom en gas samen), per soort contract.
// Dit bestand wordt elke maand bijgewerkt (zie de maandelijkse taak). Alleen de lijsten en PEIL aanpassen.
// Bron: ranglijsten van de vergelijker (november 2026), bij 2.300 kWh stroom en 1.000 m³ gas per jaar, inclusief welkomstkorting.
// Elke maand bijwerken: de volgorde verandert met de tarieven.
export const PEIL = 'november 2026';
const aw = (u, ref) => `https://www.awin1.com/cread.php?awinmid=8520&awinaffid=3152283&clickref=stroomwekker-${ref}&ued=${encodeURIComponent(u)}`;
export const topLink = (pad, ref = 'top3') => aw('https://www.gaslicht.com' + pad, ref);
export const TOP3 = {
  dynamisch: { l: 'Dynamisch', uitleg: 'Prijs per kwartier. Gebruik stroom als het goedkoop is en bespaar. Altijd opzegbaar', r: [
    ['Budget Thuis', 'Europese groene stroom en aardgas', 195, '/aanmelden/budgetthuis/5120/europese-groene-stroom-en-aardgas-dynamisch'],
    ['NextEnergy', 'Groene stroom en aardgas', 197, '/aanmelden/nextenergy/5082/groene-stroom-en-aardgas-dynamisch'],
    ['Vandebron', 'NL groene stroom en aardgas', 197, '/aanmelden/vandebron/5232/nl-groene-stroom-en-aardgas-met-investering-in-lokale-natuur-dynamisch'],
  ] },
  vast1: { l: '1 jaar vast', uitleg: 'Een jaar lang dezelfde prijs', r: [
    ['Energiedirect', 'Groene stroom en aardgas 1 jaar', 227, '/energie-vergelijken/energiedirect/groene-stroom-en-aardgas-1-jr-vast-5017'],
    ['Eneco', 'Hollandse wind en zon en aardgas 1 jaar', 231, '/energie-vergelijken/eneco/hollandse-wind-en-zon-en-aardgas-1-jaar-vast-4850'],
    ['Greenchoice', 'Groene stroom en aardgas 1 jaar', 231, '/aanmelden/greenchoice/5279/nederlandse-groene-stroom-en-aardgas-met-natuur-voor-morgen-1-jaar-vast-actie'],
  ] },
  vast3: { l: '3 jaar vast', uitleg: 'Drie jaar zekerheid', r: [
    ['Budget Thuis', 'Europese groene stroom en aardgas 3 jaar', 202, '/aanmelden/budgetthuis/5046/europese-groene-stroom-en-aardgas-vast-3-jaar'],
    ['Energiedirect', 'Groene stroom en aardgas 3 jaar', 204, '/aanmelden/energiedirect/5018/groene-stroom-en-aardgas-3-jaar-vast'],
    ['Vandebron', 'Groene stroom en gas 3 jaar', 206, '/aanmelden/vandebron/4992/100-procent-groene-stroom-en-co2-gecompenseerd-gas-3-jaar-vast'],
  ] },
  variabel: { l: 'Variabel', uitleg: 'Elke dag dezelfde prijs, maar die kan elke maand veranderen. Altijd opzegbaar', r: [
    ['Frank Energie', 'Groene stroom en aardgas variabel', 245, '/energie-vergelijken/frank-energie/nederlandse-groene-stroom-en-aardgas-variabel-4892'],
    ['Greenchoice', 'Windstroom en aardgas variabel', 252, '/energie-vergelijken/greenchoice/windstroom-uit-nederland-en-co2-gecompenseerd-gas-variabel-5051'],
    ['Mega', 'EU groene stroom en aardgas variabel', 255, '/energie-vergelijken/mega/eu-groene-stroom-en-aardgas-variabel-4816'],
  ] },
};
