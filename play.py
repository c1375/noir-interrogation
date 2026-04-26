#!/usr/bin/env python3
"""play.py -- one-click launcher for Noir Interrogation.

Starts a local static server in ./web/ and opens the game in the default
browser. Cross-platform (Windows / macOS / Linux). Works when double-clicked
from Explorer/Finder OR run from a terminal.
"""

import http.server
import os
import socketserver
import sys
import threading
import time
import webbrowser

PORT = 8765
HERE = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(HERE, "web")


def banner():
    print()
    print("  ====================================================")
    print("    Noir Interrogation")
    print("  ====================================================")
    print()
    print(f"    Server:  http://localhost:{PORT}/")
    print( "    Browser: opens automatically.")
    print( "    Stop:    close this window (or press Ctrl+C).")
    print()
    print("  ====================================================")
    print()


def open_browser_after_delay():
    time.sleep(0.8)  # let the server bind first
    webbrowser.open(f"http://localhost:{PORT}/")


def main():
    if not os.path.isdir(WEB_DIR):
        print(f"[ERROR] Couldn't find the web/ folder next to this script.")
        print(f"        Expected: {WEB_DIR}")
        input("Press Enter to exit...")
        sys.exit(1)

    os.chdir(WEB_DIR)
    banner()

    threading.Thread(target=open_browser_after_delay, daemon=True).start()

    handler = http.server.SimpleHTTPRequestHandler
    # Allow rapid restart without the OS holding the port in TIME_WAIT.
    socketserver.TCPServer.allow_reuse_address = True

    try:
        with socketserver.TCPServer(("", PORT), handler) as httpd:
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\nServer stopped.")
    except OSError as e:
        # Most common cause: port already in use (the user double-clicked
        # twice, or another server is on 8765). Just open the existing one.
        print(f"[notice] Port {PORT} already in use ({e}).")
        print(f"[notice] Opening the existing server in your browser instead.")
        webbrowser.open(f"http://localhost:{PORT}/")
        input("Press Enter to exit...")
        sys.exit(0)


if __name__ == "__main__":
    main()
