from flask import Flask, request, Response, stream_with_context
from flask_cors import CORS
import requests

app = Flask(__name__)
CORS(app)

TARGET = "http://45.13.97.48:3002"


@app.route("/<path:path>", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
def proxy(path):
    url = f"{TARGET}/{path}"

    headers = {k: v for k, v in request.headers if k.lower() != "host"}

    resp = requests.request(
        method=request.method,
        url=url,
        headers=headers,
        params=request.args,
        data=request.get_data(),
        stream=True,  # needed for SSE
        timeout=None,  # SSE connections are long-lived
    )

    is_sse = "text/event-stream" in resp.headers.get("Content-Type", "")

    def generate():
        for chunk in resp.iter_content(chunk_size=None):
            if chunk:
                yield chunk

    response = Response(
        stream_with_context(generate()),
        status=resp.status_code,
        content_type=resp.headers.get("Content-Type"),
    )

    # forward relevant headers back
    for header in ["Cache-Control", "X-Accel-Buffering"]:
        if header in resp.headers:
            response.headers[header] = resp.headers[header]

    # SSE requires these
    if is_sse:
        response.headers["Cache-Control"] = "no-cache"
        response.headers["X-Accel-Buffering"] = "no"

    return response


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3005, ssl_context=("./cert.pem", "./key.pem"), debug=False)
