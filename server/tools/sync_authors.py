"""Saves every author in the library to the `authors` database, with their OpenAlex
profile (works, citations, h-index, institutions, ORCID, topics).

The mafia map keeps it current on its own (new authors are added as papers come in);
run this for the first fill or to refresh every profile.

Run from the server directory:
    .venv/bin/python -m tools.sync_authors              # new / stale authors only
    .venv/bin/python -m tools.sync_authors --refresh    # re-fetch every profile
"""
import argparse
import os
import time

from dotenv import load_dotenv

from src import authors_db, corelamo, mafia


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true", help="re-fetch every profile")
    args = ap.parse_args()

    load_dotenv(".env")
    corelamo.configure(os.environ["CORELAMO_URL"], os.environ["CORELAMO_USER"],
                       os.environ["CORELAMO_PASS"], os.environ["CORELAMO_DB"])
    t = time.time()
    st = mafia._get_state()
    docs = authors_db.sync(st["papers"], st["authors"], refresh=args.refresh)
    with_profile = sum(1 for d in docs.values() if d.get("profile_updated"))
    print(f"{len(docs)} authors saved ({with_profile} with an OpenAlex profile) in {time.time() - t:.0f}s")


if __name__ == "__main__":
    main()
