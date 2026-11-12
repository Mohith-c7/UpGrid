#!/usr/bin/env python3
"""Local preview server with clean URLs (/students -> students.html) and the 404 page.
Usage: python3 tools/serve.py [port]   (run from anywhere; serves the website folder)"""
import http.server, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def send_head(self):
        p = self.path.split("?")[0].split("#")[0]
        if p != "/" and "." not in os.path.basename(p) and os.path.isfile(os.path.join(ROOT, p.strip("/") + ".html")):
            self.path = p + ".html"
        return super().send_head()
    def send_error(self, code, message=None, explain=None):
        if code == 404 and os.path.isfile(os.path.join(ROOT, "404.html")):
            body = open(os.path.join(ROOT, "404.html"), "rb").read()
            self.send_response(404); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(body))); self.end_headers()
            if self.command != "HEAD": self.wfile.write(body)
        else: super().send_error(code, message, explain)
if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"Serving {ROOT} at http://localhost:{port}"); http.server.ThreadingHTTPServer(("", port), H).serve_forever()
