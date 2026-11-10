#!/usr/bin/env python3
"""Switch the app between the dark and light UBM themes.

Appsmith has no runtime theme switch, and picking a featured theme in the
theme panel drops the extra colours the pages use. So the switch is made in
git: this script rewrites the colours in theme.json, commits and pushes.
Then click Pull in the Appsmith editor.

Usage:
  python3 scripts/switch-theme.py light        # switch, commit, push
  python3 scripts/switch-theme.py dark
  python3 scripts/switch-theme.py light --no-push   # edit theme.json only
  python3 scripts/switch-theme.py status       # show the current theme
"""
import json
import os
import re
import subprocess
import sys

# Every colour the pages read as appsmith.theme.colors.<key>. Both palettes
# must have the same keys; add new keys to both.
THEMES = {
    "dark": {
        "backgroundColor": "#1E293A",
        "primaryColor": "#0F1729",
        "surfaceColor": "#0f172a",
        "panelColor": "#0f172a",
        "surfaceAltColor": "#1e293b",
        "surfaceHoverColor": "#26344b",
        "borderColor": "#334155",
        "textStrongColor": "#ffffff",
        "textColor": "#e2e8f0",
        "textSecondaryColor": "#94a3b8",
        "textMutedColor": "#64748b",
        "linkColor": "#60a5fa",
        "successColor": "#34d399",
        "warningColor": "#fbbf24",
        "dangerColor": "#f87171",
        "accentColor": "#86efac",
        "actionColor": "#2563eb",
        "toggleOnColor": "#2563eb",
        "toggleOffColor": "#ffffff",
    },
    "light": {
        "backgroundColor": "#ffffff",
        "primaryColor": "#091b44",
        "surfaceColor": "#ffffff",
        "panelColor": "#f1f2f4",
        "surfaceAltColor": "#e4e6ea",
        "surfaceHoverColor": "#dde9f7",
        "borderColor": "#d1d8e3",
        "textStrongColor": "#091b44",
        "textColor": "#606266",
        "textSecondaryColor": "#606266",
        "textMutedColor": "#5f6672",
        "linkColor": "#1c4aad",
        "successColor": "#166534",
        "warningColor": "#92400e",
        "dangerColor": "#b91c1c",
        "accentColor": "#091b44",
        "actionColor": "#091b44",
        "toggleOnColor": "#1684fc",
        "toggleOffColor": "#1684fc",
    },
}

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME_FILE = os.path.join(ROOT, "theme.json")


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, check=True,
                          capture_output=True, text=True).stdout.strip()


def colours_block(text):
    """Return (start, end) of the properties.colors object body in theme.json."""
    props = text.index('"properties": {')
    m = re.compile(r'"colors": \{\n(.*?)\n(\s*)\}', re.S).search(text, props)
    if not m:
        sys.exit("Could not find properties.colors in theme.json")
    return m.start(1), m.end(1), m.group(2)


def current_theme(text):
    colours = json.loads(text)["properties"]["colors"]
    for name, palette in THEMES.items():
        if all(colours.get(k, "").lower() == v.lower() for k, v in palette.items()):
            return name
    return "custom (matches neither palette)"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    no_push = "--no-push" in sys.argv
    if len(args) != 1 or args[0] not in ("light", "dark", "status"):
        sys.exit(__doc__)

    text = open(THEME_FILE).read()
    now = current_theme(text)
    if args[0] == "status":
        print("Current theme:", now)
        return
    target = args[0]
    if now == target:
        print("Already on the %s theme; nothing to do." % target)
        return

    if not no_push:
        if git("status", "--porcelain", "--", "theme.json"):
            sys.exit("theme.json has uncommitted changes; commit or discard them first.")
        branch = git("rev-parse", "--abbrev-ref", "HEAD")
        print("Pulling latest %s..." % branch)
        git("pull", "--rebase", "origin", branch)
        text = open(THEME_FILE).read()

    start, end, close_indent = colours_block(text)
    indent = close_indent + "  "
    body = ",\n".join('%s"%s": "%s"' % (indent, k, v) for k, v in THEMES[target].items())
    text = text[:start] + body + text[end:]
    json.loads(text)  # refuse to write broken JSON
    open(THEME_FILE, "w").write(text)
    print("theme.json switched from %s to %s." % (now, target))

    if no_push:
        print("Not committed (--no-push).")
        return
    git("add", "theme.json")
    git("commit", "-m", "Switch app theme to %s" % target)
    git("push", "origin", branch)
    print("Pushed to %s. Now click Pull in the Appsmith editor." % branch)


if __name__ == "__main__":
    main()
