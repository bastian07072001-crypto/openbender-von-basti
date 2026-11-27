#!/usr/bin/env python3
from http.server import HTTPServer, SimpleHTTPRequestHandler
import os
import sys

class NoCacheHTTPRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Cache-Headers deaktivieren
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == '__main__':
    os.chdir('.')  # oder ein bestimmtes Verzeichnis
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8010  # z.B. 8011 für Tests ohne den eigenen Autosave
    server = HTTPServer(('localhost', port), NoCacheHTTPRequestHandler)
    print(f'🚀 Server läuft auf http://localhost:{port} (Cache deaktiviert)')
    server.serve_forever()
