"""Gives every paper in the library an `author_ids` field: the ids of its authors in
the `authors` database (OpenAlex author ids, in authorship order; authors known only
by name get the database's "name:..." id). Authors already point back to their papers
through `library_paper_ids`.

Run from the server directory:
    .venv/bin/python -m tools.backfill_author_ids            # dry run
    .venv/bin/python -m tools.backfill_author_ids --apply    # write changes
"""
import argparse
import os

from dotenv import load_dotenv

from src import corelamo, mafia

PATCH_CHUNK = 50


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write to Corelamo")
    args = ap.parse_args()

    load_dotenv(".env")
    corelamo.configure(os.environ["CORELAMO_URL"], os.environ["CORELAMO_USER"],
                       os.environ["CORELAMO_PASS"], os.environ["CORELAMO_DB"])
    st = mafia._get_state()

    resp = corelamo.search("", docs=100000, filters={"cited_by_count": {"range": ">=0"}},
                           return_fields={"author_ids": True})
    resp.raise_for_status()
    current = {d["id"]: d["data"].get("author_ids") or [] for d in resp.json().get("data", [])}

    patches = [{"id": pid, "patch": {"author_ids": p["authors"]}}
               for pid, p in st["papers"].items() if current.get(pid) != p["authors"]]
    print(f"{len(st['papers'])} papers, {len(patches)} need author_ids "
          f"({sum(1 for p in patches if not p['patch']['author_ids'])} with no authors)")
    if not args.apply:
        print("dry run, nothing written (pass --apply)")
        return

    failed = 0
    for start in range(0, len(patches), PATCH_CHUNK):
        chunk = patches[start:start + PATCH_CHUNK]
        r = corelamo.partial_replace(chunk)
        if r.status_code not in (200, 207):
            failed += len(chunk)
            print(f"chunk {start}: HTTP {r.status_code} {r.text[:200]}")
    print(f"done, {len(patches) - failed} patched, {failed} failed")


if __name__ == "__main__":
    main()
