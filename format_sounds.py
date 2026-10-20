"""Generate sounds.json listing every audio file in ./sounds (alphabetical).

Run this whenever you add/remove/rename sounds, then commit sounds.json.
Use browser-friendly formats (.mp3, .wav, .ogg, .m4a); .wav/.mp3 are safest.
"""
import json
import os

SOUNDS_DIR = "sounds"
EXTS = {".mp3", ".wav", ".ogg", ".m4a", ".flac", ".webm"}

files = sorted(
    f for f in os.listdir(SOUNDS_DIR)
    if not f.startswith(".") and os.path.splitext(f)[1].lower() in EXTS
)
with open("sounds.json", "w") as fh:
    json.dump(files, fh, indent=2)
print(f"Wrote sounds.json with {len(files)} sounds")
