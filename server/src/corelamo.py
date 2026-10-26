import threading
import requests


class CorelamoClient:
    def __init__(self, base_url, username, password):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self._token = None
        self._lock = threading.Lock()

    def _login(self):
        resp = requests.post(
            f"{self.base_url}/api/login",
            json={"username": self.username, "password": self.password},
            timeout=10,
        )
        resp.raise_for_status()
        self._token = resp.json()["data"]["token"]

    def request(self, method, path, body=None, timeout=30):
        url = f"{self.base_url}{path}"
        for attempt in (1, 2):
            if self._token is None:
                with self._lock:
                    if self._token is None:
                        self._login()
            headers = {
                "X-Corelamo-Key": self._token,
                "Content-Type": "application/json",
            }
            resp = requests.request(
                method, url, json=body, headers=headers, timeout=timeout)
            if resp.status_code == 401 and attempt == 1:
                with self._lock:
                    self._login()
                continue
            return resp
        return resp


_client = None
_db_name = None


def configure(base_url, username, password, db_name):
    global _client, _db_name
    _client = CorelamoClient(base_url, username, password)
    _db_name = db_name


def _c():
    if _client is None:
        raise RuntimeError(
            "corelamo client not configured (call configure() first)")
    return _client


def _p(path):
    return f"/api/databases/{_db_name}{path}"


def insert(docs):
    return _c().request("POST", _p("/insert"), docs)


def upsert(docs):
    return _c().request("POST", _p("/upsert"), docs)


def delete(ids):
    return _c().request("DELETE", _p("/delete"), ids)


def retrieve(ids):
    return _c().request("POST", _p("/retrieve"), ids)


def lookup(ids, return_fields=None):
    body = {"ids": ids}
    if return_fields is not None:
        body["return_fields"] = return_fields
    return _c().request("POST", _p("/lookup"), body)


def partial_replace(items):
    return _c().request("POST", _p("/partial-replace"), items)


def search(query, docs=10, offset=0, filters=None, return_fields=None):
    body = {"query": query, "docs": docs, "offset": offset}
    if filters:
        body["filters"] = filters
    if return_fields is not None:
        body["return_fields"] = return_fields
    return _c().request("POST", _p("/search"), body)
