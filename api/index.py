"""
Vercel Serverless Function Proxy for StraddleEDGE
Zero external dependencies (uses standard library: http.server, urllib.request, json)
"""
import json
import urllib.request
import urllib.error
import urllib.parse
from http.server import BaseHTTPRequestHandler

REMOTE_BASE = "https://mcwm-straddle.co.in"

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        self._proxy("GET")

    def do_POST(self):
        self._proxy("POST")

    def do_PUT(self):
        self._proxy("PUT")

    def do_DELETE(self):
        self._proxy("DELETE")

    def _proxy(self, method):
        # Extract target API path
        parsed_url = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed_url.query)
        
        # If passed via Vercel rewrite ?path=...
        if "path" in qs and qs["path"]:
            api_subpath = qs["path"][0]
            # preserve any other query parameters
            other_params = {k: v for k, v in qs.items() if k != "path"}
            sub_query = urllib.parse.urlencode(other_params, doseq=True) if other_params else ""
        else:
            api_subpath = parsed_url.path
            if api_subpath.startswith("/api/"):
                api_subpath = api_subpath[len("/api/"):]
            elif api_subpath.startswith("/api"):
                api_subpath = api_subpath[len("/api"):]
            sub_query = parsed_url.query

        clean_subpath = api_subpath.lstrip("/")
        remote_url = f"{REMOTE_BASE}/api/{clean_subpath}"
        if sub_query:
            remote_url += f"?{sub_query}"

        # Read request body if present
        body = None
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 0:
            body = self.rfile.read(content_length)

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) StraddleEDGE-Vercel/1.0",
            "Accept": "application/json, text/plain, */*",
        }
        if self.headers.get("Content-Type"):
            headers["Content-Type"] = self.headers.get("Content-Type")

        req = urllib.request.Request(remote_url, data=body, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=8) as response:
                status = response.getcode()
                resp_body = response.read()
                content_type = response.headers.get("Content-Type", "application/json")

                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "public, max-age=3, s-maxage=3")
                self.end_headers()
                self.wfile.write(resp_body)

        except urllib.error.HTTPError as e:
            err_body = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", e.headers.get("Content-Type", "application/json"))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(err_body)

        except Exception as e:
            # Resilient fallback JSON
            fallback = json.dumps({
                "status": "online",
                "message": "StraddleEDGE Vercel Serverless Function — Made by Praveen Tripathi",
                "subpath": clean_subpath,
                "error": str(e)
            }).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(fallback)
