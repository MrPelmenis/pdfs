"""Reclassify stub documents that were stored with the old default category.

Stubs used to be inserted with category_id=1 regardless of their field. This
re-resolves every stub's category the same way new documents are classified
(OpenAlex primary_topic field, Gemma as fallback) and patches it in Corelamo.

Run from the server directory:
    .venv/bin/python -m tools.backfill_categories            # dry run
    .venv/bin/python -m tools.backfill_categories --apply    # write changes
"""
import argparse
import collections
import os

from dotenv import load_dotenv

from src import corelamo
from src.categories import get_category_by_name, NONE_CATEGORY
from src.classify import resolve_category
from src.metadata_analyser import openalex_batch, field_of_work

PATCH_CHUNK = 50


def all_docs(stub_value):
    resp = corelamo.search(
        "", docs=100000,
        filters={"stub_document": {"exact": stub_value}},
        return_fields={"title": True, "abstract": True, "keywords_text": True,
                       "openalex_id": True, "category_id": True},
    )
    resp.raise_for_status()
    return [(d["id"], d["data"]) for d in resp.json().get("data", [])]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write to Corelamo")
    ap.add_argument("--include-full", action="store_true",
                    help="also reclassify full (non-stub) documents")
    args = ap.parse_args()

    load_dotenv(".env")
    corelamo.configure(os.environ["CORELAMO_URL"], os.environ["CORELAMO_USER"],
                       os.environ["CORELAMO_PASS"], os.environ["CORELAMO_DB"])

    docs = all_docs("yes")
    if args.include_full:
        docs += all_docs("no")
    print(f"{len(docs)} documents to classify")

    works = openalex_batch([d.get("openalex_id") or doc_id for doc_id, d in docs],
                           select="id,primary_topic")
    print(f"OpenAlex returned {len(works)} works")

    patches, sources, result = [], collections.Counter(), collections.Counter()
    for doc_id, d in docs:
        field = field_of_work(works.get((d.get("openalex_id") or doc_id).upper()))
        sources["openalex" if field else "llm"] += 1
        if field and not args.apply and get_category_by_name(field) is NONE_CATEGORY:
            # A dry run must not create categories, so just report it.
            result[f"{field.lower()} (new category)"] += 1
            continue
        cat = resolve_category(field=field, title=d.get("title") or "",
                               abstract=d.get("abstract") or "",
                               keywords=d.get("keywords_text") or "")
        result[cat["name"]] += 1
        if cat["id"] != d.get("category_id"):
            patches.append({"id": doc_id, "patch": {"category_id": int(cat["id"])}})

    print("sources:", dict(sources))
    for name, n in result.most_common():
        print(f"  {n:5d}  {name}")
    print(f"{len(patches)} documents would change")

    if not args.apply:
        print("dry run, nothing written (pass --apply)")
        return

    failed = 0
    for start in range(0, len(patches), PATCH_CHUNK):
        chunk = patches[start:start + PATCH_CHUNK]
        resp = corelamo.partial_replace(chunk)
        if resp.status_code not in (200, 207):
            failed += len(chunk)
            print(f"chunk {start}: HTTP {resp.status_code} {resp.text[:200]}")
        print(f"\rpatched {min(start + PATCH_CHUNK, len(patches))}/{len(patches)}",
              end="", flush=True)
    print(f"\ndone, {failed} failed")


if __name__ == "__main__":
    main()
