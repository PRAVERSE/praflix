#!/usr/bin/env python3
"""
PRAFLIX — A PRAVERSE Company
Local Development HTTP Server

Usage:
    python run_dev.py [--port 8085]
"""

import sys
import os
import argparse
import http.server
import socketserver
import webbrowser

sys.stdout.reconfigure(encoding='utf-8')

def run_server(port=8085):
    web_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(web_dir)
    
    Handler = http.server.SimpleHTTPRequestHandler
    
    # Check if port is available, or increment
    for p in range(port, port + 20):
        try:
            with socketserver.TCPServer(("", p), Handler) as httpd:
                print("=" * 65)
                print("🍿 PRAFLIX — A PRAVERSE Company")
                print("Cinema & Web-Series Catalog Platform")
                print("=" * 65)
                print(f"Server running at: http://localhost:{p}/")
                print(f"Serving directory: {web_dir}")
                print("Press Ctrl+C to stop the server.")
                print("=" * 65)
                try:
                    webbrowser.open(f"http://localhost:{p}/")
                except Exception:
                    pass
                httpd.serve_forever()
        except OSError:
            continue

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Run PRAFLIX Development Server")
    parser.add_argument("--port", type=int, default=8085, help="Port to listen on (default 8085)")
    args = parser.parse_args()
    try:
        run_server(args.port)
    except KeyboardInterrupt:
        print("\nPRAFLIX server stopped.")
