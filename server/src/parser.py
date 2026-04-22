import re
import xml.etree.ElementTree as ET
from grobid_client.grobid_client import GrobidClient

_client = None

CONFIG_PATH = "./grobid/config.json"

def get_client(config_path=CONFIG_PATH):
    global _client
    if _client is None:
        _client = GrobidClient(config_path=config_path)
    return _client


def extract_paper_data(pdf_path: str, config_path: str =CONFIG_PATH) -> dict:
    client = get_client(config_path)

    _, status, rsp = client.process_pdf(
        "processFulltextDocument",
        pdf_path,
        generateIDs=True,
        consolidate_header=1,
        consolidate_citations=1,
        include_raw_citations=False,
        include_raw_affiliations=False,
        tei_coordinates=False,
        segment_sentences=False,
    )

    if status != 200:
        raise RuntimeError(f"GROBID returned status {status} for {pdf_path}")

    root = ET.fromstring(rsp)
    ns = {"tei": "http://www.tei-c.org/ns/1.0"}

    # DOI (from GROBID header)
    doi = None
    doi_el = root.find(".//tei:sourceDesc//tei:idno[@type='DOI']", ns)
    if doi_el is not None and doi_el.text:
        doi = doi_el.text.strip().lower()

    # Title
    title_el = root.find(".//tei:fileDesc//tei:titleStmt//tei:title", ns)
    title = "".join(title_el.itertext()).strip() if title_el is not None else None

    # Date
    date_el = (
        root.find(".//tei:publicationStmt/tei:date", ns)
        or root.find(".//tei:sourceDesc//tei:date", ns)
    )
    pub_date = date_el.get("when") if date_el is not None else None
    if not pub_date:
        note = root.find(".//tei:sourceDesc//tei:note[@type='submission']", ns)
        if note is not None and note.text:
            match = re.search(r"\d{4}[.\-]\d{2}[.\-]\d{2}", note.text)
            pub_date = match.group(0) if match else None

    # Authors
    authors = []
    for author in root.findall(".//tei:sourceDesc//tei:author", ns):
        persName = author.find(".//tei:persName", ns)
        if persName is not None:
            surname = persName.find("tei:surname", ns)
            forename = persName.find("tei:forename", ns)
            name = f"{forename.text if forename is not None else ''} {surname.text if surname is not None else ''}".strip()
            if name:
                authors.append(name)

    # Abstract
    abstract_el = root.find(".//tei:profileDesc//tei:abstract//tei:p", ns)
    abstract = "".join(abstract_el.itertext()).strip() if abstract_el is not None else None

    # Methods
    methods_sections = []
    for div in root.findall(".//tei:body//tei:div", ns):
        head = div.find("tei:head", ns)
        if head is not None and head.text:
            heading = head.text.strip().lower()
            if any(k in heading for k in [
                "method", "experiment", "material", "procedure",
                "approach", "protocol", "technique", "setup",
                "characterization", "synthesis", "preparation",
                "recovery", "recycling process", "pretreatment",
            ]):
                paragraphs = [
                    "".join(p.itertext()).strip()
                    for p in div.findall(".//tei:p", ns)
                    if "".join(p.itertext()).strip()
                ]
                if paragraphs:
                    methods_sections.append({
                        "heading": head.text.strip(),
                        "text": "\n\n".join(paragraphs),
                    })

    # Full text
    paragraphs = [
        "".join(p.itertext()).strip()
        for p in root.findall(".//tei:body//tei:p", ns)
        if "".join(p.itertext()).strip()
    ]
    full_text = "\n\n".join(paragraphs)

    # References
    references = []
    for ref in root.findall(".//tei:listBibl//tei:biblStruct", ns):
        ref_title_el = ref.find(".//tei:analytic//tei:title", ns) or ref.find(".//tei:monogr//tei:title", ns)
        ref_title = ref_title_el.text.strip() if ref_title_el is not None and ref_title_el.text else None

        ref_authors = []
        for author in ref.findall(".//tei:author", ns):
            persName = author.find(".//tei:persName", ns)
            if persName is not None:
                surname = persName.find("tei:surname", ns)
                forename = persName.find("tei:forename", ns)
                name = f"{forename.text if forename is not None else ''} {surname.text if surname is not None else ''}".strip()
                if name:
                    ref_authors.append(name)

        ref_date_el = ref.find(".//tei:imprint//tei:date", ns)
        ref_date = ref_date_el.get("when") if ref_date_el is not None else None

        references.append({
            "title": ref_title,
            "authors": ref_authors,
            "date": ref_date,
        })

    return {
        "file": pdf_path,
        "title": title,
        "date": pub_date,
        "doi": doi,
        "authors": authors,
        "abstract": abstract,
        "full_text": full_text,
        "references": references,
        "methods": methods_sections,
    }
