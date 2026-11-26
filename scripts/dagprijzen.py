"""Zet de tekst van /stroomprijs-vandaag/ en /stroomprijs-morgen/ in de branch social-data.

De dagelijkse video-taak leest deze bestanden als hij de site zelf niet kan openen.
Gebruik: python3 scripts/dagprijzen.py <uitvoermap>
Schrijft: dagprijzen/vandaag.json, dagprijzen/morgen.json en dagprijzen/<datum>.json (14 dagen bewaard).
"""
import datetime, html.parser, json, os, re, sys, urllib.request
from zoneinfo import ZoneInfo

SITE = "https://stroomwekker.eu"
NL = ZoneInfo("Europe/Amsterdam")


class Tekst(html.parser.HTMLParser):
    """Haalt de leesbare tekst uit <main> (zonder scripts, stijlen, menu en voettekst)."""
    SKIP = {"script", "style", "nav", "header", "footer", "svg", "noscript", "button"}
    BLOK = {"p", "li", "h1", "h2", "h3", "h4", "tr", "section", "div", "br"}

    def __init__(self):
        super().__init__()
        self.in_main = 0
        self.skip = 0
        self.uit = []

    def handle_starttag(self, tag, attrs):
        if tag == "main":
            self.in_main += 1
        if tag in self.SKIP:
            self.skip += 1
        if tag in self.BLOK:
            self.uit.append("\n")
        if tag in ("td", "th"):
            self.uit.append(" | ")

    def handle_endtag(self, tag):
        if tag == "main":
            self.in_main -= 1
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        if tag in self.BLOK:
            self.uit.append("\n")

    def handle_data(self, data):
        if self.in_main > 0 and not self.skip:
            self.uit.append(data)

    def tekst(self):
        t = "".join(self.uit)
        t = re.sub(r"[ \t\r\f\v]+", " ", t)
        regels = [r.strip(" |") .strip() for r in t.split("\n")]
        return "\n".join(r for r in regels if r)


def haal(pad):
    req = urllib.request.Request(SITE + pad, headers={"User-Agent": "Stroomwekker-social-data/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def pagina(pad, datum):
    ruw = haal(pad)
    p = Tekst()
    p.feed(ruw)
    tekst = p.tekst()
    titel = re.search(r"<title>(.*?)</title>", ruw, re.S)
    beschikbaar = "nog niet" not in tekst.lower()[:400] and "even niet beschikbaar" not in tekst.lower()
    return {
        "datum": datum,
        "pagina": SITE + pad,
        "titel": html.unescape(titel.group(1).strip()) if titel else "",
        "beschikbaar": beschikbaar,
        "opgehaald": datetime.datetime.now(NL).isoformat(timespec="minutes"),
        "tekst": tekst,
    }


def main():
    uit = os.path.join(sys.argv[1] if len(sys.argv) > 1 else ".", "dagprijzen")
    os.makedirs(uit, exist_ok=True)
    vandaag = datetime.datetime.now(NL).date()
    morgen = vandaag + datetime.timedelta(days=1)

    v = pagina("/stroomprijs-vandaag/", vandaag.isoformat())
    m = pagina("/stroomprijs-morgen/", morgen.isoformat())
    for naam, d in (("vandaag.json", v), ("morgen.json", m), (f"{vandaag.isoformat()}.json", v)):
        with open(os.path.join(uit, naam), "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
    if m["beschikbaar"]:
        with open(os.path.join(uit, f"{morgen.isoformat()}.json"), "w", encoding="utf-8") as f:
            json.dump(m, f, ensure_ascii=False, indent=1)

    grens = (vandaag - datetime.timedelta(days=14)).isoformat()
    for naam in os.listdir(uit):
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.json", naam) and naam[:10] < grens:
            os.remove(os.path.join(uit, naam))
    print("vandaag:", v["beschikbaar"], len(v["tekst"]), "tekens; morgen:", m["beschikbaar"], len(m["tekst"]), "tekens")
    if not v["beschikbaar"]:
        sys.exit("De prijzen van vandaag staan niet op de site")


if __name__ == "__main__":
    main()
