#!/usr/bin/env python3
"""Maakt de inhoudspagina's (over, rekenmethode, gids) op basis van de opmaak van /hoe-werkt-het/.
Pas teksten hier aan en draai: python3 scripts/paginas.py"""
import json, re, pathlib, html

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUB = ROOT / 'public'
SITE = 'https://stroomwekker.eu'
VANDAAG = '2026-11-22'
VANDAAG_NL = '22 november 2026'
AUTEUR = {'@type': 'Person', '@id': SITE + '/over/#erik', 'name': 'Erik Beltman', 'url': SITE + '/over/'}
ORG = {'@type': 'Organization', '@id': SITE + '/#org', 'name': 'Stroomwekker', 'url': SITE + '/', 'logo': SITE + '/icons/icon-512.png'}

basis = (PUB / 'hoe-werkt-het/index.html').read_text()
HEAD = basis[:basis.index('</head>')]
HEAD = re.sub(r'<script type="application/ld\+json">.*?</script>\n?', '', HEAD, flags=re.S)
HEADER = basis[basis.index('</head>'):basis.index('</header>') + len('</header>')].replace(' aria-current="page"', '')
FOOTER = basis[basis.index('</main>'):]
EXTRA_CSS = '''<style>
.byline{color:#C9D4E5;font-size:14.5px;margin:14px 0 0}
.pagina h3{margin:18px 0 6px}
.pagina .card ul,.pagina .card ol{margin:0 0 10px;padding-left:22px;font-size:16.5px}
.pagina .card li{margin:4px 0}
.gidslijst{list-style:none;padding:0!important;margin:0;display:grid;gap:10px}
.gidslijst a{display:block;border:1px solid var(--line);border-radius:8px;padding:14px 16px;text-decoration:none;color:var(--ink);background:var(--surface)}
.gidslijst a b{display:block;font-size:17px}.gidslijst a span{color:var(--muted);font-size:15px}
.bronnen{font-size:14.5px;color:var(--muted)}
.lees{border-top:1px solid var(--line);margin-top:16px;padding-top:12px;font-size:15.5px}
</style>
'''


def esc(s): return html.escape(s, quote=True)


def maak(pad, title, desc, h1, intro, body, soort='Article', kruimels=None, extra_ld=None, byline=True):
    url = SITE + pad
    h = HEAD
    h = re.sub(r'<title>.*?</title>', f'<title>{esc(title)}</title>', h)
    for prop in ('name="description"', 'property="og:description"'):
        h = re.sub(rf'(<meta {prop} content=")[^"]*', lambda m: m.group(1) + esc(desc), h)
    h = re.sub(r'(<meta property="og:title" content=")[^"]*', lambda m: m.group(1) + esc(title), h)
    h = re.sub(r'(<link rel="canonical" href=")[^"]*', lambda m: m.group(1) + url, h)
    h = re.sub(r'(<meta property="og:url" content=")[^"]*', lambda m: m.group(1) + url, h)
    h = re.sub(r'(<meta property="og:type" content=")[^"]*', lambda m: m.group(1) + ('article' if soort == 'Article' else 'website'), h)
    kr = [('Stroomwekker', SITE + '/')] + (kruimels or []) + [(h1, url)]
    graph = [{'@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': i + 1, 'name': n, 'item': u} for i, (n, u) in enumerate(kr)]}]
    if soort == 'Article':
        graph.insert(0, {'@type': 'Article', 'headline': h1, 'description': desc, 'inLanguage': 'nl-NL',
                         'author': AUTEUR, 'publisher': ORG, 'datePublished': VANDAAG, 'dateModified': VANDAAG,
                         'mainEntityOfPage': url, 'image': SITE + '/og.png'})
    graph += extra_ld or []
    ld = json.dumps({'@context': 'https://schema.org', '@graph': graph}, ensure_ascii=False).replace('</', '<\\/')
    h += EXTRA_CSS + f'<script type="application/ld+json">\n{ld}\n</script>\n'
    by = f'<p class="byline">Door <a href="/over/" style="color:#fff">Erik Beltman</a> · bijgewerkt op {VANDAAG_NL}</p>' if byline else ''
    terug = '<a class="terug" href="/gids/">&larr; Alle uitleg en tips</a>' if pad.startswith('/gids/') and pad != '/gids/' else '<a class="terug" href="/">&larr; Terug naar de startpagina</a>'
    out = h + HEADER + f'''
<div class="pkop"><div class="wrap pagina">
  {terug}
  <h1>{h1}</h1>
  <p>{intro}</p>
  {by}
</div></div>

<main class="wrap pagina">
{body}
''' + FOOTER
    f = PUB / pad.strip('/') / 'index.html'
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(out)
    print('gemaakt', pad)


def faq_ld(paren):
    return {'@type': 'FAQPage', 'mainEntity': [{'@type': 'Question', 'name': q,
            'acceptedAnswer': {'@type': 'Answer', 'text': re.sub(r'<[^>]+>', '', a)}} for q, a in paren]}


def faq_html(paren):
    return '<section class="card faq"><h2>Veelgestelde vragen</h2>\n' + '\n'.join(
        f'<details><summary>{q}</summary><p>{a}</p></details>' for q, a in paren) + '\n</section>'


CTA = '''<section class="card">
  <h2>Laat het vanzelf gaan</h2>
  <p>Stroomwekker zet je slimme stekker, boiler of laadpaal vanzelf aan in de goedkoopste kwartieren. Je hoeft zelf niet op de prijs te letten.</p>
  <div class="cta"><a class="btn" href="/?start=apparaat">Apparaat koppelen</a><a class="btn btn-line" href="/stroomprijs-vandaag/">Stroomprijs vandaag</a></div>
</section>'''

GIDSEN = [
    ('/gids/dynamisch-energiecontract/', 'Wat is een dynamisch energiecontract?', 'Hoe het werkt, voor wie het loont en waar je op let.'),
    ('/gids/stroomprijs-per-kwartier/', 'Waarom verandert de stroomprijs elk kwartier?', 'Sinds oktober 2025 per kwartier: wat dat voor je betekent.'),
    ('/gids/negatieve-stroomprijs/', 'Negatieve stroomprijs: gratis stroom en zonnepanelen', 'Wanneer het gebeurt en wat je dan doet.'),
    ('/gids/action-slimme-stekker-koppelen/', 'Slimme stekker van de Action automatisch laten schakelen', 'Stap voor stap: LSC-stekker via Smart Life koppelen.'),
    ('/gids/thuisbatterij-dynamisch-contract/', 'Thuisbatterij met een dynamisch contract', 'Wanneer laden, wanneer leveren, en wanneer het loont.'),
    ('/gids/saldering-stopt-2027/', 'Saldering stopt in 2027: wat betekent dat?', 'Zonnepanelen, terugleveren en een dynamisch contract.'),
]


def lees_ook(huidig):
    links = [f'<a href="{p}">{t}</a>' for p, t, _ in GIDSEN if p != huidig][:3]
    return '<p class="lees"><b>Lees ook:</b> ' + ' · '.join(links) + '</p>'


BRONNEN_ALG = '<p class="bronnen">Bronnen: Energy-Charts van Fraunhofer ISE (EPEX day-ahead Nederland), EnergyZero, Rijksoverheid.nl (energiebelasting en salderingsregeling).</p>'

# ---------------- Over ----------------
maak('/over/', 'Over Stroomwekker en de maker | Stroomwekker',
     'Wie maakt Stroomwekker, waarom, en hoe de site onafhankelijk blijft. Gemaakt door Erik Beltman om mensen met een dynamisch energiecontract geld te laten besparen.',
     'Over Stroomwekker', 'Wie het maakt, waarom, en hoe we eerlijk en onafhankelijk blijven.', '''
  <section class="card">
    <h2>Waarom Stroomwekker bestaat</h2>
    <p>Met een dynamisch energiecontract kun je veel besparen. Maar alleen als je stroom gebruikt op de goedkope momenten. Wie heeft er tijd om elk kwartier naar de prijs te kijken? Niemand.</p>
    <p>Daarom is Stroomwekker gemaakt. De site kijkt elk kwartier naar de stroomprijs en zet je apparaten vanzelf aan als stroom goedkoop is. Zo bespaar je zonder er moeite voor te doen.</p>
  </section>
  <section class="card" id="erik">
    <h2>Wie maakt het?</h2>
    <p>Stroomwekker is gemaakt door <b>Erik Beltman</b>. Erik maakt websites en apps die mensen helpen geld te besparen in deze dure tijden. Van hem zijn ook <a href="https://bespaarvriend.nl/" rel="noopener">Bespaarvriend</a>, <a href="https://boodschappenvergelijk.nl/" rel="noopener">Boodschappenvergelijk</a>, <a href="https://goedkopertanken.netlify.app/" rel="noopener">Tankwijzer</a> en <a href="https://salderingscheck-nl.netlify.app/" rel="noopener">Salderingscheck</a>.</p>
    <p>Alles wordt in gewone woorden uitgelegd. Je hoeft niets van techniek te weten.</p>
  </section>
  <section class="card">
    <h2>Onafhankelijk</h2>
    <p>Stroomwekker is <b>geen energiebedrijf</b> en verkoopt geen stroom. Het maakt voor ons niet uit bij welk bedrijf je zit. De prijzen komen rechtstreeks van de Europese stroombeurs.</p>
    <p>Lager op de startpagina staan tegels van vergelijkingssites. Kies je via zo'n tegel een contract, dan krijgt Stroomwekker soms een klein bedrag. Jij betaalt niets extra. Dat heeft geen invloed op de prijzen of de uitleg op deze site.</p>
  </section>
  <section class="card">
    <h2>Waar komen de cijfers vandaan?</h2>
    <p>De stroomprijzen komen van <b>Energy-Charts</b> (Fraunhofer ISE), dat de officiële dagprijzen van de Europese stroombeurs EPEX publiceert. Voor de prijzen van morgen en voor gas gebruiken we ook <b>EnergyZero</b>. Belastingen nemen we over van de Rijksoverheid.</p>
    <p>Precies lezen hoe we rekenen? Kijk bij <a href="/zo-rekenen-wij/">Zo berekenen wij de prijs</a>.</p>
  </section>
  <section class="card">
    <h2>Contact</h2>
    <p>Een vraag, een fout gezien of een idee? Stuur een bericht via het <a href="/contact/">contactformulier</a> of mail naar info@stroomwekker.eu. Je krijgt zo snel mogelijk antwoord.</p>
  </section>''', soort='AboutPage', extra_ld=[
    {'@type': 'AboutPage', 'name': 'Over Stroomwekker', 'url': SITE + '/over/', 'inLanguage': 'nl-NL', 'about': ORG, 'mainEntity': AUTEUR},
    dict(AUTEUR, jobTitle='Maker van Stroomwekker', worksFor={'@id': SITE + '/#org'},
         sameAs=['https://bespaarvriend.nl/', 'https://boodschappenvergelijk.nl/'],
         knowsAbout=['Dynamische energiecontracten', 'Stroomprijzen', 'Slimme stekkers', 'Thuisbatterijen', 'Besparen op energie'])],
     byline=False)

# ---------------- Rekenmethode ----------------
maak('/zo-rekenen-wij/', 'Zo berekenen wij de stroomprijs: formule en bronnen',
     'Hoe Stroomwekker de dynamische stroomprijs berekent: beursprijs per kwartier plus btw, energiebelasting en inkoopvergoeding. Met bronnen, voorbeeld en updatetijden.',
     'Zo berekenen wij de stroomprijs', 'Open en controleerbaar: de bron, de formule en een rekenvoorbeeld.', '''
  <section class="card">
    <h2>De formule</h2>
    <p>De prijs die je bij Stroomwekker ziet, is wat je ongeveer per kWh betaalt met een dynamisch contract:</p>
    <p><b>beursprijs × 1,21 (btw) + energiebelasting + inkoopvergoeding</b></p>
    <ul>
      <li><b>Beursprijs</b>: de prijs per kwartier op de Europese stroombeurs (EPEX day-ahead, Nederland), zonder btw.</li>
      <li><b>Btw</b>: 21 procent.</li>
      <li><b>Energiebelasting 2026</b>: € 0,11085 per kWh, inclusief btw.</li>
      <li><b>Inkoopvergoeding</b>: wat je energiebedrijf extra rekent. Wij gaan uit van € 0,02 per kWh. Rekent jouw bedrijf iets anders? Stel het in bij Instellingen, dan rekent alles met jouw bedrag.</li>
    </ul>
    <p>Vaste kosten, zoals netbeheerkosten en vaste leveringskosten, zitten er niet in. Die betaal je per maand, hoeveel stroom je ook gebruikt. De vermindering energiebelasting krijg je ook los daarvan.</p>
  </section>
  <section class="card">
    <h2>Rekenvoorbeeld</h2>
    <p>Stel: de beursprijs is € 0,08 per kWh.</p>
    <ul>
      <li>€ 0,08 × 1,21 = € 0,0968</li>
      <li>+ energiebelasting € 0,11085 = € 0,20765</li>
      <li>+ inkoopvergoeding € 0,02 = <b>€ 0,22765</b>, ongeveer 22,8 cent per kWh</li>
    </ul>
    <p>Is de beursprijs lager dan ongeveer min 10,8 cent? Dan is de stroom helemaal gratis of krijg je er geld bij.</p>
  </section>
  <section class="card">
    <h2>Bronnen en updates</h2>
    <ul>
      <li><a href="https://www.energy-charts.info/" rel="noopener"><b>Energy-Charts</b></a> van Fraunhofer ISE: officiële day-ahead prijzen per kwartier voor Nederland (licentie CC BY 4.0).</li>
      <li><b>EnergyZero</b>: prijzen van morgen zodra die er zijn, en de gasprijs per dag (inclusief belasting).</li>
      <li><b>Rijksoverheid</b>: tarieven van de energiebelasting.</li>
    </ul>
    <p>De beurs maakt de prijzen voor de volgende dag elke middag rond 13:00 uur bekend. Stroomwekker haalt ze direct op en controleert daarna elk kwartier of je apparaten aan of uit moeten.</p>
    <p>We doen ons best, maar een fout kan altijd. De rekening van je energiebedrijf is leidend. Zie je iets wat niet klopt? <a href="/contact/">Laat het ons weten</a>.</p>
  </section>
  <section class="card">
    <h2>Goedkoop, normaal of duur</h2>
    <p>We verdelen alle kwartieren van een dag in drie even grote groepen. Het goedkoopste derde noemen we <b>goedkoop</b>, het duurste derde <b>duur</b>. Zo zie je altijd hoe een moment zich verhoudt tot de rest van de dag.</p>
  </section>''')

# ---------------- Gids index ----------------
items = '\n'.join(f'<li><a href="{p}"><b>{t}</b><span>{s}</span></a></li>' for p, t, s in GIDSEN)
maak('/gids/', 'Uitleg en tips over dynamische stroomprijzen | Stroomwekker',
     'Heldere uitleg in gewone woorden: dynamisch energiecontract, kwartierprijzen, negatieve stroomprijs, slimme stekkers, thuisbatterij en het einde van saldering.',
     'Uitleg en tips', 'Alles over dynamische stroomprijzen, in gewone woorden.', f'''
  <section class="card">
    <h2>Kies een onderwerp</h2>
    <ul class="gidslijst">
{items}
    </ul>
  </section>
  <section class="card">
    <h2>Meer van Stroomwekker</h2>
    <p><a href="/stroomprijs-vandaag/">Stroomprijs vandaag</a> · <a href="/stroomprijs-morgen/">Stroomprijs morgen</a> · <a href="/hoe-werkt-het/">Hoe werkt het?</a> · <a href="/zo-rekenen-wij/">Zo berekenen wij de prijs</a></p>
  </section>''', soort='CollectionPage', extra_ld=[{'@type': 'CollectionPage', 'name': 'Uitleg en tips', 'url': SITE + '/gids/', 'inLanguage': 'nl-NL',
    'hasPart': [{'@type': 'Article', 'headline': t, 'url': SITE + p} for p, t, _ in GIDSEN]}], byline=False)

G = [('Uitleg en tips', SITE + '/gids/')]

# ---------------- Gids: dynamisch contract ----------------
fq = [('Is een dynamisch contract goedkoper dan een vast contract?', 'Vaak wel, maar niet altijd. Gebruik je veel stroom op goedkope momenten, bijvoorbeeld \'s nachts of op zonnige middagen, dan bespaar je meestal. Gebruik je vooral stroom rond etenstijd, dan kan een vast contract voordeliger zijn.'),
      ('Heb ik een slimme meter nodig?', 'Ja. Zonder slimme meter kan je energiebedrijf niet zien hoeveel stroom je per kwartier gebruikt.'),
      ('Hoe vaak verandert de prijs?', 'De stroomprijs verandert elk kwartier, dus 96 keer per dag. De gasprijs verandert één keer per dag.'),
      ('Kan ik zomaar overstappen?', 'Een dynamisch contract kun je meestal per maand opzeggen. Kijk wel of je huidige contract een opzegboete heeft.')]
maak('/gids/dynamisch-energiecontract/', 'Dynamisch energiecontract: uitleg, voor- en nadelen | Stroomwekker',
     'Een dynamisch energiecontract volgt de beursprijs per kwartier. Lees in gewone woorden hoe het werkt, voor wie het loont, de voor- en nadelen en hoe je het meeste bespaart.',
     'Wat is een dynamisch energiecontract?', 'Hoe het werkt, voor wie het loont en hoe je het meeste bespaart.', f'''
  <section class="card">
    <h2>In het kort</h2>
    <p>Bij een dynamisch energiecontract betaal je niet elke dag dezelfde prijs. Je betaalt de prijs van de stroombeurs, plus belasting en een kleine vergoeding voor je energiebedrijf. De stroomprijs verandert <b>elk kwartier</b>. De gasprijs verandert <b>elke dag</b>.</p>
    <p>Soms is stroom heel goedkoop, bijvoorbeeld als het hard waait of de zon fel schijnt. Soms is het duur, vooral 's ochtends en tussen 17:00 en 21:00 uur, als iedereen thuis kookt.</p>
  </section>
  <section class="card">
    <h2>Voor wie loont het?</h2>
    <ul>
      <li>Je kunt stroom <b>verschuiven</b>: wasmachine, vaatwasser, droger of boiler aan als het goedkoop is.</li>
      <li>Je hebt een <b>elektrische auto</b> die je 's nachts of op zonnige middagen laadt.</li>
      <li>Je hebt een <b>thuisbatterij</b> of <b>warmtepomp</b> die slim kan laden.</li>
      <li>Je hebt <b>zonnepanelen</b>. Na 2027 is het extra belangrijk wanneer je stroom gebruikt.</li>
    </ul>
    <p>Gebruik je vooral stroom op dure momenten en wil je niets veranderen? Dan is een vast contract vaak rustiger.</p>
  </section>
  <section class="card">
    <h2>Voordelen en nadelen</h2>
    <h3>Voordelen</h3>
    <ul><li>Je profiteert direct van lage prijzen, soms zelfs gratis stroom.</li><li>Geen dure vaste prijs voor een jaar of langer.</li><li>Meestal per maand opzegbaar.</li></ul>
    <h3>Nadelen</h3>
    <ul><li>De prijs is niet vooraf voor het hele jaar bekend.</li><li>In een koude, windstille winter kan stroom duur zijn.</li><li>Je bespaart alleen echt als je stroom op goede momenten gebruikt.</li></ul>
  </section>
  <section class="card">
    <h2>Zo bespaar je het meest</h2>
    <p>Het makkelijkst is het als je apparaten <b>vanzelf</b> aangaan op goedkope momenten. Dat doet Stroomwekker: je koppelt één keer een slimme stekker, en daarna gaat je apparaat elke dag in de goedkoopste kwartieren aan. De prijzen van morgen zijn elke middag rond 13:00 uur bekend. Bekijk ze bij <a href="/stroomprijs-morgen/">stroomprijs morgen</a>.</p>
    {lees_ook('/gids/dynamisch-energiecontract/')}
  </section>
{faq_html(fq)}
{CTA}''', kruimels=G, extra_ld=[faq_ld(fq)])

# ---------------- Gids: kwartierprijzen ----------------
maak('/gids/stroomprijs-per-kwartier/', 'Stroomprijs per kwartier: waarom 96 prijzen per dag? | Stroomwekker',
     'Sinds oktober 2025 wordt stroom op de beurs per kwartier verhandeld in plaats van per uur. Wat dat betekent voor je dynamische contract en hoe je ervan profiteert.',
     'Waarom verandert de stroomprijs elk kwartier?', 'Van 24 naar 96 prijzen per dag: wat dat voor je betekent.', f'''
  <section class="card">
    <h2>Van uur naar kwartier</h2>
    <p>Vroeger had stroom op de Europese beurs één prijs per uur. Sinds oktober 2025 is dat <b>één prijs per kwartier</b>. Een dag heeft nu dus 96 stroomprijzen in plaats van 24.</p>
    <p>De reden: zon- en windstroom veranderen snel. Met kwartierprijzen sluit de prijs beter aan op wat er echt op het stroomnet gebeurt. Er is minder verspilling en het net blijft beter in balans.</p>
  </section>
  <section class="card">
    <h2>Wat betekent het voor jou?</h2>
    <ul>
      <li>Binnen één uur kan de prijs flink verschillen. Het eerste kwartier kan goedkoop zijn en het laatste duur.</li>
      <li>Wie precies op het goedkoopste kwartier inschakelt, bespaart meer dan wie per uur kijkt.</li>
      <li>Zelf elk kwartier opletten is ondoenlijk. Automatisch schakelen werkt daarom het best.</li>
    </ul>
    <p>Stroomwekker werkt helemaal per kwartier. Elk kwartier kijken we of je apparaat aan of uit moet. Alle 96 prijzen van vandaag zie je bij <a href="/stroomprijs-vandaag/">stroomprijs vandaag</a>.</p>
  </section>
  <section class="card">
    <h2>Wanneer zijn de prijzen bekend?</h2>
    <p>De beurs maakt de prijzen voor de hele volgende dag elke middag rond <b>13:00 uur</b> bekend. Vanaf dat moment weet je precies wanneer stroom morgen goedkoop is. Stroomwekker kan je dan een bericht sturen.</p>
    {lees_ook('/gids/stroomprijs-per-kwartier/')}
  </section>
{CTA}''', kruimels=G)

# ---------------- Gids: negatieve prijs ----------------
fq = [('Krijg ik echt geld als ik stroom gebruik?', 'Alleen als de beursprijs zo laag is dat ook de belasting en de inkoopvergoeding worden goedgemaakt. Met de bedragen van 2026 is dat bij een beursprijs onder ongeveer min 10,8 cent per kWh. Dat gebeurt niet vaak.'),
      ('Moet ik mijn zonnepanelen uitzetten bij een negatieve prijs?', 'Met een dynamisch contract kost terugleveren je dan geld. Uitzetten of zelf de stroom gebruiken is dan slim. Laat het uitzetten van je omvormer wel regelen door een installateur.'),
      ('Hoe weet ik van tevoren dat de prijs negatief wordt?', 'De prijzen van morgen zijn rond 13:00 uur bekend. Stroomwekker stuurt je dan een bericht als er negatieve prijzen aankomen.')]
maak('/gids/negatieve-stroomprijs/', 'Negatieve stroomprijs: wat doe je met zonnepanelen? | Stroomwekker',
     'Bij een negatieve stroomprijs is stroom op de beurs minder dan niets waard. Lees wanneer het gebeurt, wanneer je echt gratis stroom hebt en wat je met je zonnepanelen doet.',
     'Negatieve stroomprijs: gratis stroom en zonnepanelen', 'Wanneer het gebeurt, wat je ervan merkt en wat je dan het beste doet.', f'''
  <section class="card">
    <h2>Wat is een negatieve stroomprijs?</h2>
    <p>Soms wordt er meer stroom gemaakt dan er gebruikt wordt. Bijvoorbeeld op een zonnige, winderige zondag, als fabrieken en kantoren dicht zijn. De beursprijs zakt dan onder nul. Wie stroom levert, moet dan betalen. Wie stroom gebruikt, krijgt er geld bij.</p>
    <p>Dit gebeurt vooral in het voorjaar en de zomer, rond het middaguur, en vaker in het weekend.</p>
  </section>
  <section class="card">
    <h2>Is de stroom dan gratis?</h2>
    <p>Niet altijd. Over elke kWh betaal je ook energiebelasting en een inkoopvergoeding. Pas als de beursprijs lager is dan ongeveer <b>min 10,8 cent</b>, is de stroom helemaal gratis of krijg je geld toe. Bij een kleinere negatieve prijs is stroom wel heel goedkoop. Hoe we rekenen, lees je bij <a href="/zo-rekenen-wij/">zo berekenen wij de prijs</a>.</p>
  </section>
  <section class="card">
    <h2>Wat doe je met zonnepanelen?</h2>
    <p>Met een dynamisch contract krijg je voor teruggeleverde stroom de beursprijs. Is die negatief, dan <b>kost terugleveren je geld</b>. Slim is dan:</p>
    <ul>
      <li>Zelf zoveel mogelijk stroom gebruiken: wasmachine, vaatwasser, boiler, auto laden, thuisbatterij vullen.</li>
      <li>De zonnepanelen tijdelijk uitzetten of minder laten leveren. Veel omvormers kunnen dat, maar laat dit door een installateur instellen.</li>
    </ul>
    <p>Stroomwekker stuurt je een bericht zodra er negatieve prijzen aankomen, en kan je apparaten op die momenten vanzelf aanzetten.</p>
    {lees_ook('/gids/negatieve-stroomprijs/')}
  </section>
{faq_html(fq)}
{CTA}''', kruimels=G, extra_ld=[faq_ld(fq)])

# ---------------- Gids: Action stekker ----------------
stappen = [
    ('Zet je stekker in de app Smart Life', 'Met de app van de Action (LSC Smart Connect) lukt koppelen niet. Smart Life gebruikt dezelfde techniek. Verwijder je stekker in LSC Smart Connect, download de gratis app Smart Life en voeg de stekker daar toe. Gaat het lampje niet knipperen? Houd het knopje 5 seconden ingedrukt.'),
    ('Maak een gratis Tuya-account', 'Tuya is het bedrijf achter Smart Life. Ga op een computer naar platform.tuya.com, klik op Sign Up en kies Individual Developer.'),
    ('Maak een project', 'Klik op Cloud en dan Development, en op Create Cloud Project. Kies bij Industry en Development Method: Smart Home. Kies bij Data Center: Central Europe Data Center.'),
    ('Koppel je Smart Life-app', 'Klik in je project op Devices, Link App Account en Add App Account. Scan de QR-code met de app Smart Life (tabblad Ik, scan-knopje rechtsboven).'),
    ('Neem 3 codes over in Stroomwekker', 'Kopieer de Access ID en Access Secret (tabblad Overview) en de Device ID van je stekker (tabblad Devices). Plak ze in Stroomwekker en tik op Test. Gaat je stekker aan? Dan werkt alles.'),
]
howto = {'@type': 'HowTo', 'name': 'Slimme stekker van de Action koppelen aan Stroomwekker', 'inLanguage': 'nl-NL', 'totalTime': 'PT15M',
         'tool': [{'@type': 'HowToTool', 'name': 'Slimme stekker van de Action (LSC Smart Connect)'}, {'@type': 'HowToTool', 'name': 'App Smart Life'}, {'@type': 'HowToTool', 'name': 'Computer'}],
         'step': [{'@type': 'HowToStep', 'position': i + 1, 'name': n, 'text': t} for i, (n, t) in enumerate(stappen)]}
fq = [('Werkt de slimme stekker van de Action met Stroomwekker?', 'Ja. Zet de stekker in de app Smart Life in plaats van in de app van de Action, en koppel hem daarna aan Stroomwekker. Dat doe je maar één keer.'),
      ('Zie ik ook hoeveel stroom mijn apparaat gebruikt?', 'Alleen als je stekker van de Action een energiemeter heeft. Dan zie je per apparaat het verbruik, wat het kost en wat je bespaart. De goedkoopste stekker zonder energiemeter meet niets, maar aan en uit zetten werkt daarmee gewoon.'),
      ('Kost het koppelen geld?', 'Nee. De app Smart Life en het Tuya-account zijn gratis.'),
      ('Werkt het ook als mijn telefoon uit staat?', 'Ja. Stroomwekker stuurt het seintje via internet naar je stekker. Je telefoon hoeft niet aan te staan.'),
      ('Welke apparaten kan ik op de stekker zetten?', 'Apparaten die vanzelf weer starten als de stroom terugkomt: een boiler, een elektrische kachel of een lader. Een wasmachine moet je vaak eerst op uitgesteld starten zetten. Let op het maximale vermogen van de stekker.')]
maak('/gids/action-slimme-stekker-koppelen/', 'Slimme stekker Action (LSC) laten schakelen op de stroomprijs',
     'Stap voor stap: de slimme stekker van de Action (LSC Smart Connect) via Smart Life koppelen, zodat hij vanzelf aangaat als stroom goedkoop is. Gratis en in 15 minuten.',
     'Slimme stekker van de Action automatisch laten schakelen', 'Stap voor stap uitgelegd. Je doet het één keer, in ongeveer 15 minuten.', f'''
  <section class="card">
    <h2>Wat heb je nodig?</h2>
    <ul><li>Een slimme stekker van de Action (LSC Smart Connect) of een andere stekker die met Smart Life of Tuya werkt.</li><li>Je telefoon met de gratis app Smart Life.</li><li>Een computer, voor het Tuya-account.</li></ul>
  </section>
  <section class="card">
    <h2>Werkt mijn stekker? En zie ik het verbruik?</h2>
<div class="meettabel" id="welkemeet">
  <p class="mt-kop"><b>Aan en uit zetten werkt met elke slimme stekker hieronder, ook de goedkoopste.</b> Wil je ook zien hoeveel stroom je apparaat gebruikt en wat het kost? Dan heb je een stekker met <b>energiemeter</b> nodig.</p>
  <table>
    <thead><tr><th scope="col">Stekker</th><th scope="col">Aan en uit</th><th scope="col">Verbruik zien</th></tr></thead>
    <tbody>
      <tr><td>Action (LSC Smart Connect) <b>zonder</b> energiemeter, de goedkoopste</td><td class="ja">Ja</td><td class="nee">Nee</td></tr>
      <tr><td>Action (LSC Smart Connect) <b>met</b> energiemeter</td><td class="ja">Ja</td><td class="ja">Ja <small>(schatting per kwartier)</small></td></tr>
      <tr><td>Smart Life of Tuya (ook Hema, Calex, Nedis, Woox) <b>zonder</b> energiemeter</td><td class="ja">Ja</td><td class="nee">Nee</td></tr>
      <tr><td>Smart Life of Tuya <b>met</b> energiemeter</td><td class="ja">Ja</td><td class="ja">Ja <small>(schatting per kwartier)</small></td></tr>
      <tr><td>Shelly Plug S, Shelly Plus Plug S en Shelly-modellen met <b>PM</b> in de naam</td><td class="ja">Ja</td><td class="ja">Ja <small>(precieze meterstand)</small></td></tr>
      <tr><td>Shelly zonder PM, zoals Shelly 1 en Plus 1</td><td class="ja">Ja</td><td class="nee">Nee</td></tr>
      <tr><td>Eigen link: IFTTT, Homey, Home Assistant</td><td class="ja">Ja</td><td class="nee">Nee</td></tr>
    </tbody>
  </table>
  <p class="mt-tip"><b>Zo zie je of jouw stekker een energiemeter heeft:</b> open de app van je stekker. Zie je daar hoeveel <b>watt</b> je apparaat nu gebruikt, of een kopje als <i>Elektriciteit</i> of <i>Verbruik</i>? Dan meet hij. Op de doos staat vaak <i>energiemeter</i>, <i>energiemonitor</i> of <i>verbruiksmeter</i>. Twijfel je? Koppel de stekker gewoon: bij de test zeggen wij meteen of hij het verbruik meet.</p>
</div>
  </section>
  <section class="card">
    <h2>Zo doe je het</h2>
    <ol class="stappen" style="grid-template-columns:1fr">
{''.join(f'      <li><b>{n}</b><span>{t}</span></li>' + chr(10) for n, t in stappen)}    </ol>
    <p>In Stroomwekker leggen we elke stap ook uit, met waar je alles kunt vinden. Kies op de startpagina <a href="/?start=apparaat">Apparaat automatisch aan en uit</a>.</p>
    {lees_ook('/gids/action-slimme-stekker-koppelen/')}
  </section>
{faq_html(fq)}
{CTA}''', kruimels=G, extra_ld=[howto, faq_ld(fq)])

# ---------------- Gids: thuisbatterij ----------------
fq = [('Wanneer moet ik mijn thuisbatterij laden?', 'Als stroom het goedkoopst is. Vaak is dat \'s nachts of op een zonnige middag. De prijzen van morgen zijn rond 13:00 uur bekend.'),
      ('Wanneer moet de batterij stroom leveren?', 'Als stroom het duurst is. Vaak is dat \'s ochtends vroeg en tussen 17:00 en 21:00 uur.'),
      ('Wanneer loont laden en ontladen niet?', 'Bij laden en ontladen gaat ongeveer 15 procent verloren. Is het verschil tussen goedkoop en duur kleiner dan dat verlies, dan loont het die dag niet.')]
maak('/gids/thuisbatterij-dynamisch-contract/', 'Thuisbatterij en dynamisch contract: wanneer laden en leveren?',
     'Met een thuisbatterij en een dynamisch contract laad je als stroom goedkoop is en gebruik je de stroom als hij duur is. Lees wanneer het loont en hoe je het automatisch regelt.',
     'Thuisbatterij met een dynamisch contract', 'Wanneer laden, wanneer leveren, en wanneer het niet loont.', f'''
  <section class="card">
    <h2>Het idee</h2>
    <p>Een thuisbatterij slaat stroom op. Met een dynamisch contract laad je de batterij als stroom <b>goedkoop</b> is en gebruik je die stroom als hij <b>duur</b> is. Het verschil is je besparing.</p>
  </section>
  <section class="card">
    <h2>Wanneer laden, wanneer leveren?</h2>
    <ul>
      <li><b>Laden</b>: in de goedkoopste uren. Vaak 's nachts, of op zonnige middagen als er veel zonnestroom is.</li>
      <li><b>Leveren</b>: in de duurste uren. Vaak 's ochtends vroeg en tussen 17:00 en 21:00 uur.</li>
      <li><b>Niets doen</b>: als het verschil te klein is. Bij laden en ontladen gaat ongeveer 15 procent verloren.</li>
    </ul>
    <p>Stroomwekker maakt elke dag een plan voor je batterij: welke uren laden, welke uren leveren, en of het die dag loont. Het plan houdt rekening met dat verlies van 15 procent.</p>
  </section>
  <section class="card">
    <h2>Automatisch regelen</h2>
    <p>Het makkelijkst: zet in de app van je batterij de stand <i>dynamisch tarief</i> of <i>slim laden</i> aan, als die er is. Heeft je batterij dat niet? Zet de lader dan op een slimme stekker en kies in Stroomwekker voor Thuisbatterij. Wij zetten de lader dan vanzelf aan in de goedkoopste uren.</p>
  </section>
  <section class="card">
    <h2>En na 2027?</h2>
    <p>Op 1 januari 2027 stopt de salderingsregeling. Zonnestroom die je teruglevert, levert dan minder op. Een batterij die overdag zonnestroom bewaart voor de avond, wordt daardoor interessanter. Rekenen of het voor jou loont? Probeer de <a href="https://salderingscheck-nl.netlify.app/" rel="noopener">Salderingscheck</a>.</p>
    {lees_ook('/gids/thuisbatterij-dynamisch-contract/')}
  </section>
{faq_html(fq)}
{CTA}''', kruimels=G, extra_ld=[faq_ld(fq)])

# ---------------- Gids: saldering ----------------
fq = [('Wanneer stopt de salderingsregeling?', 'Op 1 januari 2027. Tot en met 31 december 2026 mag je teruggeleverde stroom nog wegstrepen tegen je verbruik.'),
      ('Wat krijg ik na 2027 voor teruggeleverde stroom?', 'Een terugleververgoeding van je energiebedrijf. Tot 2030 is die volgens de wet minimaal de helft van de kale stroomprijs. Daarnaast kunnen terugleverkosten gelden.'),
      ('Is een dynamisch contract slim met zonnepanelen na 2027?', 'Vaak wel, als je je verbruik verschuift naar zonnige uren en terugleveren bij negatieve prijzen voorkomt. Het hangt af van je verbruik en je contract.')]
maak('/gids/saldering-stopt-2027/', 'Saldering stopt in 2027: wat betekent het met een dynamisch contract?',
     'Op 1 januari 2027 stopt de salderingsregeling. Lees in gewone woorden wat er verandert voor zonnepanelen, terugleveren en een dynamisch energiecontract, en wat je nu al kunt doen.',
     'Saldering stopt in 2027: wat betekent dat?', 'Zonnepanelen, terugleveren en een dynamisch contract na 1 januari 2027.', f'''
  <section class="card">
    <h2>Wat verandert er?</h2>
    <p>Tot en met 31 december 2026 mag je stroom die je zonnepanelen teruggeven aan het net <b>wegstrepen</b> tegen de stroom die je gebruikt. Dat heet salderen. Vanaf <b>1 januari 2027</b> stopt dat.</p>
    <p>Daarna worden gebruik en teruglevering apart berekend. Voor teruggeleverde stroom krijg je een terugleververgoeding. Tot 2030 moet die minimaal de helft van de kale stroomprijs zijn. Energiebedrijven mogen ook terugleverkosten rekenen.</p>
  </section>
  <section class="card">
    <h2>Wat betekent het met een dynamisch contract?</h2>
    <ul>
      <li>Zelf gebruiken wordt belangrijker dan terugleveren. Elke kWh die je zelf gebruikt, hoef je niet te kopen.</li>
      <li>Op zonnige middagen is stroom vaak goedkoop. Dat is het moment voor de wasmachine, boiler of auto.</li>
      <li>Bij een negatieve prijs kost terugleveren geld. Dan is zelf gebruiken of de panelen tijdelijk uitzetten slim.</li>
    </ul>
    <p>Stroomwekker helpt hierbij: je apparaten gaan vanzelf aan op goedkope momenten, en je krijgt een bericht als er negatieve prijzen aankomen. Meer daarover in <a href="/gids/negatieve-stroomprijs/">negatieve stroomprijs</a>.</p>
  </section>
  <section class="card">
    <h2>Wat kun je nu al doen?</h2>
    <ul>
      <li>Bekijk je verbruik: wanneer gebruik je stroom, en kun je dat verschuiven?</li>
      <li>Vergelijk contracten op de terugleververgoeding en terugleverkosten vanaf 2027, niet alleen op de stroomprijs.</li>
      <li>Reken uit wat het einde van saldering jou kost met de <a href="https://salderingscheck-nl.netlify.app/" rel="noopener">Salderingscheck</a>.</li>
    </ul>
    {lees_ook('/gids/saldering-stopt-2027/')}
    <p class="bronnen">Bron: <a href="https://www.rijksoverheid.nl/onderwerpen/energie-thuis/salderingsregeling" rel="noopener">Rijksoverheid, salderingsregeling</a>.</p>
  </section>
{faq_html(fq)}
{CTA}''', kruimels=G, extra_ld=[faq_ld(fq)])

# ---------------- Privacy ----------------
maak('/privacy/', 'Privacyverklaring | Stroomwekker',
     'Welke gegevens Stroomwekker bewaart voor berichten, het schakelen van apparaten en het verbruik, waarom, hoe lang, en hoe je alles zelf meteen wist.',
     'Privacy', 'Zo min mogelijk gegevens, alleen om de dienst te laten werken. Je kunt alles zelf meteen wissen.', '''
  <section class="card">
    <h2>In het kort</h2>
    <p>Je hebt geen account nodig. Je hoeft geen naam of e-mailadres in te vullen. Wij gebruiken geen volgcookies en geen advertentienetwerken die je volgen.</p>
  </section>
  <section class="card">
    <h2>Wat bewaren wij, en waarom?</h2>
    <p>Alleen als je berichten of apparaten aanzet, bewaren wij op onze server:</p>
    <ul>
      <li><b>Welke berichten je wilt krijgen</b>, zodat we ze op tijd kunnen sturen.</li>
      <li><b>Een code van je browser</b> (push-adres), zodat we je een bericht kunnen sturen.</li>
      <li><b>De gegevens van je slimme stekker</b> (codes en sleutels), zodat we hem aan en uit kunnen zetten.</li>
      <li><b>Het verbruik van je apparaat</b>, als je stekker dat meet, zodat we kunnen laten zien wat het kost en wat je bespaart. We bewaren maximaal de laatste 62 dagen.</li>
      <li><b>Berichten via het contactformulier</b>, zodat we je kunnen antwoorden.</li>
    </ul>
    <p>Je instellingen worden gekoppeld aan een lange, willekeurige code die alleen in jouw browser staat. Wij weten dus niet wie je bent. We verkopen niets en geven niets aan anderen, behalve wat nodig is om de dienst te laten werken (zie hieronder).</p>
  </section>
  <section class="card">
    <h2>Wie helpen ons daarbij?</h2>
    <ul>
      <li><b>Netlify</b>: hier draait de website en worden je instellingen bewaard.</li>
      <li><b>Tuya / Smart Life</b> of <b>Shelly</b>: via hun cloud zetten wij je stekker aan en uit, met de codes die jij invult.</li>
      <li><b>De pushdienst van je browser</b> (bijvoorbeeld van Google, Apple of Mozilla): die bezorgt onze berichten op je telefoon.</li>
      <li><b>Hostnet</b>: hier komt de e-mail van het contactformulier binnen.</li>
    </ul>
  </section>
  <section class="card">
    <h2>Hoe lang?</h2>
    <p>We bewaren je instellingen zolang je Stroomwekker gebruikt. Haal je een apparaat weg, dan wissen we de gegevens van dat apparaat meteen. Met de knop hieronder wis je alles in één keer.</p>
  </section>
  <section class="card" id="wissen">
    <h2>Alles wissen</h2>
    <p>Wil je dat wij alles wissen wat bij deze telefoon of computer hoort? Druk dan op deze knop:</p>
    <p><button class="btn" id="wis" type="button">Wis al mijn gegevens</button></p>
    <p id="wisMsg" class="small" role="status"></p>
  </section>
  <section class="card">
    <h2>Jouw rechten</h2>
    <p>Je mag vragen welke gegevens wij van je hebben, ze laten verbeteren of laten wissen. Stuur daarvoor een bericht via het <a href="/contact/">contactformulier</a> of naar info@stroomwekker.eu. Ben je het niet eens met hoe wij met je gegevens omgaan? Dan kun je een klacht indienen bij de Autoriteit Persoonsgegevens.</p>
    <p>Verantwoordelijk voor Stroomwekker is <a href="/over/">Erik Beltman</a>.</p>
  </section>
  <section class="card">
    <h2>Advertenties</h2>
    <p>Lager op de startpagina staan tegels van vergelijkingssites. Dat zijn advertenties. Kies je via zo'n tegel een contract? Dan krijgt Stroomwekker soms een klein bedrag. Jij betaalt niets extra. Die sites hebben hun eigen privacyregels.</p>
  </section>''', soort='WebPage', byline=False)
p = PUB / 'privacy/index.html'
p.write_text(p.read_text().replace('</body>', '<script src="/js/privacy.js" defer></script>\n</body>', 1))

# ---------------- 404 ----------------
maak('/404-tmp/', 'Pagina niet gevonden | Stroomwekker', 'Deze pagina bestaat niet (meer).', 'Deze pagina bestaat niet', 'Misschien is de link oud of zit er een typfout in.', '''
  <section class="card">
    <h2>Waar wil je heen?</h2>
    <ul>
      <li><a href="/">Naar de startpagina</a></li>
      <li><a href="/stroomprijs-vandaag/">Stroomprijs vandaag</a> en <a href="/stroomprijs-morgen/">morgen</a></li>
      <li><a href="/gids/">Uitleg en tips</a></li>
      <li><a href="/contact/">Contact</a></li>
    </ul>
  </section>''', soort='WebPage', byline=False)
src = PUB / '404-tmp/index.html'
t = src.read_text().replace('<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">', '<meta name="robots" content="noindex">')
t = re.sub(r'<link rel="canonical"[^>]*>\n?', '', t)
(PUB / '404.html').write_text(t)
src.unlink(); src.parent.rmdir()
print('gemaakt /404.html')
