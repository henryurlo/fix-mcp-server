"""Standalone HTTP server for the FIX MCP AI Operations Theater frontend.
Serves the bundled HTML/JS frontend and proxies API calls to the backend."""
import http.server
import json
import urllib.request
import urllib.error
import sys
from pathlib import Path

BACKEND = "http://localhost:8000"
HTML_FILE = Path(__file__).parent / "frontend.html"


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/test":
            self._serve_file(Path(__file__).parent / "test_debug.html", "text/html; charset=utf-8")
        elif self.path == "/" or self.path == "":
            self._serve_file(HTML_FILE, "text/html; charset=utf-8")
        elif self.path.startswith("/api/"):
            self._proxy("GET")
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path.startswith("/api/"):
            self._proxy("POST")
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _serve_file(self, fpath, content_type):
        try:
            body = fpath.read_bytes()
        except FileNotFoundError:
            self.send_error(404, f"{fpath} not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _proxy(self, method):
        url = BACKEND + self.path
        headers = {"Origin": BACKEND}
        body = None
        if method == "POST":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            resp = urllib.request.urlopen(req, timeout=10)
            data = resp.read()
            self.send_response(resp.status)
            self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_response(502)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(f"Backend error: {e}".encode())

    def log_message(self, fmt, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8088
    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"FIX MCP Theater running at http://0.0.0.0:{port}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
